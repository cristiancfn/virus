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

/** Como `once`, pero ignora eventos rezagados hasta que `predicate` se cumpla. */
function waitFor<E extends keyof ServerToClientEvents>(
  c: Client,
  event: E,
  predicate: (payload: Parameters<ServerToClientEvents[E]>[0]) => boolean,
  timeoutMs = 2_000,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c as any).off(event, listener);
      reject(new Error(`timeout waiting for ${event} matching predicate`));
    }, timeoutMs);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const listener = (payload: any): void => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c as any).off(event, listener);
      resolve(payload);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c as any).on(event, listener);
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

describe('turnTimeoutSeconds parametrizable', () => {
  it('room:create sin turnTimeoutSeconds usa 45 y lo expone en room:updated y game:state_sync', async () => {
    const host = await newClient();
    const updated = once(host, 'room:updated');
    host.emit('room:create', { nickname: 'Ana' });
    expect((await updated).config).toEqual({ turnTimeoutSeconds: 45 });
  });

  it('room:create acepta un valor personalizado y lo propaga al DTO de la partida', async () => {
    const host = await newClient();
    const guest = await newClient();

    const updated = once(host, 'room:updated');
    const joined = once(host, 'room:joined_success');
    host.emit('room:create', { nickname: 'Ana', turnTimeoutSeconds: 90 });
    const info = await joined;
    expect((await updated).config.turnTimeoutSeconds).toBe(90);

    const guestJoined = once(guest, 'room:joined_success');
    guest.emit('room:join', { roomId: info.roomId, nickname: 'Beto' });
    await guestJoined;

    const hostState = once(host, 'game:state_sync');
    host.emit('game:start', { roomId: info.roomId });
    const dto = await hostState;
    expect(dto.config).toEqual({ turnTimeoutSeconds: 90 });
    expect(dto.turnState.turnRemainingSeconds).toBeLessThanOrEqual(90);
    expect(dto.turnState.turnRemainingSeconds).toBeGreaterThan(45);
  });

  it.each([14, 121, 30.5, '45', 0, -20])(
    'room:create rechaza turnTimeoutSeconds inválido (%s) con INVALID_PAYLOAD',
    async (bad) => {
      const c = await newClient();
      const err = once(c, 'game:action_error');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c as any).emit('room:create', { nickname: 'Ana', turnTimeoutSeconds: bad });
      expect((await err).code).toBe('INVALID_PAYLOAD');
    },
  );

  it.each([15, 120])('room:create acepta los límites del rango (%s)', async (value) => {
    const c = await newClient();
    const updated = once(c, 'room:updated');
    c.emit('room:create', { nickname: 'Ana', turnTimeoutSeconds: value });
    expect((await updated).config.turnTimeoutSeconds).toBe(value);
  });
});

describe('room:leave y desconexión en WAITING', () => {
  it('room:leave de un invitado lo elimina de players y notifica al resto', async () => {
    const { host, guest, hostInfo } = await lobby();
    const updated = waitFor(host, 'room:updated', (p) => p.players.length === 1);
    guest.emit('room:leave', { roomId: hostInfo.roomId });
    const payload = await updated;
    expect(payload.players).toHaveLength(1);
    expect(payload.players[0]?.nickname).toBe('Ana');
    expect(server.rooms.getRoom(hostInfo.roomId)?.state.players).toHaveLength(1);
  });

  it('room:leave del host transfiere el rol de host al jugador restante', async () => {
    const { host, guestInfo, hostInfo, guest } = await lobby();
    const updated = waitFor(guest, 'room:updated', (p) => p.players.length === 1);
    host.emit('room:leave', { roomId: hostInfo.roomId });
    const payload = await updated;
    expect(payload.players).toEqual([
      { playerId: guestInfo.playerId, nickname: 'Beto', isHost: true, isConnected: true },
    ]);
  });

  it('si el último jugador sale, la sala se elimina', async () => {
    const host = await newClient();
    const joined = once(host, 'room:joined_success');
    host.emit('room:create', { nickname: 'Ana' });
    const info = await joined;

    host.emit('room:leave', { roomId: info.roomId });
    await new Promise((r) => setTimeout(r, 50));
    expect(server.rooms.getRoom(info.roomId)).toBeUndefined();
  });

  it('tras salir, el socket puede crear o unirse a otra sala', async () => {
    const { guest, hostInfo } = await lobby();
    guest.emit('room:leave', { roomId: hostInfo.roomId });
    await new Promise((r) => setTimeout(r, 50));

    const joined = once(guest, 'room:joined_success');
    guest.emit('room:create', { nickname: 'Beto' });
    expect((await joined).roomId).not.toBe(hostInfo.roomId);
  });

  it('room:leave de una sala ajena o sin pertenecer emite NOT_IN_ROOM', async () => {
    const { guest } = await lobby();
    const err = once(guest, 'game:action_error');
    guest.emit('room:leave', { roomId: 'ZZZZZZ' });
    expect((await err).code).toBe('NOT_IN_ROOM');

    const stranger = await newClient();
    const err2 = once(stranger, 'game:action_error');
    stranger.emit('room:leave', { roomId: 'ZZZZZZ' });
    expect((await err2).code).toBe('NOT_IN_ROOM');
  });

  it('room:leave con payload inválido emite INVALID_PAYLOAD', async () => {
    const c = await newClient();
    const err = once(c, 'game:action_error');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c as any).emit('room:leave', { roomId: 'abc' });
    expect((await err).code).toBe('INVALID_PAYLOAD');
  });

  it('un invitado que se desconecta en WAITING se elimina inmediatamente', async () => {
    const { host, guest, hostInfo } = await lobby();
    const updated = waitFor(host, 'room:updated', (p) => p.players.length === 1);
    guest.disconnect();
    expect((await updated).players).toHaveLength(1);
    expect(server.rooms.getRoom(hostInfo.roomId)?.state.players).toHaveLength(1);
  });
});

