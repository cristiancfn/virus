import { createDeck } from '@virus/shared';
import type { Card, GameState } from '@virus/shared';

/** Generador de números en [0, 1). Inyectable para que el motor sea determinista y testeable. */
export type Rng = () => number;

/** Contexto inyectable (aleatoriedad y reloj) para mantener las funciones del motor puras. */
export interface EngineContext {
  rng: Rng;
  now: () => number;
}

export const defaultContext: EngineContext = {
  rng: Math.random,
  now: () => Date.now(),
};

export type Decks = GameState['decks'];

/** Genera el mazo ordenado de exactamente 68 cartas con ids únicos (SPEC §2). */
export function generateDeck(): Card[] {
  return createDeck();
}

/** Fisher-Yates. No muta el arreglo original. */
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = result[i] as T;
    const b = result[j] as T;
    result[i] = b;
    result[j] = a;
  }
  return result;
}

export function createShuffledDeck(rng: Rng = Math.random): Card[] {
  return shuffle(generateDeck(), rng);
}

/**
 * Roba `count` cartas desde la cima del drawPile (índice 0).
 * Si drawPile se agota: se roban las restantes, se baraja todo el discardPile
 * (Fisher-Yates), pasa a ser el nuevo drawPile (discardPile queda vacío) y se
 * termina de robar. Si aún así no alcanzan cartas, se devuelven las disponibles.
 * Pura: no muta `decks`.
 */
export function drawCards(
  decks: Decks,
  count: number,
  rng: Rng = Math.random,
): { cards: Card[]; decks: Decks } {
  let drawPile = [...decks.drawPile];
  let discardPile = [...decks.discardPile];
  const cards: Card[] = [];

  const takeFromDrawPile = (n: number): void => {
    const taken = drawPile.splice(0, Math.min(n, drawPile.length));
    cards.push(...taken);
  };

  takeFromDrawPile(count);

  const remaining = count - cards.length;
  if (remaining > 0 && discardPile.length > 0) {
    drawPile = shuffle(discardPile, rng);
    discardPile = [];
    takeFromDrawPile(remaining);
  }

  return { cards, decks: { drawPile, discardPile } };
}
