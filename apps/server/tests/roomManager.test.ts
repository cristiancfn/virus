import { describe, expect, it, vi } from 'vitest';
import {
  GC_ALL_DISCONNECTED_MS,
  GC_IDLE_MS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from '@virus/shared';
import { RoomManager } from '../src/rooms/roomManager';
import type { Room } from '../src/rooms/roomManager';

function setup(start = 1_000_000) {
  const clock = { t: start };
  const removed: string[] = [];
  const manager = new RoomManager({
    now: () => clock.t,
    onRoomRemoved: (id) => removed.push(id),
  });
  return { manager, clock, removed };
}

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok result, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
}

/** Crea una sala con host + (n-1) invitados; devuelve la sala y los jugadores. */
function roomWith(manager: RoomManager, n: number) {
  const created = ok(manager.createRoom('Host', 'sock-0'));
  const players = [created.player];
  for (let i = 1; i < n; i++) {
    players.push(ok(manager.joinRoom(created.room.roomId, `P${i}`, `sock-${i}`)).player);
  }
  return { room: created.room as Room, players };
}

describe('RoomManager - códigos de sala', () => {
  it('genera códigos de 6 caracteres del alfabeto permitido', () => {
    const { manager } = setup();
    for (let i = 0; i < 200; i++) {
      const code = manager.generateRoomCode() as string;
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
      expect(code).not.toMatch(/[01OIL]/);
    }
  });

  it('reintenta si el código ya existe', () => {
    const seq = [0, 0, 0, 0, 0, 0, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99];
    let i = 0;
    const manager = new RoomManager({ rng: () => seq[i++ % seq.length] as number });
    const a = ok(manager.createRoom('A', 's1'));
    const b = ok(manager.createRoom('B', 's2'));
    expect(a.room.roomId).not.toBe(b.room.roomId);
  });
});

describe('RoomManager - crear y unirse', () => {
  it('createRoom deja al creador como host en WAITING con credenciales privadas', () => {
    const { manager } = setup();
    const { room, player } = ok(manager.createRoom('Ana', 'sock-1'));
    expect(room.state.status).toBe('WAITING');
    expect(player.isHost).toBe(true);
    expect(player.playerId).not.toBe('sock-1'); // identidad desacoplada del socket
    expect(player.sessionToken.length).toBeGreaterThan(16);
    expect(manager.getBySocket('sock-1')?.player.playerId).toBe(player.playerId);
  });

  it('joinRoom agrega jugadores y rechaza sala inexistente, llena o ya iniciada', () => {
    const { manager } = setup();
    const { room } = roomWith(manager, 6);
    expect(room.state.players).toHaveLength(6);

    const full = manager.joinRoom(room.roomId, 'Extra', 'sock-x');
    expect(full).toMatchObject({ ok: false, error: { code: 'ROOM_FULL' } });

    const missing = manager.joinRoom('ZZZZZZ', 'X', 'sock-y');
    expect(missing).toMatchObject({ ok: false, error: { code: 'ROOM_NOT_FOUND' } });

    ok(manager.startGame(room.roomId, room.state.players[0]!.playerId));
    const late = manager.joinRoom(room.roomId, 'Late', 'sock-z');
    expect(late).toMatchObject({ ok: false, error: { code: 'ROOM_NOT_JOINABLE' } });
  });
});

