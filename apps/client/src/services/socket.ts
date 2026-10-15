import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@virus/shared';

export type VirusClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const SOCKET_URL: string = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

/**
 * Instancia única del socket. `autoConnect: false`: el store decide cuándo conectar,
 * una vez registrados todos los listeners (evita perder eventos tempranos).
 */
export const socket: VirusClientSocket = io(SOCKET_URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
});

// ---------------------------------------------------------------------------
// Sesión persistida (reconexión por sessionToken)
// ---------------------------------------------------------------------------

export interface StoredSession {
  roomId: string;
  playerId: string;
  sessionToken: string;
  nickname: string;
}

const SESSION_KEYS = ['roomId', 'playerId', 'sessionToken', 'nickname'] as const;
const storageKey = (key: (typeof SESSION_KEYS)[number]): string => `virus:${key}`;

export function saveSession(session: StoredSession): void {
  try {
    for (const key of SESSION_KEYS) localStorage.setItem(storageKey(key), session[key]);
  } catch {
    /* localStorage no disponible (modo privado, cuota): la reconexión simplemente no persistirá. */
  }
}

/** Devuelve la sesión completa o `null` si falta cualquiera de las claves. */
export function readSession(): StoredSession | null {
  try {
    const roomId = localStorage.getItem(storageKey('roomId'));
    const playerId = localStorage.getItem(storageKey('playerId'));
    const sessionToken = localStorage.getItem(storageKey('sessionToken'));
    const nickname = localStorage.getItem(storageKey('nickname')) ?? '';
    if (!roomId || !playerId || !sessionToken) return null;
    return { roomId, playerId, sessionToken, nickname };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    for (const key of SESSION_KEYS) localStorage.removeItem(storageKey(key));
  } catch {
    /* noop */
  }
}
