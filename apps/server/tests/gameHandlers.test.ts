import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect } from 'socket.io-client';
import type { Socket as ClientSocket } from 'socket.io-client';
import type {
  ClientGameStateDTO,
  ClientToServerEvents,
  GameActionErrorPayload,
  RoomJoinedSuccessPayload,
  ServerToClientEvents,
} from '@virus/shared';
import { createVirusServer } from '../src/index';
import type { VirusServerInstance } from '../src/index';

type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

let server: VirusServerInstance;
let url: string;
const clients: Client[] = [];

beforeEach(async () => {
  server = createVirusServer('*');
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  await server.close();
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
});

async function newClient(): Promise<Client> {
  const c: Client = connect(url, { transports: ['websocket'], forceNew: true });
  clients.push(c);
  await new Promise<void>((resolve) => c.on('connect', resolve));
  return c;
}

function once<E extends keyof ServerToClientEvents>(
  c: Client,
  event: E,
  timeoutMs = 2_000,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c as any).once(event, (payload: any) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Host + invitado listos en una sala WAITING. */
async function lobby() {
  const host = await newClient();
  const guest = await newClient();

  const hostJoined = once(host, 'room:joined_success');
  host.emit('room:create', { nickname: 'Ana' });
  const hostInfo: RoomJoinedSuccessPayload = await hostJoined;

  const guestJoined = once(guest, 'room:joined_success');
  guest.emit('room:join', { roomId: hostInfo.roomId, nickname: 'Beto' });
  const guestInfo: RoomJoinedSuccessPayload = await guestJoined;

  return { host, guest, hostInfo, guestInfo };
}

async function startedGame() {
  const l = await lobby();
  const hostState = once(l.host, 'game:state_sync');
  const guestState = once(l.guest, 'game:state_sync');
  l.host.emit('game:start', { roomId: l.hostInfo.roomId });
  return { ...l, hostDto: await hostState, guestDto: await guestState };
}

describe('HTTP', () => {
  it('GET /health responde 200', async () => {
    const res = await fetch(`${url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });
});

describe('Socket handlers', () => {
  it('room:create / room:join entregan credenciales y emiten room:updated', async () => {
    const { hostInfo, guestInfo } = await lobby();
    expect(hostInfo.roomId).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(guestInfo.roomId).toBe(hostInfo.roomId);
    expect(hostInfo.playerId).not.toBe(guestInfo.playerId);
    expect(hostInfo.sessionToken).toBeTruthy();
  });

  it('rechaza payloads inválidos con INVALID_PAYLOAD (validación Zod)', async () => {
    const c = await newClient();
    const err = once(c, 'game:action_error');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c as any).emit('room:create', { nickname: '', extra: true });
    expect((await err).code).toBe('INVALID_PAYLOAD');
  });

  it('game:start solo lo puede ejecutar el host', async () => {
    const { guest, hostInfo } = await lobby();
    const err = once(guest, 'game:action_error');
    guest.emit('game:start', { roomId: hostInfo.roomId });
    expect((await err).code).toBe('NOT_HOST');
  });

  it('game:start envía a cada jugador su DTO sanitizado', async () => {
    const { hostDto, guestDto, hostInfo, guestInfo } = await startedGame();
    expect(hostDto.status).toBe('IN_PROGRESS');
    expect(hostDto.me.playerId).toBe(hostInfo.playerId);
    expect(hostDto.me.hand).toHaveLength(3);
    expect(hostDto.opponents[0]?.handCount).toBe(3);
    expect(hostDto.turnState.isMyTurn).toBe(true);
    expect(guestDto.me.playerId).toBe(guestInfo.playerId);
    expect(guestDto.turnState.isMyTurn).toBe(false);

    const raw = JSON.stringify(hostDto);
    expect(raw).not.toContain('sessionToken');
    expect(raw).not.toContain(guestInfo.sessionToken);
    for (const card of guestDto.me.hand) expect(raw).not.toContain(`"${card.id}"`);
  });

  it('game:action válida avanza el turno y sincroniza a ambos', async () => {
    const { host, guest, hostDto, hostInfo, guestInfo } = await startedGame();
    const hostSync = once(host, 'game:state_sync');
    const guestSync = once(guest, 'game:state_sync');
    host.emit('game:action', {
      roomId: hostInfo.roomId,
      playerId: hostInfo.playerId,
      actionType: 'DISCARD',
      payload: { cardIds: [hostDto.me.hand[0]!.id] },
    });
    const h: ClientGameStateDTO = await hostSync;
    const g: ClientGameStateDTO = await guestSync;
    expect(h.turnState.currentPlayerId).toBe(guestInfo.playerId);
    expect(h.turnState.isMyTurn).toBe(false);
    expect(g.turnState.isMyTurn).toBe(true);
    expect(h.me.hand).toHaveLength(3);
    expect(g.lastActionLog?.actionType).toBe('DISCARD');
  });

  it('game:action fuera de turno solo notifica error al emisor', async () => {
    const { guest, guestDto, guestInfo } = await startedGame();
    const err: GameActionErrorPayload = await (async () => {
      const p = once(guest, 'game:action_error');
      guest.emit('game:action', {
        roomId: guestInfo.roomId,
        playerId: guestInfo.playerId,
        actionType: 'DISCARD',
        payload: { cardIds: [guestDto.me.hand[0]!.id] },
      });
      return p;
    })();
    expect(err.code).toBe('NOT_YOUR_TURN');
  });

  it('game:action con playerId ajeno es rechazado (IDENTITY_MISMATCH)', async () => {
    const { guest, hostDto, hostInfo } = await startedGame();
    const p = once(guest, 'game:action_error');
    guest.emit('game:action', {
      roomId: hostInfo.roomId,
      playerId: hostInfo.playerId, // suplantación del host
      actionType: 'DISCARD',
      payload: { cardIds: [hostDto.me.hand[0]!.id] },
    });
    expect((await p).code).toBe('IDENTITY_MISMATCH');
  });

  it('room:reconnect restaura al jugador y reenvía su estado', async () => {
    const { host, guest, hostInfo, guestInfo } = await startedGame();
    guest.disconnect();
    await new Promise((r) => setTimeout(r, 50));

    const fresh = await newClient();
    const joined = once(fresh, 'room:joined_success');
    const sync = once(fresh, 'game:state_sync');
    fresh.emit('room:reconnect', {
      roomId: hostInfo.roomId,
      playerId: guestInfo.playerId,
      sessionToken: guestInfo.sessionToken,
    });
    expect((await joined).playerId).toBe(guestInfo.playerId);
    expect((await sync).me.playerId).toBe(guestInfo.playerId);
    void host;
  });

  it('room:reconnect con token inválido es rechazado', async () => {
    const { hostInfo, guestInfo } = await lobby();
    const fresh = await newClient();
    const err = once(fresh, 'game:action_error');
    fresh.emit('room:reconnect', {
      roomId: hostInfo.roomId,
      playerId: guestInfo.playerId,
      sessionToken: 'nope',
    });
    expect((await err).code).toBe('INVALID_SESSION');
  });

  it('Auto-Pass: al expirar el temporizador descarta una carta y avanza el turno', async () => {
    const { host, guest, hostDto, hostInfo, guestInfo } = await startedGame();
    const room = server.rooms.getRoom(hostInfo.roomId)!;
    room.state.config.turnTimeoutSeconds = 0.1;

    // Una jugada válida del host reprograma el timer (ahora de 100 ms) para el turno del invitado.
    const autoPassed = new Promise<ClientGameStateDTO>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for AUTO_PASS')), 3_000);
      host.on('game:state_sync', (s) => {
        if (s.lastActionLog?.actionType === 'AUTO_PASS') {
          clearTimeout(timer);
          resolve(s);
        }
      });
    });
    host.emit('game:action', {
      roomId: hostInfo.roomId,
      playerId: hostInfo.playerId,
      actionType: 'DISCARD',
      payload: { cardIds: [hostDto.me.hand[0]!.id] },
    });

    const afterAutoPass = await autoPassed;
    void guest;
    expect(afterAutoPass.lastActionLog?.actionType).toBe('AUTO_PASS');
    expect(afterAutoPass.lastActionLog?.actorId).toBe(guestInfo.playerId);
    expect(afterAutoPass.turnState.currentPlayerId).toBe(hostInfo.playerId);
  });

  it('game:rematch solo se acepta con la partida FINISHED', async () => {
    const { host, hostInfo } = await startedGame();
    const err = once(host, 'game:action_error');
    host.emit('game:rematch', { roomId: hostInfo.roomId });
    expect((await err).code).toBe('INVALID_ROOM_STATE');
  });
});
