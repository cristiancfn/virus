import type {
  ActionLog,
  GameActionPayload,
  GameState,
  PlayCardTarget,
  ServerPlayer,
} from '@virus/shared';
import { DEFAULT_CONFIG, HAND_SIZE, LATEX_GLOVE_REFILL } from '@virus/shared';
import { createShuffledDeck, defaultContext, drawCards } from './deck';
import type { EngineContext } from './deck';
import { applyDiscard, applyPlayCard, cloneState, drawForPlayer, refillHand } from './mutators';
import { countHealthyOrgans, validateAction } from './validators';
import type { EngineError } from './validators';

export type ActionResult =
  | { ok: true; state: GameState }
  | { ok: false; error: EngineError };

export interface NewPlayerInput {
  playerId: string;
  sessionToken: string;
  socketId: string | null;
  nickname: string;
  isHost: boolean;
  isConnected?: boolean;
}

// ---------------------------------------------------------------------------
// Inicio de partida
// ---------------------------------------------------------------------------

/**
 * Crea una partida IN_PROGRESS: baraja el mazo, reparte 3 cartas a cada jugador
 * y cede el primer turno al primer jugador de `players` (el orden lo decide quien llama).
 */
export function createInitialGameState(
  roomId: string,
  players: readonly NewPlayerInput[],
  ctx: EngineContext = defaultContext,
  options: { turnTimeoutSeconds?: number } = {},
): GameState {
  if (
    players.length < DEFAULT_CONFIG.minPlayers ||
    players.length > DEFAULT_CONFIG.maxPlayers
  ) {
    throw new Error(
      `Se requieren entre ${DEFAULT_CONFIG.minPlayers} y ${DEFAULT_CONFIG.maxPlayers} jugadores.`,
    );
  }

  let decks = { drawPile: createShuffledDeck(ctx.rng), discardPile: [] as GameState['decks']['discardPile'] };
  const serverPlayers: ServerPlayer[] = players.map((p) => {
    const drawn = drawCards(decks, HAND_SIZE, ctx.rng);
    decks = drawn.decks;
    return {
      playerId: p.playerId,
      sessionToken: p.sessionToken,
      socketId: p.socketId,
      nickname: p.nickname,
      isHost: p.isHost,
      isConnected: p.isConnected ?? true,
      hand: drawn.cards,
      body: [],
    };
  });

  const now = ctx.now();
  const first = serverPlayers[0] as ServerPlayer;
  return {
    roomId,
    status: 'IN_PROGRESS',
    lastActivityTimestamp: now,
    config: {
      ...DEFAULT_CONFIG,
      turnTimeoutSeconds: options.turnTimeoutSeconds ?? DEFAULT_CONFIG.turnTimeoutSeconds,
    },
    turnState: {
      currentPlayerId: first.playerId,
      turnOrder: serverPlayers.map((p) => p.playerId),
      direction: 1,
      turnNumber: 1,
      turnStartedAt: now,
    },
    decks,
    players: serverPlayers,
    winnerId: null,
    lastActionLog: null,
  };
}

// ---------------------------------------------------------------------------
// Victoria y avance de turno
// ---------------------------------------------------------------------------

/**
 * Paso 5. Devuelve el id del ganador (>= organsToWin órganos no infectados) o null.
 * Si varios cumplen a la vez (p. ej. tras un Error Médico), prioriza al jugador activo.
 */
export function findWinner(state: GameState): string | null {
  const ordered = [...state.players].sort((a, b) =>
    a.playerId === state.turnState.currentPlayerId
      ? -1
      : b.playerId === state.turnState.currentPlayerId
        ? 1
        : 0,
  );
  const winner = ordered.find((p) => countHealthyOrgans(p) >= state.config.organsToWin);
  return winner ? winner.playerId : null;
}

/**
 * Paso 6. Avanza al siguiente jugador; si tiene la mano vacía (efecto diferido del
 * Guante de Látex) le reparte 3 cartas, registra LATEX_GLOVE_SKIP y salta al siguiente.
 */
