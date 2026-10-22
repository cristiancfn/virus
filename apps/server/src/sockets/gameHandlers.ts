import type { Server, Socket } from 'socket.io';
import type { ZodTypeAny } from 'zod';
import {
  ForceSkipSchema,
  LeaveRoomSchema,
  gameActionPayloadSchema,
  gameRematchPayloadSchema,
  gameStartPayloadSchema,
  roomCreatePayloadSchema,
  roomJoinPayloadSchema,
  roomReconnectPayloadSchema,
} from '@virus/shared';
import type { DisconnectResult } from '../rooms/roomManager';
import type {
  ClientToServerEvents,
  GameActionPayload,
  ServerToClientEvents,
} from '@virus/shared';
import { autoPass, defaultContext, processAction } from '../engine';
import type { EngineContext } from '../engine';
import { buildClientState } from '../rooms/sanitizer';
import type { Room, RoomManager } from '../rooms/roomManager';

export type VirusServer = Server<ClientToServerEvents, ServerToClientEvents>;
export type VirusSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export interface GameHandlersOptions {
  /** Contexto del motor (rng y reloj). Inyectable para tests. */
  ctx?: EngineContext;
}

export interface GameHandlers {
  onConnection: (socket: VirusSocket) => void;
  /** Cancela todos los temporizadores de turno (apagado ordenado). */
  dispose: () => void;
}

