import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import cors from 'cors';
import express from 'express';
import type { Express } from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@virus/shared';
import { RoomManager } from './rooms/roomManager';
import { createGameHandlers } from './sockets/gameHandlers';

/** `CLIENT_ORIGIN` admite varios orígenes separados por coma; `*` (o vacío) permite cualquiera. */
export function parseClientOrigin(raw: string | undefined): string[] | '*' {
  const origins = (raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.length === 0 || origins.includes('*')) return '*';
  return origins;
}

export function createApp(clientOrigin: string[] | '*'): Express {
  const app = express();
  app.use(cors({ origin: clientOrigin === '*' ? true : clientOrigin }));
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });
  return app;
}

export interface VirusServerInstance {
  app: Express;
  httpServer: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  rooms: RoomManager;
  close: () => Promise<void>;
}

export function createVirusServer(
  clientOrigin: string[] | '*' = parseClientOrigin(process.env.CLIENT_ORIGIN),
): VirusServerInstance {
  const app = createApp(clientOrigin);
  const httpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: clientOrigin === '*' ? true : clientOrigin },
  });

  const rooms = new RoomManager();
  const handlers = createGameHandlers(io, rooms);
  io.on('connection', handlers.onConnection);
  rooms.startGarbageCollector();

  const close = async (): Promise<void> => {
    rooms.stopGarbageCollector();
    handlers.dispose();
    await io.close();
  };

  return { app, httpServer, io, rooms, close };
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 3001);
  const { httpServer, close } = createVirusServer();
  httpServer.listen(port, () => {
    console.log(`[virus] server listening on port ${port}`);
  });

  const shutdown = (): void => {
    void close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