describe('RoomManager - reconexión por sessionToken', () => {
  it('reconecta con el token correcto y reemplaza el socket anterior', () => {
    const { manager } = setup();
    const { room, players } = roomWith(manager, 2);
    const guest = players[1]!;
    ok(manager.startGame(room.roomId, players[0]!.playerId));
    manager.handleDisconnect('sock-1');
    expect(room.state.players[1]!.isConnected).toBe(false);

    const res = ok(manager.reconnect(room.roomId, guest.playerId, guest.sessionToken, 'sock-new'));
    expect(res.player.isConnected).toBe(true);
    expect(res.player.socketId).toBe('sock-new');
    expect(manager.getBySocket('sock-new')?.player.playerId).toBe(guest.playerId);
    expect(manager.getBySocket('sock-1')).toBeUndefined();
  });

  it('rechaza token inválido, playerId desconocido o sala inexistente', () => {
    const { manager } = setup();
    const { room, players } = roomWith(manager, 2);
    const guest = players[1]!;

    expect(manager.reconnect(room.roomId, guest.playerId, 'bad-token', 's')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_SESSION' },
    });
    expect(manager.reconnect(room.roomId, 'nobody', guest.sessionToken, 's')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_SESSION' },
    });
    expect(manager.reconnect('ZZZZZZ', guest.playerId, guest.sessionToken, 's')).toMatchObject({
      ok: false,
      error: { code: 'ROOM_NOT_FOUND' },
    });
  });

  it('el socketId nunca autentica: un token ajeno no sirve aunque el playerId sea válido', () => {
    const { manager } = setup();
    const { room, players } = roomWith(manager, 2);
    const result = manager.reconnect(
      room.roomId,
      players[1]!.playerId,
      players[0]!.sessionToken,
      'attacker',
    );
    expect(result.ok).toBe(false);
  });

  it('un disconnect tardío del socket viejo no marca desconectado al jugador reconectado', () => {
    const { manager } = setup();
    const { room, players } = roomWith(manager, 2);
    const guest = players[1]!;
    ok(manager.reconnect(room.roomId, guest.playerId, guest.sessionToken, 'sock-new'));

    expect(manager.handleDisconnect('sock-1')).toBeNull();
    expect(guest.isConnected).toBe(true);
  });
});

describe('RoomManager - desconexión y migración de host', () => {
  it('migra el host al siguiente jugador conectado en WAITING', () => {
    const { manager } = setup();
    const { room, players } = roomWith(manager, 3);

    const res = manager.handleDisconnect('sock-0');
    expect(res).toMatchObject({ roomDeleted: false, newHostId: players[1]!.playerId });
    expect(players[0]!.isHost).toBe(false);
    expect(players[1]!.isHost).toBe(true);
    expect(room.state.players.filter((p) => p.isHost)).toHaveLength(1);
  });

  it('salta jugadores ya desconectados al migrar el host', () => {
    const { manager } = setup();
    const { players } = roomWith(manager, 3);
    manager.handleDisconnect('sock-1');
    const res = manager.handleDisconnect('sock-0');
    expect(res?.newHostId).toBe(players[2]!.playerId);
  });

  it('no migra el host si se desconecta un invitado', () => {
    const { manager } = setup();
    const { players } = roomWith(manager, 2);
    const res = manager.handleDisconnect('sock-1');
    expect(res?.newHostId).toBeNull();
    expect(players[0]!.isHost).toBe(true);
  });

  it('elimina la sala inmediatamente si todos se desconectan en WAITING', () => {
    const { manager, removed } = setup();
    const { room } = roomWith(manager, 2);
    manager.handleDisconnect('sock-0');
    const res = manager.handleDisconnect('sock-1');
    expect(res?.roomDeleted).toBe(true);
    expect(manager.getRoom(room.roomId)).toBeUndefined();
    expect(removed).toEqual([room.roomId]);
  });

  it('en IN_PROGRESS conserva la sala y migra el host al primer jugador conectado', () => {
    const { manager, clock } = setup();
    const { room, players } = roomWith(manager, 3);
    ok(manager.startGame(room.roomId, players[0]!.playerId));

    const res = manager.handleDisconnect('sock-0');
    expect(res).toMatchObject({ roomDeleted: false, playerRemoved: false });
    expect(res?.newHostId).toBe(players[1]!.playerId);
    expect(room.state.players.find((p) => p.playerId === players[0]!.playerId)).toMatchObject({
      isHost: false,
      isConnected: false,
    });
    expect(room.state.players.filter((p) => p.isHost)).toHaveLength(1);
    expect(room.state.players.find((p) => p.isHost)?.isConnected).toBe(true);
    expect(room.allDisconnectedSince).toBeNull();

    // Si el nuevo host también se va, el rol pasa al siguiente conectado.
    expect(manager.handleDisconnect('sock-1')?.newHostId).toBe(players[2]!.playerId);

    clock.t += 5;
    const last = manager.handleDisconnect('sock-2');
    expect(last?.roomDeleted).toBe(false);
    expect(manager.getRoom(room.roomId)).toBeDefined();
    expect(room.allDisconnectedSince).toBe(clock.t);
    expect(room.state.players).toHaveLength(3);
  });

  it('si todos se desconectan en IN_PROGRESS el primero en reconectarse asume isHost', () => {
    const { manager } = setup();
    const { room, players } = roomWith(manager, 3);
    ok(manager.startGame(room.roomId, players[0]!.playerId));
    manager.handleDisconnect('sock-1');
    manager.handleDisconnect('sock-0');
    manager.handleDisconnect('sock-2');

    const back = ok(
      manager.reconnect(room.roomId, players[2]!.playerId, players[2]!.sessionToken, 'sock-r'),
    );
    expect(back.player.isHost).toBe(true);
    expect(room.state.players.filter((p) => p.isHost)).toHaveLength(1);

    // Un segundo jugador que reconecta después NO le quita el host al primero.
    ok(manager.reconnect(room.roomId, players[1]!.playerId, players[1]!.sessionToken, 'sock-r2'));
    expect(room.state.players[2]!.isHost).toBe(true);
    expect(room.state.players[1]!.isHost).toBe(false);
  });

  it('el host original conserva el rol si reconecta antes que nadie', () => {
    const { manager } = setup();
    const { room, players } = roomWith(manager, 2);
    ok(manager.startGame(room.roomId, players[0]!.playerId));
    manager.handleDisconnect('sock-1');
    manager.handleDisconnect('sock-0');
    ok(manager.reconnect(room.roomId, players[0]!.playerId, players[0]!.sessionToken, 'sock-r'));
    expect(room.state.players[0]!.isHost).toBe(true);
    expect(room.state.players[1]!.isHost).toBe(false);
  });
});