export function advanceTurn(state: GameState, ctx: EngineContext = defaultContext): GameState {
  let next = cloneState(state);
  const order = next.turnState.turnOrder;
  const now = ctx.now();

  for (let i = 0; i < order.length; i++) {
    const idx = order.indexOf(next.turnState.currentPlayerId);
    const nextId = order[(idx + 1) % order.length] as string;
    next.turnState.currentPlayerId = nextId;
    next.turnState.turnNumber += 1;
    next.turnState.turnStartedAt = now;

    const player = next.players.find((p) => p.playerId === nextId) as ServerPlayer;
    if (player.hand.length > 0) break;

    next = drawForPlayer(next, nextId, LATEX_GLOVE_REFILL, ctx.rng);
    next.lastActionLog = {
      actorId: nextId,
      actionType: 'LATEX_GLOVE_SKIP',
      timestamp: new Date(now).toISOString(),
    };
  }
  return next;
}

// ---------------------------------------------------------------------------
// Pipeline transaccional (SPEC §5.3)
// ---------------------------------------------------------------------------

function collectTargets(target: PlayCardTarget): string[] | undefined {
  if (target === null) return undefined;
  if ('transfers' in target) return target.transfers.map((t) => t.toPlayerId);
  if ('firstPlayerId' in target) return [target.firstPlayerId, target.secondPlayerId];
  return [target.targetPlayerId];
}

/**
 * Procesa una acción de juego completa. Pura: nunca muta `state`; si la acción es
 * inválida devuelve el error y el estado original queda intacto.
 */
export function processAction(
  state: GameState,
  action: GameActionPayload,
  ctx: EngineContext = defaultContext,
): ActionResult {
  // Pasos 1-2: turno, propiedad y reglas de dominio.
  const validation = validateAction(state, action);
  if (!validation.ok) return { ok: false, error: validation.error };

  const now = ctx.now();
  const actorId = action.playerId;

  // Paso 3: mutación y descarte.
  let next: GameState;
  let log: ActionLog;
  if (action.actionType === 'DISCARD') {
    next = applyDiscard(state, actorId, action.payload.cardIds);
    log = {
      actorId,
      actionType: 'DISCARD',
      timestamp: new Date(now).toISOString(),
    };
  } else {
    const { cardId, target } = action.payload;
    next = applyPlayCard(state, actorId, cardId, target);
    const targets = collectTargets(target);
    log = {
      actorId,
      actionType: 'PLAY_CARD',
      cardPlayed: cardId,
      ...(targets ? { targets } : {}),
      timestamp: new Date(now).toISOString(),
    };
  }

  // Paso 4: reposición de mano (con reciclaje de mazo).
  next = refillHand(next, actorId, ctx.rng);
  next.lastActivityTimestamp = now;
  next.lastActionLog = log;

  // Paso 5: victoria inmediata.
  const winnerId = findWinner(next);
  if (winnerId) {
    next.winnerId = winnerId;
    next.status = 'FINISHED';
    return { ok: true, state: next };
  }

  // Paso 6: avance de turno (con salto por Guante de Látex).
  return { ok: true, state: advanceTurn(next, ctx) };
}

/**
 * Auto-Pass por timeout (SPEC §6): descarta hand[0], roba hasta 3 y avanza el turno.
 */
export function autoPass(state: GameState, ctx: EngineContext = defaultContext): ActionResult {
  if (state.status !== 'IN_PROGRESS') {
    return {
      ok: false,
      error: { code: 'GAME_NOT_IN_PROGRESS', message: 'La partida no está en curso.' },
    };
  }
  const actorId = state.turnState.currentPlayerId;
  const actor = state.players.find((p) => p.playerId === actorId);
  const first = actor?.hand[0];
  const now = ctx.now();

  let next = first ? applyDiscard(state, actorId, [first.id]) : cloneState(state);
  next = refillHand(next, actorId, ctx.rng);
  next.lastActivityTimestamp = now;
  next.lastActionLog = {
    actorId,
    actionType: 'AUTO_PASS',
    ...(first ? { cardPlayed: first.id } : {}),
    timestamp: new Date(now).toISOString(),
  };
  return { ok: true, state: advanceTurn(next, ctx) };
}
