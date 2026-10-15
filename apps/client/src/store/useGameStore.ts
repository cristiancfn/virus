import { create } from 'zustand';
import type {
  ClientGameStateDTO,
  GameActionErrorPayload,
  GameOverPayload,
  RoomUpdatedPayload,
} from '@virus/shared';
import { clearSession, readSession, saveSession, socket } from '../services/socket';
import type { StoredSession } from '../services/socket';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

/** Error del servidor (`game:action_error`) con id local para la cola de toasts. */
export interface ErrorToast extends GameActionErrorPayload {
  id: number;
}

interface GameStore {
  connection: ConnectionStatus;
  /** true mientras se espera la respuesta del servidor a un `room:reconnect`. */
  isReconnecting: boolean;
  session: StoredSession | null;
  room: RoomUpdatedPayload | null;
  game: ClientGameStateDTO | null;
  gameOver: GameOverPayload | null;
  errors: ErrorToast[];

  init: () => void;
  createRoom: (nickname: string) => void;
  joinRoom: (roomId: string, nickname: string) => void;
  startGame: () => void;
  requestRematch: () => void;
  leaveRoom: () => void;
  pushError: (error: GameActionErrorPayload) => void;
  dismissError: (id: number) => void;
}

/** Estado "sin sala activa". */
const NO_ROOM = {
  isReconnecting: false,
  session: null,
  room: null,
  game: null,
  gameOver: null,
} as const;

let initialized = false;
let errorSeq = 0;
/** Nickname enviado en el último create/join; `room:joined_success` no lo devuelve. */
let pendingNickname: string | null = null;

export const useGameStore = create<GameStore>((set, get) => ({
  connection: 'connecting',
  isReconnecting: false,
  session: null,
  room: null,
  game: null,
  gameOver: null,
  errors: [],

  init: () => {
    // Idempotente: React.StrictMode ejecuta los efectos dos veces en desarrollo.
    if (initialized) return;
    initialized = true;

    socket.on('connect', () => {
      set({ connection: 'connected' });
      // Reconexión automática desde localStorage (también tras una caída de red).
      const saved = readSession();
      if (saved) {
        set({ isReconnecting: true, session: saved });
        socket.emit('room:reconnect', {
          roomId: saved.roomId,
          playerId: saved.playerId,
          sessionToken: saved.sessionToken,
        });
      }
    });

    socket.on('disconnect', () => set({ connection: 'disconnected' }));
    socket.on('connect_error', () => set({ connection: 'disconnected' }));
    socket.io.on('reconnect_attempt', () => set({ connection: 'connecting' }));

    socket.on('room:joined_success', ({ roomId, playerId, sessionToken }) => {
      const nickname = pendingNickname ?? readSession()?.nickname ?? get().session?.nickname ?? '';
      pendingNickname = null;
      const session: StoredSession = { roomId, playerId, sessionToken, nickname };
      saveSession(session);
      set({ session, isReconnecting: false });
    });

    socket.on('room:updated', (room) => {
      if (room.status === 'ABANDONED') {
        clearSession();
        set({ ...NO_ROOM });
        get().pushError({ code: 'ROOM_ABANDONED', message: 'La sala fue abandonada.' });
        return;
      }
      set((s) => ({ room, gameOver: room.status === 'FINISHED' ? s.gameOver : null }));
    });

    socket.on('game:state_sync', (game) => set({ game }));
    socket.on('game:over', (gameOver) => set({ gameOver, game: gameOver.finalState }));

    // El servidor reporta TODOS los errores (sala y jugadas) por este único evento.
    socket.on('game:action_error', (error) => {
      if (get().isReconnecting) {
        // Reconexión rechazada: la sesión guardada ya no es válida → volver al inicio.
        clearSession();
        pendingNickname = null;
        set({ ...NO_ROOM });
      }
      get().pushError(error);
    });

    set({ connection: 'connecting' });
    socket.connect();
  },

  createRoom: (nickname) => {
    pendingNickname = nickname;
    socket.emit('room:create', { nickname });
  },

  joinRoom: (roomId, nickname) => {
    pendingNickname = nickname;
    socket.emit('room:join', { roomId, nickname });
  },

  startGame: () => {
    const room = get().room;
    if (room) socket.emit('game:start', { roomId: room.roomId });
  },

  requestRematch: () => {
    const room = get().room;
    if (room) socket.emit('game:rematch', { roomId: room.roomId });
  },

  leaveRoom: () => {
    clearSession();
    pendingNickname = null;
    set({ ...NO_ROOM });
    // Un socket nuevo: el servidor vincula socket → jugador y rechazaría crear/unirse (ALREADY_IN_ROOM).
    socket.disconnect().connect();
  },

  pushError: (error) => {
    const toast: ErrorToast = { ...error, id: ++errorSeq };
    set((s) => ({ errors: [...s.errors.slice(-3), toast] }));
  },

  dismissError: (id) => set((s) => ({ errors: s.errors.filter((e) => e.id !== id) })),
}));