describe('Host en partida IN_PROGRESS y reclamación de asiento', () => {
  it('room:leave en IN_PROGRESS conserva al jugador desconectado y migra el host', async () => {
    const { host, guest, hostInfo, guestInfo } = await startedGame();
    const sync = once(guest, 'game:state_sync');
    host.emit('room:leave', { roomId: hostInfo.roomId });
    const dto = await sync;
    expect(dto.me.playerId).toBe(guestInfo.playerId);
    expect(dto.me.isHost).toBe(true);
    expect(dto.opponents[0]).toMatchObject({
      playerId: hostInfo.playerId,
      isHost: false,
      isConnected: false,
    });
  });

  it('la desconexión del host en IN_PROGRESS migra el host a un jugador conectado', async () => {
    const { host, guest, guestInfo } = await startedGame();
    const updated = waitFor(guest, 'room:updated', (p) => p.players.some((x) => !x.isConnected));
    host.disconnect();
    const payload = await updated;
    const connectedHosts = payload.players.filter((p) => p.isHost && p.isConnected);
    expect(connectedHosts.map((p) => p.playerId)).toEqual([guestInfo.playerId]);
  });

  it('room:join con un nickname conectado (case-insensitive) emite NICKNAME_TAKEN', async () => {
    const { hostInfo } = await lobby();
    const intruder = await newClient();
    const err = once(intruder, 'game:action_error');
    intruder.emit('room:join', { roomId: hostInfo.roomId, nickname: ' bETO ' });
    const payload = await err;
    expect(payload.code).toBe('NICKNAME_TAKEN');
    expect(payload.message).toBe('Ya existe un jugador conectado con ese nombre en la sala');
  });

  it('room:join reclama el asiento desconectado en IN_PROGRESS y reenvía game:state_sync', async () => {
    const { host, guest, hostInfo, guestInfo, guestDto } = await startedGame();
    const offline = waitFor(host, 'room:updated', (p) => p.players.some((x) => !x.isConnected));
    guest.disconnect();
    await offline;

    const claimer = await newClient();
    const joined = once(claimer, 'room:joined_success');
    const sync = once(claimer, 'game:state_sync');
    const hostSeesBack = waitFor(host, 'room:updated', (p) => p.players.every((x) => x.isConnected));
    claimer.emit('room:join', { roomId: hostInfo.roomId, nickname: 'beto' });

    const info = await joined;
    expect(info.playerId).toBe(guestInfo.playerId);
    expect(info.sessionToken).toBe(guestInfo.sessionToken);

    const dto = await sync;
    expect(dto.me.playerId).toBe(guestInfo.playerId);
    expect(dto.me.hand).toEqual(guestDto.me.hand);

    const roster = await hostSeesBack;
    expect(roster.players).toHaveLength(2);
    expect(roster.players.every((p) => p.isConnected)).toBe(true);
  });

  it('un nickname nuevo no puede unirse a una partida IN_PROGRESS', async () => {
    const { hostInfo } = await startedGame();
    const late = await newClient();
    const err = once(late, 'game:action_error');
    late.emit('room:join', { roomId: hostInfo.roomId, nickname: 'Carla' });
    expect((await err).code).toBe('ROOM_NOT_JOINABLE');
  });

  it('reactiva el temporizador de turno si todos estaban desconectados', async () => {
    const { host, guest, hostInfo } = await startedGame();
    const room = server.rooms.getRoom(hostInfo.roomId)!;
    room.state.config.turnTimeoutSeconds = 0.1;

    guest.disconnect();
    host.disconnect();
    await new Promise((r) => setTimeout(r, 200));
    // Con todos desconectados no hay Auto-Pass en vacío.
    expect(room.state.turnState.turnNumber).toBe(1);

    const claimer = await newClient();
    const autoPassed = new Promise<ClientGameStateDTO>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for AUTO_PASS')), 3_000);
      claimer.on('game:state_sync', (s) => {
        if (s.lastActionLog?.actionType === 'AUTO_PASS') {
          clearTimeout(timer);
          resolve(s);
        }
      });
    });
    claimer.emit('room:join', { roomId: hostInfo.roomId, nickname: 'ana' });
    expect((await autoPassed).lastActionLog?.actionType).toBe('AUTO_PASS');
  });
});