export function createGameHandlers(
  io: VirusServer,
  manager: RoomManager,
  options: GameHandlersOptions = {},
): GameHandlers {
  const ctx = options.ctx ?? defaultContext;
  const turnTimers = new Map<string, NodeJS.Timeout>();

  // -------------------------------------------------------------------------
  // Utilidades
  // -------------------------------------------------------------------------

  const emitError = (socket: VirusSocket, code: string, message: string): void => {
    socket.emit('game:action_error', { code, message });
  };

  /** Valida con Zod; si falla emite INVALID_PAYLOAD solo al emisor y devuelve null. */
  const parse = <S extends ZodTypeAny>(
    socket: VirusSocket,
    schema: S,
    payload: unknown,
  ): ReturnType<S['parse']> | null => {
    const result = schema.safeParse(payload);
    if (!result.success) {
      emitError(socket, 'INVALID_PAYLOAD', result.error.issues[0]?.message ?? 'Payload inválido.');
      return null;
    }
    return result.data as ReturnType<S['parse']>;
  };

  /** Envuelve un listener: cualquier excepción inesperada no tumba el proceso. */
  const guarded =
    (socket: VirusSocket, fn: (payload: unknown) => void) =>
    (payload: unknown): void => {
      try {
        fn(payload);
      } catch (err) {
        console.error('[sockets] unhandled handler error', err);
        emitError(socket, 'INTERNAL_ERROR', 'Error interno del servidor.');
      }
    };

  const hasConnectedPlayers = (room: Room): boolean =>
    room.state.players.some((p) => p.isConnected);

  const broadcastRoomUpdated = (room: Room): void => {
    io.to(room.roomId).emit('room:updated', manager.toRoomUpdated(room));
  };

  /** Un `ClientGameStateDTO` individual por socket: jamás se emite el GameState interno. */
  const broadcastState = (room: Room): void => {
    const now = ctx.now();
    for (const p of room.state.players) {
      if (!p.isConnected || !p.socketId) continue;
      io.to(p.socketId).emit('game:state_sync', buildClientState(room.state, p.playerId, now));
    }
  };

  const broadcastGameOver = (room: Room): void => {
    const winner = room.state.players.find((p) => p.playerId === room.state.winnerId);
    if (!winner) return;
    const now = ctx.now();
    for (const p of room.state.players) {
      if (!p.isConnected || !p.socketId) continue;
      const finalState = buildClientState(room.state, p.playerId, now);
      io.to(p.socketId).emit('game:over', {
        winnerId: winner.playerId,
        winnerNickname: winner.nickname,
        finalState,
      });
      io.to(p.socketId).emit('game:state_sync', finalState);
    }
  };

  // -------------------------------------------------------------------------
  // Temporizador de turno (Auto-Pass)
  // -------------------------------------------------------------------------

  const clearTurnTimer = (roomId: string): void => {
    const timer = turnTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      turnTimers.delete(roomId);
    }
  };

  const handleTurnTimeout = (roomId: string, turnNumber: number): void => {
    turnTimers.delete(roomId);
    const room = manager.getRoom(roomId);
    // Guarda contra timers obsoletos: el turno ya avanzó o la partida terminó.
    if (!room || room.state.status !== 'IN_PROGRESS') return;
    if (room.state.turnState.turnNumber !== turnNumber) return;

    try {
      const result = autoPass(room.state, ctx);
      if (!result.ok) return;
      manager.setState(roomId, result.state);
      broadcastState(room);
      scheduleTurnTimer(room);
    } catch (err) {
      console.error('[sockets] auto-pass failed', err);
    }
  };

  function scheduleTurnTimer(room: Room): void {
    clearTurnTimer(room.roomId);
    const { state } = room;
    // Sin jugadores conectados no tiene sentido avanzar turnos en vacío; se reanuda al reconectar.
    if (state.status !== 'IN_PROGRESS' || !hasConnectedPlayers(room)) return;

    const deadline = state.turnState.turnStartedAt + state.config.turnTimeoutSeconds * 1000;
    const delay = Math.max(0, deadline - ctx.now());
    const { turnNumber } = state.turnState;
    const timer = setTimeout(() => handleTurnTimeout(room.roomId, turnNumber), delay);
    timer.unref();
    turnTimers.set(room.roomId, timer);
  }

  manager.addRoomRemovedListener(clearTurnTimer);

  /**
   * Tras una reconexión/reclamo de asiento: si el temporizador estaba detenido (todos estaban
   * desconectados), el turno se reinicia desde ahora y se reactiva el timer.
   */
  const resumeTurnTimerIfStopped = (room: Room): void => {
    if (room.state.status === 'IN_PROGRESS' && !turnTimers.has(room.roomId)) {
      manager.setState(room.roomId, {
        ...room.state,
        turnState: { ...room.state.turnState, turnStartedAt: ctx.now() },
      });
      scheduleTurnTimer(room);
    }
  };

  /** Notifica a la sala tras una salida (`room:leave`) o desconexión. */
  const afterPlayerDetached = (result: DisconnectResult | null): void => {
    if (!result || result.roomDeleted) return;
    const room = manager.getRoom(result.roomId);
    if (!room) return;

    if (!hasConnectedPlayers(room)) clearTurnTimer(room.roomId);
    broadcastRoomUpdated(room);
    if (room.state.status !== 'WAITING') broadcastState(room);
  };

  // -------------------------------------------------------------------------
  // Listeners por socket
  // -------------------------------------------------------------------------

  const onConnection = (socket: VirusSocket): void => {
    socket.on(
      'room:create',
      guarded(socket, (raw) => {
        const payload = parse(socket, roomCreatePayloadSchema, raw);
        if (!payload) return;
        if (manager.getBySocket(socket.id)) {
          return emitError(socket, 'ALREADY_IN_ROOM', 'Ya perteneces a una sala.');
        }

        const result = manager.createRoom(
          payload.nickname,
          socket.id,
          payload.turnTimeoutSeconds,
        );
        if (!result.ok) return emitError(socket, result.error.code, result.error.message);

        void socket.join(result.room.roomId);
        socket.emit('room:joined_success', {
          roomId: result.room.roomId,
          playerId: result.player.playerId,
          sessionToken: result.player.sessionToken,
        });
        broadcastRoomUpdated(result.room);
      }),
    );

    socket.on(
      'room:join',
      guarded(socket, (raw) => {
        const payload = parse(socket, roomJoinPayloadSchema, raw);
        if (!payload) return;
        if (manager.getBySocket(socket.id)) {
          return emitError(socket, 'ALREADY_IN_ROOM', 'Ya perteneces a una sala.');
        }

        const result = manager.joinRoom(payload.roomId, payload.nickname, socket.id);
        if (!result.ok) return emitError(socket, result.error.code, result.error.message);

        void socket.join(result.room.roomId);
        socket.emit('room:joined_success', {
          roomId: result.room.roomId,
          playerId: result.player.playerId,
          sessionToken: result.player.sessionToken,
        });
        broadcastRoomUpdated(result.room);

        // Reclamación de asiento en una partida ya creada: sincroniza el estado y el timer.
        if (result.claimed && result.room.state.status !== 'WAITING') {
          resumeTurnTimerIfStopped(result.room);
          broadcastState(result.room);
        }
      }),
    );

    socket.on(
      'room:leave',
      guarded(socket, (raw) => {
        const payload = parse(socket, LeaveRoomSchema, raw);
        if (!payload) return;
        const link = manager.getBySocket(socket.id);
        if (!link || link.room.roomId !== payload.roomId) {
          return emitError(socket, 'NOT_IN_ROOM', 'No perteneces a esta sala.');
        }

        const result = manager.leaveRoom(socket.id);
        void socket.leave(payload.roomId);
        afterPlayerDetached(result);
      }),
    );

    socket.on(
      'room:reconnect',
      guarded(socket, (raw) => {
        const payload = parse(socket, roomReconnectPayloadSchema, raw);
        if (!payload) return;

        const result = manager.reconnect(
          payload.roomId,
          payload.playerId,
          payload.sessionToken,
          socket.id,
        );
        if (!result.ok) return emitError(socket, result.error.code, result.error.message);

        const { room, player, previousSocketId } = result;
        // El socket anterior (si seguía vivo) queda reemplazado.
        if (previousSocketId) io.sockets.sockets.get(previousSocketId)?.disconnect(true);

        void socket.join(room.roomId);
        socket.emit('room:joined_success', {
          roomId: room.roomId,
          playerId: player.playerId,
          sessionToken: player.sessionToken,
        });
        broadcastRoomUpdated(room);

        if (room.state.status !== 'WAITING') {
          resumeTurnTimerIfStopped(room);
          broadcastState(room);
        }
      }),
    );

    socket.on(
      'game:start',
      guarded(socket, (raw) => {
        const payload = parse(socket, gameStartPayloadSchema, raw);
        if (!payload) return;
        const link = manager.getBySocket(socket.id);
        if (!link || link.room.roomId !== payload.roomId) {
          return emitError(socket, 'NOT_IN_ROOM', 'No perteneces a esta sala.');
        }

        const result = manager.startGame(payload.roomId, link.player.playerId, ctx);
        if (!result.ok) return emitError(socket, result.error.code, result.error.message);

        broadcastRoomUpdated(result.room);
        broadcastState(result.room);
        scheduleTurnTimer(result.room);
      }),
    );

    socket.on(
      'game:action',
      guarded(socket, (raw) => {
        const action = parse(socket, gameActionPayloadSchema, raw) as GameActionPayload | null;
        if (!action) return;

        const link = manager.getBySocket(socket.id);
        if (!link) return emitError(socket, 'NOT_IN_ROOM', 'No perteneces a ninguna sala.');
        // Identidad desacoplada del socket: el playerId del payload debe coincidir con el vinculado.
        if (action.roomId !== link.room.roomId || action.playerId !== link.player.playerId) {
          return emitError(socket, 'IDENTITY_MISMATCH', 'La acción no corresponde a tu sesión.');
        }

        const { room } = link;
        const result = processAction(room.state, action, ctx);
        if (!result.ok) {
          // Solo al emisor; el estado no se muta.
          return emitError(socket, result.error.code, result.error.message);
        }

        manager.setState(room.roomId, result.state);
        if (result.state.status === 'FINISHED') {
          clearTurnTimer(room.roomId);
          broadcastGameOver(room);
          broadcastRoomUpdated(room);
          return;
        }
        broadcastState(room);
        scheduleTurnTimer(room);
      }),
    );

    socket.on(
      'game:rematch',
      guarded(socket, (raw) => {
        const payload = parse(socket, gameRematchPayloadSchema, raw);
        if (!payload) return;
        const link = manager.getBySocket(socket.id);
        if (!link || link.room.roomId !== payload.roomId) {
          return emitError(socket, 'NOT_IN_ROOM', 'No perteneces a esta sala.');
        }

        const result = manager.startRematch(payload.roomId, link.player.playerId, ctx);
        if (!result.ok) return emitError(socket, result.error.code, result.error.message);

        broadcastRoomUpdated(result.room);
        broadcastState(result.room);
        scheduleTurnTimer(result.room);
      }),
    );

    socket.on(
      'game:force_skip',
      guarded(socket, (raw) => {
        const payload = parse(socket, ForceSkipSchema, raw);
        if (!payload) return;
        const link = manager.getBySocket(socket.id);
        if (!link || link.room.roomId !== payload.roomId) {
          return emitError(socket, 'NOT_IN_ROOM', 'No perteneces a esta sala.');
        }

        const check = manager.validateForceSkip(payload.roomId, link.player.playerId);
        if (!check.ok) return emitError(socket, check.error.code, check.error.message);

        const { room } = check;
        const result = autoPass(room.state, ctx);
        if (!result.ok) return emitError(socket, result.error.code, result.error.message);

        manager.setState(room.roomId, result.state);
        broadcastState(room);
        scheduleTurnTimer(room);
      }),
    );

    socket.on('disconnect', () => {
      try {
        afterPlayerDetached(manager.handleDisconnect(socket.id));
      } catch (err) {
        console.error('[sockets] disconnect handler error', err);
      }
    });
  };

  const dispose = (): void => {
    for (const timer of turnTimers.values()) clearTimeout(timer);
    turnTimers.clear();
  };

  return { onConnection, dispose };
}