describe('RoomManager - salida y desconexión en WAITING (SPEC §6)', () => {
  it('un invitado que se desconecta se elimina inmediatamente de players', () => {
    const { manager } = setup();
    const { room, players } = roomWith(manager, 3);
    const res = manager.handleDisconnect('sock-1');
    expect(res).toMatchObject({ playerRemoved: true, roomDeleted: false, newHostId: null });
    expect(room.state.players.map((p) => p.playerId)).toEqual([
      players[0]!.playerId,
      players[2]!.playerId,
    ]);
    expect(manager.getBySocket('sock-1')).toBeUndefined();
  });

  it('room:leave en WAITING elimina al jugador igual que una desconexión', () => {
    const { manager } = setup();
    const { room, players } = roomWith(manager, 2);
    const res = manager.leaveRoom('sock-1');
    expect(res).toMatchObject({ playerRemoved: true, roomDeleted: false });
    expect(room.state.players).toHaveLength(1);
    expect(room.state.players[0]!.playerId).toBe(players[0]!.playerId);
    expect(manager.leaveRoom('sock-1')).toBeNull();
  });

  it('si sale el host se transfiere isHost al siguiente jugador restante', () => {
    const { manager } = setup();
    const { room, players } = roomWith(manager, 3);
    const res = manager.leaveRoom('sock-0');
    expect(res?.newHostId).toBe(players[1]!.playerId);
    expect(room.state.players.map((p) => p.playerId)).toEqual([
      players[1]!.playerId,
      players[2]!.playerId,
    ]);
    expect(room.state.players.filter((p) => p.isHost)).toHaveLength(1);
    expect(players[1]!.isHost).toBe(true);
  });

  it('si la sala queda vacía se elimina del Map', () => {
    const { manager, removed } = setup();
    const { room } = roomWith(manager, 1);
    const res = manager.leaveRoom('sock-0');
    expect(res).toMatchObject({ roomDeleted: true, playerRemoved: true });
    expect(manager.getRoom(room.roomId)).toBeUndefined();
    expect(removed).toEqual([room.roomId]);
  });

  it('el jugador eliminado no puede reconectarse con su antiguo sessionToken', () => {
    const { manager } = setup();
    const { room, players } = roomWith(manager, 2);
    manager.leaveRoom('sock-1');
    expect(
      manager.reconnect(room.roomId, players[1]!.playerId, players[1]!.sessionToken, 's'),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_SESSION' } });
  });

  it('room:leave en IN_PROGRESS conserva el asiento con isConnected = false', () => {
    const { manager } = setup();
    const { room, players } = roomWith(manager, 2);
    ok(manager.startGame(room.roomId, players[0]!.playerId));
    const res = manager.leaveRoom('sock-1');
    expect(res).toMatchObject({ playerRemoved: false, roomDeleted: false });
    expect(room.state.players).toHaveLength(2);
    expect(room.state.players[1]).toMatchObject({ isConnected: false, socketId: null });
  });
});

describe('RoomManager - turnTimeoutSeconds parametrizable', () => {
  it('createRoom usa 45 s por defecto y acepta un valor personalizado', () => {
    const { manager } = setup();
    expect(ok(manager.createRoom('A', 's1')).room.state.config.turnTimeoutSeconds).toBe(45);
    const custom = ok(manager.createRoom('B', 's2', 90));
    expect(custom.room.state.config.turnTimeoutSeconds).toBe(90);
    expect(manager.toRoomUpdated(custom.room).config).toEqual({ turnTimeoutSeconds: 90 });
  });

  it('el valor configurado se conserva al iniciar la partida y en la revancha', () => {
    const { manager } = setup();
    const created = ok(manager.createRoom('Host', 'sock-0', 20));
    const roomId = created.room.roomId;
    ok(manager.joinRoom(roomId, 'P1', 'sock-1'));
    ok(manager.startGame(roomId, created.player.playerId));
    expect(created.room.state.config.turnTimeoutSeconds).toBe(20);

    created.room.state.status = 'FINISHED';
    ok(manager.startRematch(roomId, created.player.playerId));
    expect(created.room.state.config.turnTimeoutSeconds).toBe(20);
  });
});

describe('RoomManager - reclamación de asiento por nickname (SPEC §6)', () => {
  it('rechaza con NICKNAME_TAKEN si el nickname (case-insensitive) está conectado', () => {
    const { manager } = setup();
    const { room } = roomWith(manager, 2);
    for (const nick of ['p1', 'P1', '  P1  ', 'host']) {
      expect(manager.joinRoom(room.roomId, nick, 'sock-new')).toMatchObject({
        ok: false,
        error: {
          code: 'NICKNAME_TAKEN',
          message: 'Ya existe un jugador conectado con ese nombre en la sala',
        },
      });
    }
    expect(room.state.players).toHaveLength(2);
  });

  it('también rechaza NICKNAME_TAKEN en IN_PROGRESS si el jugador sigue conectado', () => {
    const { manager } = setup();
    const { room, players } = roomWith(manager, 2);
    ok(manager.startGame(room.roomId, players[0]!.playerId));
    expect(manager.joinRoom(room.roomId, 'p1', 'sock-x')).toMatchObject({
      ok: false,
      error: { code: 'NICKNAME_TAKEN' },
    });
  });

  it('reclama el asiento de un jugador desconectado en IN_PROGRESS sin duplicarlo', () => {
    const { manager } = setup();
    const { room, players } = roomWith(manager, 3);
    ok(manager.startGame(room.roomId, players[0]!.playerId));
    manager.handleDisconnect('sock-1');
    expect(room.state.players[1]!.isConnected).toBe(false);

    const res = ok(manager.joinRoom(room.roomId, '  p1 ', 'sock-claim'));
    expect(res.claimed).toBe(true);
    expect(res.player.playerId).toBe(players[1]!.playerId);
    expect(res.player.sessionToken).toBe(players[1]!.sessionToken);
    expect(res.player).toMatchObject({ isConnected: true, socketId: 'sock-claim' });
    expect(room.state.players).toHaveLength(3);
    expect(manager.getBySocket('sock-claim')?.player.playerId).toBe(players[1]!.playerId);
  });

  it('conserva mano y cuerpo del asiento reclamado', () => {
    const { manager } = setup();
    const { room, players } = roomWith(manager, 2);
    ok(manager.startGame(room.roomId, players[0]!.playerId));
    const hand = [...room.state.players[1]!.hand];
    manager.handleDisconnect('sock-1');
    const res = ok(manager.joinRoom(room.roomId, 'P1', 'sock-claim'));
    expect(res.player.hand).toEqual(hand);
  });

  it('reclama en estado FINISHED, pero un nickname nuevo sigue sin poder entrar', () => {
    const { manager } = setup();
    const { room, players } = roomWith(manager, 2);
    ok(manager.startGame(room.roomId, players[0]!.playerId));
    room.state.status = 'FINISHED';
    manager.handleDisconnect('sock-1');

    expect(ok(manager.joinRoom(room.roomId, 'p1', 'sock-c')).claimed).toBe(true);
    expect(manager.joinRoom(room.roomId, 'Nuevo', 'sock-n')).toMatchObject({
      ok: false,
      error: { code: 'ROOM_NOT_JOINABLE' },
    });
  });

  it('un nickname nuevo se une como jugador nuevo solo en WAITING con cupo', () => {
    const { manager } = setup();
    const { room } = roomWith(manager, 2);
    const res = ok(manager.joinRoom(room.roomId, 'Nuevo', 'sock-n'));
    expect(res.claimed).toBe(false);
    expect(room.state.players).toHaveLength(3);
  });

  it('reclamar un asiento reactiva la sala (cancela allDisconnectedSince)', () => {
    const { manager, clock } = setup();
    const { room, players } = roomWith(manager, 2);
    ok(manager.startGame(room.roomId, players[0]!.playerId));
    manager.handleDisconnect('sock-0');
    clock.t += 10;
    manager.handleDisconnect('sock-1');
    expect(room.allDisconnectedSince).not.toBeNull();

    ok(manager.joinRoom(room.roomId, 'p1', 'sock-claim'));
    expect(room.allDisconnectedSince).toBeNull();
    // El reclamante asume el host porque nadie conectado lo tenía.
    expect(room.state.players[1]!.isHost).toBe(true);
    expect(room.state.players[0]!.isHost).toBe(false);
  });
});

describe('RoomManager - validateForceSkip (SPEC §6)', () => {
  function started() {
    const { manager } = setup();
    const { room, players } = roomWith(manager, 3);
    ok(manager.startGame(room.roomId, players[0]!.playerId));
    return { manager, room, players };
  }

  it('acepta al host cuando el jugador activo está desconectado', () => {
    const { manager, room, players } = started();
    // Turno del host (players[0]); pasamos el turno a P1 y lo desconectamos.
    room.state.turnState.currentPlayerId = players[1]!.playerId;
    manager.handleDisconnect('sock-1');
    const res = ok(manager.validateForceSkip(room.roomId, players[0]!.playerId));
    expect(res.targetPlayerId).toBe(players[1]!.playerId);
  });

  it('rechaza si el jugador activo sigue conectado', () => {
    const { manager, room, players } = started();
    expect(manager.validateForceSkip(room.roomId, players[0]!.playerId)).toMatchObject({
      ok: false,
      error: { code: 'PLAYER_STILL_CONNECTED' },
    });
  });

  it('rechaza a quien no es host', () => {
    const { manager, room, players } = started();
    room.state.turnState.currentPlayerId = players[1]!.playerId;
    manager.handleDisconnect('sock-1');
    expect(manager.validateForceSkip(room.roomId, players[2]!.playerId)).toMatchObject({
      ok: false,
      error: { code: 'NOT_HOST' },
    });
  });

  it('rechaza fuera de IN_PROGRESS, sala inexistente o jugador ajeno', () => {
    const { manager, room, players } = started();
    expect(manager.validateForceSkip('ZZZZZZ', players[0]!.playerId)).toMatchObject({
      error: { code: 'ROOM_NOT_FOUND' },
    });
    expect(manager.validateForceSkip(room.roomId, 'ghost')).toMatchObject({
      error: { code: 'NOT_IN_ROOM' },
    });
    room.state.status = 'FINISHED';
    expect(manager.validateForceSkip(room.roomId, players[0]!.playerId)).toMatchObject({
      error: { code: 'INVALID_ROOM_STATE' },
    });
  });
});

describe('RoomManager - inicio de partida y revancha', () => {
  it('solo el host puede iniciar y se requieren al menos 2 jugadores conectados', () => {
    const { manager } = setup();
    const { room, players } = roomWith(manager, 2);

    expect(manager.startGame(room.roomId, players[1]!.playerId)).toMatchObject({
      ok: false,
      error: { code: 'NOT_HOST' },
    });

    manager.handleDisconnect('sock-1');
    expect(manager.startGame(room.roomId, players[0]!.playerId)).toMatchObject({
      ok: false,
      error: { code: 'NOT_ENOUGH_PLAYERS' },
    });
  });

  it('reparte 3 cartas a cada jugador y descarta a los desconectados', () => {
    const { manager } = setup();
    const { room, players } = roomWith(manager, 4);
    manager.handleDisconnect('sock-3');

    ok(manager.startGame(room.roomId, players[0]!.playerId));
    expect(room.state.status).toBe('IN_PROGRESS');
    expect(room.state.players).toHaveLength(3);
    for (const p of room.state.players) expect(p.hand).toHaveLength(3);
    expect(room.state.turnState.currentPlayerId).toBe(players[0]!.playerId);
  });

  it('startGame falla si la sala ya está en curso', () => {
    const { manager } = setup();
    const { room, players } = roomWith(manager, 2);
    ok(manager.startGame(room.roomId, players[0]!.playerId));
    expect(manager.startGame(room.roomId, players[0]!.playerId)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ROOM_STATE' },
    });
  });

  it('startRematch solo funciona en FINISHED y reinicia manos y mazo', () => {
    const { manager } = setup();
    const { room, players } = roomWith(manager, 2);
    ok(manager.startGame(room.roomId, players[0]!.playerId));
    expect(manager.startRematch(room.roomId, players[0]!.playerId)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ROOM_STATE' },
    });

    room.state.status = 'FINISHED';
    room.state.winnerId = players[1]!.playerId;
    ok(manager.startRematch(room.roomId, players[0]!.playerId));
    expect(room.state.status).toBe('IN_PROGRESS');
    expect(room.state.winnerId).toBeNull();
    expect(room.state.players.every((p) => p.hand.length === 3 && p.body.length === 0)).toBe(true);
  });
});

