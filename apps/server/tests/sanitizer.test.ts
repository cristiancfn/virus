import { describe, expect, it } from 'vitest';
import type { Card, GameState } from '@virus/shared';
import { createInitialGameState } from '../src/engine';
import { buildClientState } from '../src/rooms/sanitizer';

const NOW = 1_700_000_000_000;
const ctx = { rng: () => 0.5, now: () => NOW };

function makeGame(): GameState {
  return createInitialGameState(
    'ABC234',
    [
      { playerId: 'p1', sessionToken: 'secret-1', socketId: 'sock-1', nickname: 'Ana', isHost: true },
      { playerId: 'p2', sessionToken: 'secret-2', socketId: 'sock-2', nickname: 'Beto', isHost: false },
      { playerId: 'p3', sessionToken: 'secret-3', socketId: 'sock-3', nickname: 'Caro', isHost: false },
    ],
    ctx,
  );
}

describe('buildClientState', () => {
  it('oculta drawPile y las manos de los rivales', () => {
    const state = makeGame();
    const dto = buildClientState(state, 'p1', NOW);

    expect(dto.decks.drawPileCount).toBe(state.decks.drawPile.length);
    expect(dto).not.toHaveProperty('decks.drawPile');
    expect(dto.me.hand).toEqual(state.players[0]?.hand);
    expect(dto.opponents).toHaveLength(2);
    for (const opp of dto.opponents) {
      expect(opp.handCount).toBe(3);
      expect(opp).not.toHaveProperty('hand');
    }
  });

  it('no filtra sessionToken ni socketId ni ids de cartas ajenas en el JSON', () => {
    const state = makeGame();
    const json = JSON.stringify(buildClientState(state, 'p1', NOW));

    expect(json).not.toContain('secret-');
    expect(json).not.toContain('sessionToken');
    expect(json).not.toContain('socketId');
    expect(json).not.toContain('drawPile"');
    for (const hidden of [state.players[1], state.players[2]]) {
      for (const card of hidden?.hand ?? []) expect(json).not.toContain(`"${card.id}"`);
    }
    for (const card of state.decks.drawPile) expect(json).not.toContain(`"${card.id}"`);
  });

  it('calcula isMyTurn según el espectador', () => {
    const state = makeGame();
    expect(buildClientState(state, 'p1', NOW).turnState.isMyTurn).toBe(true);
    expect(buildClientState(state, 'p2', NOW).turnState.isMyTurn).toBe(false);
    expect(buildClientState(state, 'p2', NOW).turnState.currentPlayerId).toBe('p1');
  });

  it('calcula turnRemainingSeconds con redondeo hacia arriba y piso en 0', () => {
    const state = makeGame();
    const at = (ms: number) => buildClientState(state, 'p1', NOW + ms).turnState.turnRemainingSeconds;
    expect(at(0)).toBe(45);
    expect(at(1)).toBe(45);
    expect(at(1_000)).toBe(44);
    expect(at(44_500)).toBe(1);
    expect(at(45_000)).toBe(0);
    expect(at(120_000)).toBe(0);
  });

  it('turnRemainingSeconds es 0 e isMyTurn false si la partida no está en curso', () => {
    const state = makeGame();
    state.status = 'FINISHED';
    state.winnerId = 'p2';
    const dto = buildClientState(state, 'p1', NOW);
    expect(dto.turnState.turnRemainingSeconds).toBe(0);
    expect(dto.turnState.isMyTurn).toBe(false);
    expect(dto.winnerId).toBe('p2');
  });

  it('expone topDiscardCard (última descartada) y contadores', () => {
    const state = makeGame();
    expect(buildClientState(state, 'p1', NOW).decks.topDiscardCard).toBeNull();

    const a: Card = { id: 'x1', type: 'VIRUS', color: 'RED', treatmentType: null, name: 'a' };
    const b: Card = { id: 'x2', type: 'VIRUS', color: 'BLUE', treatmentType: null, name: 'b' };
    state.decks.discardPile.push(a, b);
    const dto = buildClientState(state, 'p1', NOW);
    expect(dto.decks.discardPileCount).toBe(2);
    expect(dto.decks.topDiscardCard?.id).toBe('x2');
  });

  it('el cuerpo de los rivales es visible pero no comparte referencias con el estado interno', () => {
    const state = makeGame();
    const organ: Card = { id: 'o1', type: 'ORGAN', color: 'RED', treatmentType: null, name: 'o' };
    state.players[1]?.body.push({ slotId: 's1', organCard: organ, modifiers: [], status: 'HEALTHY' });

    const dto = buildClientState(state, 'p1', NOW);
    expect(dto.opponents[0]?.body[0]?.slotId).toBe('s1');

    dto.opponents[0]?.body.pop();
    dto.me.hand.pop();
    expect(state.players[1]?.body).toHaveLength(1);
    expect(state.players[0]?.hand).toHaveLength(3);
  });

  it('lanza si el espectador no pertenece a la partida', () => {
    expect(() => buildClientState(makeGame(), 'ghost', NOW)).toThrow();
  });
});