describe('game:force_skip', () => {
  /** Partida iniciada; el host descarta para pasar el turno al invitado. */
  async function guestTurn() {
    const g = await startedGame();
    const guestSync = once(g.guest, 'game:state_sync');
    const hostSync = once(g.host, 'game:state_sync');
    g.host.emit('game:action', {
      roomId: g.hostInfo.roomId,
      playerId: g.hostInfo.playerId,
      actionType: 'DISCARD',
      payload: { cardIds: [g.hostDto.me.hand[0]!.id] },
    });
    await Promise.all([guestSync, hostSync]);
    return g;
  }

  it('el host fuerza el Auto-Pass inmediato del jugador activo desconectado', async () => {
    const { host, guest, hostInfo, guestInfo } = await guestTurn();
    const offline = once(host, 'game:state_sync');
    guest.disconnect();
    expect((await offline).opponents[0]?.isConnected).toBe(false);

    const sync = once(host, 'game:state_sync');
    host.emit('game:force_skip', { roomId: hostInfo.roomId });
    const dto = await sync;
    expect(dto.lastActionLog).toMatchObject({
      actionType: 'AUTO_PASS',
      actorId: guestInfo.playerId,
    });
    expect(dto.turnState.currentPlayerId).toBe(hostInfo.playerId);
    expect(dto.turnState.isMyTurn).toBe(true);
  });

  it('rechaza con PLAYER_STILL_CONNECTED si el jugador activo está conectado', async () => {
    const { host, hostInfo } = await startedGame();
    const err = once(host, 'game:action_error');
    host.emit('game:force_skip', { roomId: hostInfo.roomId });
    expect((await err).code).toBe('PLAYER_STILL_CONNECTED');
  });

  it('rechaza con NOT_HOST a un jugador que no es host', async () => {
    const { guest, hostInfo } = await startedGame();
    const err = once(guest, 'game:action_error');
    guest.emit('game:force_skip', { roomId: hostInfo.roomId });
    expect((await err).code).toBe('NOT_HOST');
  });

  it('rechaza fuera de IN_PROGRESS y con payload inválido', async () => {
    const { host, hostInfo } = await lobby();
    const err = once(host, 'game:action_error');
    host.emit('game:force_skip', { roomId: hostInfo.roomId });
    expect((await err).code).toBe('INVALID_ROOM_STATE');

    const bad = once(host, 'game:action_error');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (host as any).emit('game:force_skip', { roomId: hostInfo.roomId, extra: 1 });
    expect((await bad).code).toBe('INVALID_PAYLOAD');
  });

  it('rechaza con NOT_IN_ROOM a un socket que no pertenece a la sala', async () => {
    const { hostInfo } = await startedGame();
    const stranger = await newClient();
    const err = once(stranger, 'game:action_error');
    stranger.emit('game:force_skip', { roomId: hostInfo.roomId });
    expect((await err).code).toBe('NOT_IN_ROOM');
  });
});