describe('RoomManager - Garbage Collector', () => {
  it('elimina salas con todos desconectados más de 10 minutos', () => {
    const { manager, clock, removed } = setup();
    const { room, players } = roomWith(manager, 2);
    ok(manager.startGame(room.roomId, players[0]!.playerId));
    manager.handleDisconnect('sock-0');
    manager.handleDisconnect('sock-1');

    clock.t += GC_ALL_DISCONNECTED_MS - 1;
    expect(manager.sweep()).toEqual([]);
    clock.t += 2;
    expect(manager.sweep()).toEqual([room.roomId]);
    expect(removed).toContain(room.roomId);
  });

  it('una reconexión cancela el contador de abandono', () => {
    const { manager, clock } = setup();
    const { room, players } = roomWith(manager, 2);
    ok(manager.startGame(room.roomId, players[0]!.playerId));
    manager.handleDisconnect('sock-0');
    manager.handleDisconnect('sock-1');
    clock.t += GC_ALL_DISCONNECTED_MS - 10;
    ok(manager.reconnect(room.roomId, players[0]!.playerId, players[0]!.sessionToken, 'sock-r'));

    clock.t += GC_ALL_DISCONNECTED_MS;
    expect(manager.sweep()).toEqual([]);
  });

  it('elimina salas WAITING/FINISHED inactivas más de 30 minutos', () => {
    const { manager, clock } = setup();
    const waiting = roomWith(manager, 1).room;
    const finished = ok(manager.createRoom('F', 'sock-f1'));
    ok(manager.joinRoom(finished.room.roomId, 'G', 'sock-f2'));
    ok(manager.startGame(finished.room.roomId, finished.player.playerId));
    finished.room.state.status = 'FINISHED';

    clock.t += GC_IDLE_MS + 1;
    const swept = manager.sweep();
    expect(swept).toContain(waiting.roomId);
    expect(swept).toContain(finished.room.roomId);
  });

  it('no elimina partidas IN_PROGRESS con jugadores conectados aunque lleven mucho tiempo', () => {
    const { manager, clock } = setup();
    const { room, players } = roomWith(manager, 2);
    ok(manager.startGame(room.roomId, players[0]!.playerId));
    clock.t += GC_IDLE_MS * 3;
    expect(manager.sweep()).toEqual([]);
    expect(manager.getRoom(room.roomId)).toBeDefined();
  });

  it('startGarbageCollector programa el barrido periódico y stopGarbageCollector lo cancela', () => {
    vi.useFakeTimers();
    try {
      const { manager } = setup();
      const spy = vi.spyOn(manager, 'sweep');
      manager.startGarbageCollector(1_000);
      vi.advanceTimersByTime(3_000);
      expect(spy).toHaveBeenCalledTimes(3);
      manager.stopGarbageCollector();
      vi.advanceTimersByTime(3_000);
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('RoomManager - toRoomUpdated', () => {
  it('solo expone datos públicos de los jugadores', () => {
    const { manager } = setup();
    const { room } = roomWith(manager, 2);
    const payload = manager.toRoomUpdated(room);
    expect(payload.status).toBe('WAITING');
    expect(payload.players).toHaveLength(2);
    expect(JSON.stringify(payload)).not.toContain('sessionToken');
    expect(JSON.stringify(payload)).not.toContain('socketId');
  });
});
