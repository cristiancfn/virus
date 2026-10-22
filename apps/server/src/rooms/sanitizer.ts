import type { ClientGameStateDTO, GameState, PublicOpponentDTO } from '@virus/shared';

/**
 * Segundos restantes del turno actual (SPEC §3.3). Solo tiene sentido con la partida
 * en curso; en cualquier otro estado devuelve 0.
 */
export function computeTurnRemainingSeconds(state: GameState, now: number): number {
  if (state.status !== 'IN_PROGRESS') return 0;
  const deadline = state.turnState.turnStartedAt + state.config.turnTimeoutSeconds * 1000;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/**
 * Transforma el `GameState` interno en el DTO que puede ver `viewerPlayerId` (anti-cheat).
 *
 * - Oculta `drawPile` (solo expone su tamaño) y la mano de los rivales (solo `handCount`).
 * - Nunca copia `sessionToken` ni `socketId` (campos privados de `ServerPlayer`).
 * - Los datos mutables se clonan para que el DTO no comparta referencias con el estado interno.
 *
 * @throws Error si `viewerPlayerId` no pertenece a la partida.
 */
export function buildClientState(
  gameState: GameState,
  viewerPlayerId: string,
  now: number = Date.now(),
): ClientGameStateDTO {
  const viewer = gameState.players.find((p) => p.playerId === viewerPlayerId);
  if (!viewer) {
    throw new Error(`buildClientState: player ${viewerPlayerId} is not part of room ${gameState.roomId}`);
  }

  const opponents: PublicOpponentDTO[] = gameState.players
    .filter((p) => p.playerId !== viewerPlayerId)
    .map((p) => ({
      playerId: p.playerId,
      nickname: p.nickname,
      isHost: p.isHost,
      isConnected: p.isConnected,
      handCount: p.hand.length,
      body: structuredClone(p.body),
    }));

  const { discardPile, drawPile } = gameState.decks;
  const topDiscard = discardPile[discardPile.length - 1];

  return {
    roomId: gameState.roomId,
    status: gameState.status,
    config: { turnTimeoutSeconds: gameState.config.turnTimeoutSeconds },
    turnState: {
      currentPlayerId: gameState.turnState.currentPlayerId,
      isMyTurn:
        gameState.status === 'IN_PROGRESS' &&
        gameState.turnState.currentPlayerId === viewerPlayerId,
      turnOrder: [...gameState.turnState.turnOrder],
      turnRemainingSeconds: computeTurnRemainingSeconds(gameState, now),
      turnNumber: gameState.turnState.turnNumber,
    },
    decks: {
      drawPileCount: drawPile.length,
      discardPileCount: discardPile.length,
      topDiscardCard: topDiscard ? structuredClone(topDiscard) : null,
    },
    me: {
      playerId: viewer.playerId,
      nickname: viewer.nickname,
      isHost: viewer.isHost,
      hand: structuredClone(viewer.hand),
      body: structuredClone(viewer.body),
    },
    opponents,
    winnerId: gameState.winnerId,
    lastActionLog: gameState.lastActionLog ? structuredClone(gameState.lastActionLog) : null,
  };
}
