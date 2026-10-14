import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { GameState, RoomStatus, RoomUpdatedPayload, ServerPlayer } from '@virus/shared';
import {
  DEFAULT_CONFIG,
  GC_ALL_DISCONNECTED_MS,
  GC_IDLE_MS,
  GC_INTERVAL_MS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from '@virus/shared';
import { createInitialGameState } from '../engine';
import type { EngineContext } from '../engine';

export type RoomErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_NOT_JOINABLE'
  | 'ROOM_FULL'
  | 'INVALID_SESSION'
  | 'NOT_HOST'
  | 'NOT_IN_ROOM'
  | 'INVALID_ROOM_STATE'
  | 'NOT_ENOUGH_PLAYERS'
  | 'ROOM_CODE_EXHAUSTED';

export interface RoomError {
  code: RoomErrorCode;
  message: string;
}

export type RoomResult<T> = ({ ok: true } & T) | { ok: false; error: RoomError };

/** Una sala en memoria. El `GameState` es la única fuente de verdad (incluso en WAITING). */
export interface Room {
  roomId: string;
  state: GameState;
  /** Instante en que el último jugador conectado se desconectó; null si hay alguien conectado. */
  allDisconnectedSince: number | null;
}

export interface RoomManagerOptions {
  now?: () => number;
  /** Generador en [0, 1) usado únicamente para los códigos de sala. */
  rng?: () => number;
  /** Se invoca cada vez que una sala se elimina (GC, sala vacía en WAITING...). */
  onRoomRemoved?: (roomId: string) => void;
}

export interface DisconnectResult {
  roomId: string;
  playerId: string;
  /** true si la sala se eliminó inmediatamente (todos desconectados en WAITING). */
  roomDeleted: boolean;
  /** Nuevo host si hubo migración. */
  newHostId: string | null;
}

const MAX_CODE_ATTEMPTS = 1000;

function fail<T>(code: RoomErrorCode, message: string): RoomResult<T> {
  return { ok: false, error: { code, message } };
}

function tokensMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  /** socketId -> jugador. El socketId NUNCA se usa como playerId. */
  private readonly socketIndex = new Map<string, { roomId: string; playerId: string }>();
  private readonly now: () => number;
  private readonly rng: () => number;
  private readonly removalListeners: Array<(roomId: string) => void> = [];
  private gcTimer: NodeJS.Timeout | null = null;

  constructor(options: RoomManagerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.rng = options.rng ?? Math.random;
    if (options.onRoomRemoved) this.removalListeners.push(options.onRoomRemoved);
  }

  /** Registra un callback invocado cada vez que una sala se elimina (p. ej. para limpiar timers). */
  addRoomRemovedListener(listener: (roomId: string) => void): void {
    this.removalListeners.push(listener);
  }

  // -------------------------------------------------------------------------
  // Consultas
  // -------------------------------------------------------------------------

  get size(): number {
    return this.rooms.size;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /** Resuelve la sala y el jugador asociados a un socket (si está vinculado). */
  getBySocket(socketId: string): { room: Room; player: ServerPlayer } | undefined {
    const link = this.socketIndex.get(socketId);
    if (!link) return undefined;
    const room = this.rooms.get(link.roomId);
    const player = room?.state.players.find((p) => p.playerId === link.playerId);
    if (!room || !player) return undefined;
    return { room, player };
  }

  toRoomUpdated(room: Room): RoomUpdatedPayload {
    return {
      roomId: room.roomId,
      status: room.state.status,
      players: room.state.players.map((p) => ({
        playerId: p.playerId,
        nickname: p.nickname,
        isHost: p.isHost,
        isConnected: p.isConnected,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Creación y acceso
  // -------------------------------------------------------------------------

  /** Genera un código de 6 caracteres con ROOM_CODE_ALPHABET que no esté en uso. */
  generateRoomCode(): string | null {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        const idx = Math.floor(this.rng() * ROOM_CODE_ALPHABET.length);
        code += ROOM_CODE_ALPHABET[idx];
      }
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }

  private newPlayer(nickname: string, socketId: string, isHost: boolean): ServerPlayer {
    return {
      playerId: randomUUID(),
      sessionToken: randomBytes(24).toString('hex'),
      socketId,
      nickname,
      isHost,
      isConnected: true,
      hand: [],
      body: [],
    };
  }

  createRoom(
    nickname: string,
    socketId: string,
  ): RoomResult<{ room: Room; player: ServerPlayer }> {
    const roomId = this.generateRoomCode();
    if (!roomId) return fail('ROOM_CODE_EXHAUSTED', 'No se pudo generar un código de sala.');

    const player = this.newPlayer(nickname, socketId, true);
    const room: Room = {
      roomId,
      allDisconnectedSince: null,
      state: {
        roomId,
        status: 'WAITING',
        lastActivityTimestamp: this.now(),
        config: { ...DEFAULT_CONFIG },
        turnState: {
          currentPlayerId: '',
          turnOrder: [],
          direction: 1,
          turnNumber: 0,
          turnStartedAt: 0,
        },
        decks: { drawPile: [], discardPile: [] },
        players: [player],
        winnerId: null,
        lastActionLog: null,
      },
    };
    this.rooms.set(roomId, room);
    this.socketIndex.set(socketId, { roomId, playerId: player.playerId });
    return { ok: true, room, player };
  }

  joinRoom(
    roomId: string,
    nickname: string,
    socketId: string,
  ): RoomResult<{ room: Room; player: ServerPlayer }> {
    const room = this.rooms.get(roomId);
    if (!room) return fail('ROOM_NOT_FOUND', 'La sala no existe.');
    if (room.state.status !== 'WAITING') {
      return fail('ROOM_NOT_JOINABLE', 'La partida ya comenzó.');
    }
    if (room.state.players.length >= room.state.config.maxPlayers) {
      return fail('ROOM_FULL', 'La sala está llena.');
    }

    const player = this.newPlayer(nickname, socketId, false);
    room.state.players.push(player);
    room.allDisconnectedSince = null;
    room.state.lastActivityTimestamp = this.now();
    this.socketIndex.set(socketId, { roomId, playerId: player.playerId });
    return { ok: true, room, player };
  }

  /**
   * Reconexión validada exclusivamente por el `sessionToken` privado.
   * Reemplaza el socket anterior del jugador (si existía).
   */
  reconnect(
    roomId: string,
    playerId: string,
    sessionToken: string,
    socketId: string,
  ): RoomResult<{ room: Room; player: ServerPlayer; previousSocketId: string | null }> {
    const room = this.rooms.get(roomId);
    if (!room) return fail('ROOM_NOT_FOUND', 'La sala no existe.');

    const player = room.state.players.find((p) => p.playerId === playerId);
    if (!player || !tokensMatch(player.sessionToken, sessionToken)) {
      return fail('INVALID_SESSION', 'Sesión inválida.');
    }

    const previousSocketId = player.socketId;
    if (previousSocketId && previousSocketId !== socketId) {
      this.socketIndex.delete(previousSocketId);
    }
    player.socketId = socketId;
    player.isConnected = true;
    room.allDisconnectedSince = null;
    room.state.lastActivityTimestamp = this.now();
    this.socketIndex.set(socketId, { roomId, playerId });
    return {
      ok: true,
      room,
      player,
      previousSocketId: previousSocketId !== socketId ? previousSocketId : null,
    };
  }

  // -------------------------------------------------------------------------
  // Desconexión
  // -------------------------------------------------------------------------

  /**
   * Marca al jugador como desconectado.
   * - WAITING: migra el host al siguiente jugador conectado; si no queda nadie, elimina la sala.
   * - Otros estados: conserva al jugador (puede reconectarse) y arranca el contador del GC
   *   cuando todos están desconectados.
   */
  handleDisconnect(socketId: string): DisconnectResult | null {
    const link = this.socketIndex.get(socketId);
    if (!link) return null;
    this.socketIndex.delete(socketId);

    const room = this.rooms.get(link.roomId);
    const player = room?.state.players.find((p) => p.playerId === link.playerId);
    if (!room || !player) return null;

    player.isConnected = false;
    player.socketId = null;
    const connected = room.state.players.filter((p) => p.isConnected);

    if (connected.length === 0) {
      if (room.state.status === 'WAITING') {
        this.deleteRoom(room.roomId);
        return { roomId: room.roomId, playerId: player.playerId, roomDeleted: true, newHostId: null };
      }
      room.allDisconnectedSince = this.now();
    }

    let newHostId: string | null = null;
    if (room.state.status === 'WAITING' && player.isHost) {
      const next = connected[0];
      if (next) {
        player.isHost = false;
        next.isHost = true;
        newHostId = next.playerId;
      }
    }

    return { roomId: room.roomId, playerId: player.playerId, roomDeleted: false, newHostId };
  }

  // -------------------------------------------------------------------------
  // Ciclo de vida de la partida
  // -------------------------------------------------------------------------

  /** Inicia la partida (solo host, sala en WAITING). Los jugadores desconectados se descartan. */
  startGame(
    roomId: string,
    requesterId: string,
    ctx?: EngineContext,
  ): RoomResult<{ room: Room }> {
    return this.launchGame(roomId, requesterId, 'WAITING', ctx);
  }

  /** Revancha (solo host, sala FINISHED): reparte una partida nueva con los jugadores conectados. */
  startRematch(
    roomId: string,
    requesterId: string,
    ctx?: EngineContext,
  ): RoomResult<{ room: Room }> {
    return this.launchGame(roomId, requesterId, 'FINISHED', ctx);
  }

  private launchGame(
    roomId: string,
    requesterId: string,
    requiredStatus: RoomStatus,
    ctx?: EngineContext,
  ): RoomResult<{ room: Room }> {
    const room = this.rooms.get(roomId);
    if (!room) return fail('ROOM_NOT_FOUND', 'La sala no existe.');

    const requester = room.state.players.find((p) => p.playerId === requesterId);
    if (!requester) return fail('NOT_IN_ROOM', 'No perteneces a esta sala.');
    if (!requester.isHost) return fail('NOT_HOST', 'Solo el anfitrión puede hacerlo.');
    if (room.state.status !== requiredStatus) {
      return fail('INVALID_ROOM_STATE', `La sala debe estar en estado ${requiredStatus}.`);
    }

    const connected = room.state.players.filter((p) => p.isConnected);
    if (connected.length < room.state.config.minPlayers) {
      return fail(
        'NOT_ENOUGH_PLAYERS',
        `Se necesitan al menos ${room.state.config.minPlayers} jugadores conectados.`,
      );
    }

    // Los desconectados quedan fuera de la nueva partida: invalidamos su índice de socket.
    for (const p of room.state.players) {
      if (!p.isConnected && p.socketId) this.socketIndex.delete(p.socketId);
    }

    room.state = createInitialGameState(
      room.roomId,
      connected.map((p) => ({
        playerId: p.playerId,
        sessionToken: p.sessionToken,
        socketId: p.socketId,
        nickname: p.nickname,
        isHost: p.isHost,
        isConnected: true,
      })),
      ctx ?? { rng: Math.random, now: this.now },
    );
    room.allDisconnectedSince = null;
    return { ok: true, room };
  }

  /** Reemplaza el estado de una sala tras una acción del motor. */
  setState(roomId: string, state: GameState): void {
    const room = this.rooms.get(roomId);
    if (room) room.state = state;
  }

  // -------------------------------------------------------------------------
  // Eliminación y Garbage Collector
  // -------------------------------------------------------------------------

  deleteRoom(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    for (const p of room.state.players) {
      if (p.socketId) this.socketIndex.delete(p.socketId);
    }
    this.rooms.delete(roomId);
    for (const listener of this.removalListeners) listener(roomId);
    return true;
  }

  /**
   * Elimina salas con todos los jugadores desconectados > 10 min, o sin actividad > 30 min
   * estando en WAITING o FINISHED (SPEC §6). Devuelve los ids eliminados.
   */
  sweep(now: number = this.now()): string[] {
    const removed: string[] = [];
    for (const room of [...this.rooms.values()]) {
      const { status, lastActivityTimestamp } = room.state;
      const abandoned =
        room.allDisconnectedSince !== null &&
        now - room.allDisconnectedSince > GC_ALL_DISCONNECTED_MS;
      const idle =
        (status === 'WAITING' || status === 'FINISHED') &&
        now - lastActivityTimestamp > GC_IDLE_MS;
      if (abandoned || idle) {
        this.deleteRoom(room.roomId);
        removed.push(room.roomId);
      }
    }
    return removed;
  }

  startGarbageCollector(intervalMs: number = GC_INTERVAL_MS): void {
    this.stopGarbageCollector();
    this.gcTimer = setInterval(() => {
      this.sweep();
    }, intervalMs);
    this.gcTimer.unref();
  }

  stopGarbageCollector(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }
}
