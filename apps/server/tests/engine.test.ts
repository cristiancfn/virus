import { describe, expect, it } from 'vitest';
import type {
  Card,
  CardColor,
  GameActionPayload,
  GameState,
  OrganSlot,
  PlayCardTarget,
  ServerPlayer,
  TreatmentType,
} from '@virus/shared';
import { DECK_SIZE } from '@virus/shared';
import {
  autoPass,
  computeOrganStatus,
  createInitialGameState,
  createShuffledDeck,
  drawCards,
  generateDeck,
  processAction,
  shuffle,
} from '../src/engine';
import type { EngineContext } from '../src/engine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ctx: EngineContext = { rng: mulberry32(42), now: () => 1_700_000_000_000 };

let uid = 0;
const mk = (
  type: Card['type'],
  color: CardColor,
  treatmentType: TreatmentType | null = null,
  id?: string,
): Card => ({
  id: id ?? `c${++uid}`,
  type,
  color,
  treatmentType,
  name: `${type}-${color}${treatmentType ? `-${treatmentType}` : ''}`,
});
const organ = (color: CardColor, id?: string) => mk('ORGAN', color, null, id);
const virus = (color: CardColor, id?: string) => mk('VIRUS', color, null, id);
const medicine = (color: CardColor, id?: string) => mk('MEDICINE', color, null, id);
const treat = (t: TreatmentType, id?: string) => mk('TREATMENT', 'NONE', t, id);

/** Cartas de relleno inertes para completar manos / mazos. */
const filler = (n: number): Card[] =>
  Array.from({ length: n }, () => mk('VIRUS', 'RED', null, `filler-${++uid}`));

/** Crea un OrganSlot; `slotId` explícito para legibilidad en los tests. */
const slot = (slotId: string, color: CardColor, modifiers: Card[] = []): OrganSlot => ({
  slotId,
  organCard: organ(color, `organ-${slotId}`),
  modifiers,
  status: computeOrganStatus(modifiers),
});

interface PlayerSpec {
  id: string;
  hand?: Card[];
  body?: OrganSlot[];
}

function mkState(
  specs: PlayerSpec[],
  opts: { drawPile?: Card[]; discardPile?: Card[] } = {},
): GameState {
  const players: ServerPlayer[] = specs.map((s, i) => ({
    playerId: s.id,
    sessionToken: `token-${s.id}`,
    socketId: null,
    nickname: s.id,
    isHost: i === 0,
    isConnected: true,
    hand: s.hand ?? filler(3),
    body: s.body ?? [],
  }));
  return {
    roomId: 'ROOM01',
    status: 'IN_PROGRESS',
    lastActivityTimestamp: 0,
    config: { minPlayers: 2, maxPlayers: 6, organsToWin: 4, turnTimeoutSeconds: 45 },
    turnState: {
      currentPlayerId: specs[0]!.id,
      turnOrder: specs.map((s) => s.id),
      direction: 1,
      turnNumber: 1,
      turnStartedAt: 0,
    },
    decks: { drawPile: opts.drawPile ?? filler(40), discardPile: opts.discardPile ?? [] },
    players,
    winnerId: null,
    lastActionLog: null,
  };
}

/** Mano con la carta jugada + relleno para llegar a 3. */
const handWith = (...cards: Card[]): Card[] => [...cards, ...filler(3 - cards.length)];

const player = (s: GameState, id: string): ServerPlayer => s.players.find((p) => p.playerId === id)!;
const slotOf = (s: GameState, pid: string, slotId: string): OrganSlot | undefined =>
  player(s, pid).body.find((x) => x.slotId === slotId);
const discardIds = (s: GameState): string[] => s.decks.discardPile.map((c) => c.id);

function playCard(
  state: GameState,
  playerId: string,
  card: Card,
  target: PlayCardTarget = null,
) {
  const action: GameActionPayload = {
    roomId: state.roomId,
    playerId,
    actionType: 'PLAY_CARD',
    payload: { cardId: card.id, target },
  };
  return processAction(state, action, ctx);
}

function ok(result: ReturnType<typeof processAction>): GameState {
  if (!result.ok) throw new Error(`Se esperaba éxito, error: ${result.error.code}`);
  return result.state;
}

function errorCode(result: ReturnType<typeof processAction>): string {
  if (result.ok) throw new Error('Se esperaba un error');
  return result.error.code;
}

// ---------------------------------------------------------------------------
// 1. Mazo y reciclaje
// ---------------------------------------------------------------------------

describe('Mazo de 68 cartas', () => {
  const deck = generateDeck();
  const count = (pred: (c: Card) => boolean) => deck.filter(pred).length;

  it('genera exactamente 68 cartas con ids únicos', () => {
    expect(deck).toHaveLength(DECK_SIZE);
    expect(new Set(deck.map((c) => c.id)).size).toBe(68);
  });

  it('respeta la composición exacta del SPEC §2', () => {
    for (const color of ['RED', 'GREEN', 'BLUE', 'YELLOW'] as const) {
      expect(count((c) => c.type === 'ORGAN' && c.color === color)).toBe(5);
      expect(count((c) => c.type === 'VIRUS' && c.color === color)).toBe(4);
      expect(count((c) => c.type === 'MEDICINE' && c.color === color)).toBe(4);
    }
    expect(count((c) => c.type === 'ORGAN' && c.color === 'MULTICOLOR')).toBe(1);
    expect(count((c) => c.type === 'VIRUS' && c.color === 'MULTICOLOR')).toBe(1);
    expect(count((c) => c.type === 'MEDICINE' && c.color === 'MULTICOLOR')).toBe(4);
    expect(count((c) => c.type === 'ORGAN')).toBe(21);
    expect(count((c) => c.type === 'VIRUS')).toBe(17);
    expect(count((c) => c.type === 'MEDICINE')).toBe(20);
    expect(count((c) => c.type === 'TREATMENT')).toBe(10);
    expect(count((c) => c.treatmentType === 'TRANSPLANT')).toBe(3);
    expect(count((c) => c.treatmentType === 'ORGAN_THIEF')).toBe(3);
    expect(count((c) => c.treatmentType === 'CONTAGION')).toBe(2);
    expect(count((c) => c.treatmentType === 'LATEX_GLOVE')).toBe(1);
    expect(count((c) => c.treatmentType === 'MEDICAL_ERROR')).toBe(1);
  });

  it('shuffle (Fisher-Yates) conserva las cartas, no muta y es determinista con la misma semilla', () => {
    const copy = [...deck];
    const a = shuffle(deck, mulberry32(7));
    const b = shuffle(deck, mulberry32(7));
    expect(deck).toEqual(copy);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(a.map((c) => c.id).sort()).toEqual(deck.map((c) => c.id).sort());
    expect(a.map((c) => c.id)).not.toEqual(deck.map((c) => c.id));
    expect(createShuffledDeck(mulberry32(1))).toHaveLength(68);
  });

  it('createInitialGameState reparte 3 cartas a cada jugador y deja 62 en el mazo (2 jugadores)', () => {
    const state = createInitialGameState(
      'ROOM01',
      [
        { playerId: 'A', sessionToken: 'ta', socketId: null, nickname: 'A', isHost: true },
        { playerId: 'B', sessionToken: 'tb', socketId: null, nickname: 'B', isHost: false },
      ],
      ctx,
    );
    expect(state.status).toBe('IN_PROGRESS');
    expect(state.players.every((p) => p.hand.length === 3 && p.body.length === 0)).toBe(true);
    expect(state.decks.drawPile).toHaveLength(62);
    expect(state.turnState.currentPlayerId).toBe('A');
  });
});

describe('Reciclaje de discardPile', () => {
  it('drawCards roba las restantes, baraja el descarte y termina de robar', () => {
    const decks = { drawPile: filler(2), discardPile: filler(5) };
    const topTwo = decks.drawPile.map((c) => c.id);
    const { cards, decks: after } = drawCards(decks, 3, mulberry32(3));
    expect(cards).toHaveLength(3);
    expect(cards.slice(0, 2).map((c) => c.id)).toEqual(topTwo);
    expect(after.discardPile).toEqual([]);
    expect(after.drawPile).toHaveLength(4);
    // no muta la entrada
    expect(decks.drawPile).toHaveLength(2);
    expect(decks.discardPile).toHaveLength(5);
  });

  it('devuelve solo las disponibles si ambos mazos se agotan', () => {
    const { cards, decks } = drawCards({ drawPile: filler(1), discardPile: filler(1) }, 3);
    expect(cards).toHaveLength(2);
    expect(decks.drawPile).toHaveLength(0);
    expect(decks.discardPile).toHaveLength(0);
  });

  it('reposición de mano tras DISCARD con drawPile vacío recicla el descarte', () => {
    const hand = filler(3);
    const state = mkState([{ id: 'A', hand }, { id: 'B' }], {
      drawPile: [],
      discardPile: filler(5),
    });
    const result = processAction(
      state,
      {
        roomId: 'ROOM01',
        playerId: 'A',
        actionType: 'DISCARD',
        payload: { cardIds: [hand[0]!.id] },
      },
      ctx,
    );
    const next = ok(result);
    expect(player(next, 'A').hand).toHaveLength(3);
    expect(next.decks.discardPile).toHaveLength(0);
    expect(next.decks.drawPile).toHaveLength(5); // 6 reciclada - 1 robada
    expect(state.decks.drawPile).toHaveLength(0); // estado original intacto
  });

  it('reposición de mano con drawPile parcial: roba las restantes y luego recicla', () => {
    const hand = filler(3);
    const last = filler(1);
    const state = mkState([{ id: 'A', hand }, { id: 'B' }], {
      drawPile: last,
      discardPile: filler(4),
    });
    const next = ok(
      processAction(
        state,
        {
          roomId: 'ROOM01',
          playerId: 'A',
          actionType: 'DISCARD',
          payload: { cardIds: hand.map((c) => c.id) },
        },
        ctx,
      ),
    );
    const a = player(next, 'A');
    expect(a.hand).toHaveLength(3);
    expect(a.hand[0]!.id).toBe(last[0]!.id);
    expect(next.decks.discardPile).toHaveLength(0);
    expect(next.decks.drawPile).toHaveLength(5); // 4 + 3 descartadas - 2 robadas
  });
});

// ---------------------------------------------------------------------------
// Turnos y descarte
// ---------------------------------------------------------------------------

describe('Turnos y descarte', () => {
  it('rechaza jugar fuera de turno sin mutar el estado', () => {
    const c = organ('RED');
    const state = mkState([{ id: 'A' }, { id: 'B', hand: handWith(c) }]);
    const snapshot = structuredClone(state);
    expect(errorCode(playCard(state, 'B', c))).toBe('NOT_YOUR_TURN');
    expect(state).toEqual(snapshot);
  });

  it('rechaza cartas que no están en la mano', () => {
    const state = mkState([{ id: 'A' }, { id: 'B' }]);
    expect(errorCode(playCard(state, 'A', organ('RED')))).toBe('CARD_NOT_IN_HAND');
  });

  it('rechaza si la partida no está en curso', () => {
    const c = organ('RED');
    const state = mkState([{ id: 'A', hand: handWith(c) }, { id: 'B' }]);
    state.status = 'FINISHED';
    expect(errorCode(playCard(state, 'A', c))).toBe('GAME_NOT_IN_PROGRESS');
  });

  it('DISCARD valida 1-3 cartas y avanza el turno', () => {
    const hand = filler(3);
    const state = mkState([{ id: 'A', hand }, { id: 'B' }]);
    const discard = (cardIds: string[]) =>
      processAction(
        state,
        { roomId: 'ROOM01', playerId: 'A', actionType: 'DISCARD', payload: { cardIds } },
        ctx,
      );
    expect(errorCode(discard([]))).toBe('INVALID_DISCARD_COUNT');
    expect(errorCode(discard(['nope']))).toBe('CARD_NOT_IN_HAND');
    const next = ok(discard([hand[0]!.id, hand[1]!.id]));
    expect(next.turnState.currentPlayerId).toBe('B');
    expect(player(next, 'A').hand).toHaveLength(3);
    expect(discardIds(next)).toEqual([hand[0]!.id, hand[1]!.id]);
  });

  it('autoPass descarta hand[0], repone y avanza con AUTO_PASS', () => {
    const state = mkState([{ id: 'A' }, { id: 'B' }]);
    const first = player(state, 'A').hand[0]!;
    const result = autoPass(state, ctx);
    if (!result.ok) throw new Error('autoPass falló');
    expect(result.state.turnState.currentPlayerId).toBe('B');
    expect(result.state.lastActionLog?.actionType).toBe('AUTO_PASS');
    expect(discardIds(result.state)).toEqual([first.id]);
    expect(player(result.state, 'A').hand).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 2. Órganos, virus, medicinas
// ---------------------------------------------------------------------------

describe('Jugar órganos', () => {
  it('coloca el órgano en el body como HEALTHY con modifiers vacío', () => {
    const c = organ('RED');
    const state = mkState([{ id: 'A', hand: handWith(c) }, { id: 'B' }]);
    const next = ok(playCard(state, 'A', c));
    const body = player(next, 'A').body;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ organCard: c, modifiers: [], status: 'HEALTHY' });
    expect(next.turnState.currentPlayerId).toBe('B');
  });

  it('prohíbe dos órganos del mismo color', () => {
    const c = organ('RED');
    const state = mkState([
      { id: 'A', hand: handWith(c), body: [slot('s1', 'RED')] },
      { id: 'B' },
    ]);
    expect(errorCode(playCard(state, 'A', c))).toBe('DUPLICATE_ORGAN_COLOR');
  });

  it('el órgano MULTICOLOR es un quinto color independiente (hasta 5 órganos)', () => {
    const c = organ('MULTICOLOR');
    const state = mkState([
      {
        id: 'A',
        hand: handWith(c),
        body: [slot('r', 'RED', [virus('RED')]), slot('g', 'GREEN'), slot('b', 'BLUE'), slot('y', 'YELLOW', [virus('YELLOW')])],
      },
      { id: 'B' },
    ]);
    const next = ok(playCard(state, 'A', c));
    expect(player(next, 'A').body).toHaveLength(5);
    expect(next.status).toBe('IN_PROGRESS'); // solo 3 sanos
  });
});

describe('Infección', () => {
  it('virus sobre órgano HEALTHY → INFECTED (la carta queda en modifiers)', () => {
    const v = virus('RED');
    const state = mkState([
      { id: 'A', hand: handWith(v) },
      { id: 'B', body: [slot('s1', 'RED')] },
    ]);
    const next = ok(playCard(state, 'A', v, { targetPlayerId: 'B', targetSlotId: 's1' }));
    const s = slotOf(next, 'B', 's1')!;
    expect(s.status).toBe('INFECTED');
    expect(s.modifiers).toEqual([v]);
    expect(next.decks.discardPile).toHaveLength(0);
  });

  it('virus sobre VACCINATED → medicina y virus al descarte, queda HEALTHY', () => {
    const med = medicine('RED', 'med1');
    const v = virus('RED');
    const state = mkState([
      { id: 'A', hand: handWith(v) },
      { id: 'B', body: [slot('s1', 'RED', [med])] },
    ]);
    const next = ok(playCard(state, 'A', v, { targetPlayerId: 'B', targetSlotId: 's1' }));
    const s = slotOf(next, 'B', 's1')!;
    expect(s.status).toBe('HEALTHY');
    expect(s.modifiers).toEqual([]);
    expect(discardIds(next).sort()).toEqual(['med1', v.id].sort());
  });

  it('virus sobre INFECTED → extirpa el órgano: órgano, virus previo y nuevo van al descarte', () => {
    const v1 = virus('RED', 'v1');
    const v2 = virus('RED', 'v2');
    const state = mkState([
      { id: 'A', hand: handWith(v2) },
      { id: 'B', body: [slot('s1', 'RED', [v1])] },
    ]);
    const next = ok(playCard(state, 'A', v2, { targetPlayerId: 'B', targetSlotId: 's1' }));
    expect(player(next, 'B').body).toHaveLength(0);
    expect(discardIds(next).sort()).toEqual(['organ-s1', 'v1', 'v2'].sort());
  });

  it('virus sobre IMMUNIZED es inválido', () => {
    const v = virus('RED');
    const state = mkState([
      { id: 'A', hand: handWith(v) },
      { id: 'B', body: [slot('s1', 'RED', [medicine('RED'), medicine('RED')])] },
    ]);
    expect(errorCode(playCard(state, 'A', v, { targetPlayerId: 'B', targetSlotId: 's1' }))).toBe(
      'ORGAN_IMMUNIZED',
    );
  });

  it('virus de color incompatible es inválido', () => {
    const v = virus('RED');
    const state = mkState([
      { id: 'A', hand: handWith(v) },
      { id: 'B', body: [slot('s1', 'BLUE')] },
    ]);
    expect(errorCode(playCard(state, 'A', v, { targetPlayerId: 'B', targetSlotId: 's1' }))).toBe(
      'INCOMPATIBLE_COLOR',
    );
  });

  it('virus MULTICOLOR infecta cualquier color y virus de color infecta órgano MULTICOLOR', () => {
    const vm = virus('MULTICOLOR');
    const vr = virus('RED');
    const s1 = mkState([
      { id: 'A', hand: handWith(vm) },
      { id: 'B', body: [slot('s1', 'BLUE')] },
    ]);
    expect(slotOf(ok(playCard(s1, 'A', vm, { targetPlayerId: 'B', targetSlotId: 's1' })), 'B', 's1')!.status).toBe('INFECTED');

    const s2 = mkState([
      { id: 'A', hand: handWith(vr) },
      { id: 'B', body: [slot('s1', 'MULTICOLOR')] },
    ]);
    expect(slotOf(ok(playCard(s2, 'A', vr, { targetPlayerId: 'B', targetSlotId: 's1' })), 'B', 's1')!.status).toBe('INFECTED');
  });

  it('al extirpar, las cartas MULTICOLOR exactas regresan al descarte', () => {
    const vm = virus('MULTICOLOR', 'vm');
    const vr = virus('RED', 'vr');
    const state = mkState([
      { id: 'A', hand: handWith(vr) },
      { id: 'B', body: [slot('s1', 'RED', [vm])] },
    ]);
    const next = ok(playCard(state, 'A', vr, { targetPlayerId: 'B', targetSlotId: 's1' }));
    expect(next.decks.discardPile.find((c) => c.id === 'vm')).toEqual(vm);
    expect(next.decks.discardPile.find((c) => c.id === 'vm')!.color).toBe('MULTICOLOR');
  });
});

describe('Vacunación e inmunización', () => {
  const self = (slotId: string): PlayCardTarget => ({ targetPlayerId: 'A', targetSlotId: slotId });

  it('medicina sobre HEALTHY → VACCINATED', () => {
    const m = medicine('RED');
    const state = mkState([
      { id: 'A', hand: handWith(m), body: [slot('s1', 'RED')] },
      { id: 'B' },
    ]);
    const s = slotOf(ok(playCard(state, 'A', m, self('s1'))), 'A', 's1')!;
    expect(s.status).toBe('VACCINATED');
    expect(s.modifiers).toEqual([m]);
  });

  it('segunda medicina → IMMUNIZED con ambas cartas en modifiers', () => {
    const m1 = medicine('RED', 'm1');
    const m2 = medicine('RED', 'm2');
    const state = mkState([
      { id: 'A', hand: handWith(m2), body: [slot('s1', 'RED', [m1])] },
      { id: 'B' },
    ]);
    const s = slotOf(ok(playCard(state, 'A', m2, self('s1'))), 'A', 's1')!;
    expect(s.status).toBe('IMMUNIZED');
    expect(s.modifiers.map((c) => c.id)).toEqual(['m1', 'm2']);
  });

  it('medicina sobre INFECTED cura: virus y medicina al descarte', () => {
    const v = virus('RED', 'v1');
    const m = medicine('RED', 'm1');
    const state = mkState([
      { id: 'A', hand: handWith(m), body: [slot('s1', 'RED', [v])] },
      { id: 'B' },
    ]);
    const next = ok(playCard(state, 'A', m, self('s1')));
    const s = slotOf(next, 'A', 's1')!;
    expect(s.status).toBe('HEALTHY');
    expect(s.modifiers).toEqual([]);
    expect(discardIds(next).sort()).toEqual(['m1', 'v1']);
  });

  it('medicina sobre IMMUNIZED es inválida', () => {
    const m = medicine('RED');
    const state = mkState([
      { id: 'A', hand: handWith(m), body: [slot('s1', 'RED', [medicine('RED'), medicine('RED')])] },
      { id: 'B' },
    ]);
    expect(errorCode(playCard(state, 'A', m, self('s1')))).toBe('ORGAN_IMMUNIZED');
  });

  it('la medicina solo se aplica en el cuerpo propio', () => {
    const m = medicine('RED');
    const state = mkState([
      { id: 'A', hand: handWith(m) },
      { id: 'B', body: [slot('s1', 'RED')] },
    ]);
    expect(errorCode(playCard(state, 'A', m, { targetPlayerId: 'B', targetSlotId: 's1' }))).toBe(
      'INVALID_TARGET',
    );
  });

  it('medicina MULTICOLOR cura cualquier color y medicina de color es válida en órgano MULTICOLOR', () => {
    const mm = medicine('MULTICOLOR', 'mm');
    const vb = virus('BLUE', 'vb');
    const s1 = mkState([
      { id: 'A', hand: handWith(mm), body: [slot('s1', 'BLUE', [vb])] },
      { id: 'B' },
    ]);
    const n1 = ok(playCard(s1, 'A', mm, self('s1')));
    expect(slotOf(n1, 'A', 's1')!.status).toBe('HEALTHY');
    expect(discardIds(n1).sort()).toEqual(['mm', 'vb']);

    const mr = medicine('RED');
    const s2 = mkState([
      { id: 'A', hand: handWith(mr), body: [slot('s1', 'MULTICOLOR')] },
      { id: 'B' },
    ]);
    expect(slotOf(ok(playCard(s2, 'A', mr, self('s1'))), 'A', 's1')!.status).toBe('VACCINATED');
  });

  it('medicina de color incompatible es inválida', () => {
    const m = medicine('GREEN');
    const state = mkState([
      { id: 'A', hand: handWith(m), body: [slot('s1', 'RED')] },
      { id: 'B' },
    ]);
    expect(errorCode(playCard(state, 'A', m, self('s1')))).toBe('INCOMPATIBLE_COLOR');
  });

  it('una medicina MULTICOLOR apilada se conserva en modifiers y vuelve al descarte al destruir el órgano', () => {
    const mm = medicine('MULTICOLOR', 'mm');
    const v1 = virus('RED', 'v1');
    const v2 = virus('RED', 'v2');
    // A vacuna con medicina multicolor; B la elimina con virus (VACCINATED → HEALTHY), luego dos virus.
    const state = mkState([
      { id: 'A', hand: handWith(mm), body: [slot('s1', 'RED')] },
      { id: 'B', hand: handWith(v1) },
    ]);
    const afterMed = ok(playCard(state, 'A', mm, self('s1')));
    expect(slotOf(afterMed, 'A', 's1')!.modifiers[0]).toEqual(mm);
    const afterVirus = ok(playCard(afterMed, 'B', v1, { targetPlayerId: 'A', targetSlotId: 's1' }));
    expect(discardIds(afterVirus)).toContain('mm');
    expect(slotOf(afterVirus, 'A', 's1')!.status).toBe('HEALTHY');
    // v2 no se usa; evita warning de variable sin usar
    expect(v2.id).toBe('v2');
  });
});

// ---------------------------------------------------------------------------
// 3. Tratamientos
// ---------------------------------------------------------------------------

describe('TRANSPLANT', () => {
  it('intercambia dos órganos conservando modifiers y status', () => {
    const t = treat('TRANSPLANT');
    const v = virus('BLUE', 'v');
    const m = medicine('GREEN', 'm');
    const state = mkState([
      { id: 'A', hand: handWith(t), body: [slot('a1', 'BLUE', [v])] },
      { id: 'B', body: [slot('b1', 'GREEN', [m])] },
    ]);
    const next = ok(
      playCard(state, 'A', t, {
        firstPlayerId: 'A',
        firstSlotId: 'a1',
        secondPlayerId: 'B',
        secondSlotId: 'b1',
      }),
    );
    expect(slotOf(next, 'A', 'b1')).toMatchObject({ status: 'VACCINATED', modifiers: [m] });
    expect(slotOf(next, 'B', 'a1')).toMatchObject({ status: 'INFECTED', modifiers: [v] });
    expect(slotOf(next, 'A', 'a1')).toBeUndefined();
    expect(discardIds(next)).toEqual([t.id]);
  });

  it('puede intercambiar órganos entre dos rivales', () => {
    const t = treat('TRANSPLANT');
    const state = mkState([
      { id: 'A', hand: handWith(t) },
      { id: 'B', body: [slot('b1', 'RED')] },
      { id: 'C', body: [slot('c1', 'GREEN')] },
    ]);
    const next = ok(
      playCard(state, 'A', t, {
        firstPlayerId: 'B',
        firstSlotId: 'b1',
        secondPlayerId: 'C',
        secondSlotId: 'c1',
      }),
    );
    expect(slotOf(next, 'B', 'c1')).toBeDefined();
    expect(slotOf(next, 'C', 'b1')).toBeDefined();
  });

  it('rechaza órganos IMMUNIZED', () => {
    const t = treat('TRANSPLANT');
    const state = mkState([
      { id: 'A', hand: handWith(t), body: [slot('a1', 'BLUE', [medicine('BLUE'), medicine('BLUE')])] },
      { id: 'B', body: [slot('b1', 'GREEN')] },
    ]);
    expect(
      errorCode(
        playCard(state, 'A', t, { firstPlayerId: 'A', firstSlotId: 'a1', secondPlayerId: 'B', secondSlotId: 'b1' }),
      ),
    ).toBe('ORGAN_IMMUNIZED');
  });

  it('rechaza si el intercambio duplicaría un color', () => {
    const t = treat('TRANSPLANT');
    const state = mkState([
      { id: 'A', hand: handWith(t), body: [slot('a1', 'BLUE'), slot('a2', 'GREEN')] },
      { id: 'B', body: [slot('b1', 'GREEN')] },
    ]);
    // A entrega a1(BLUE) y recibe b1(GREEN), pero ya tiene a2(GREEN).
    expect(
      errorCode(
        playCard(state, 'A', t, { firstPlayerId: 'A', firstSlotId: 'a1', secondPlayerId: 'B', secondSlotId: 'b1' }),
      ),
    ).toBe('DUPLICATE_ORGAN_COLOR');
  });

  it('rechaza órganos del mismo jugador', () => {
    const t = treat('TRANSPLANT');
    const state = mkState([
      { id: 'A', hand: handWith(t), body: [slot('a1', 'BLUE'), slot('a2', 'GREEN')] },
      { id: 'B' },
    ]);
    expect(
      errorCode(
        playCard(state, 'A', t, { firstPlayerId: 'A', firstSlotId: 'a1', secondPlayerId: 'A', secondSlotId: 'a2' }),
      ),
    ).toBe('SAME_PLAYER');
  });
});

describe('ORGAN_THIEF', () => {
  const steal = (slotId: string): PlayCardTarget => ({ targetPlayerId: 'B', targetSlotId: slotId });

  it('roba el órgano con sus modificadores al body del jugador activo', () => {
    const t = treat('ORGAN_THIEF');
    const v = virus('BLUE', 'v');
    const state = mkState([
      { id: 'A', hand: handWith(t) },
      { id: 'B', body: [slot('b1', 'BLUE', [v])] },
    ]);
    const next = ok(playCard(state, 'A', t, steal('b1')));
    expect(player(next, 'B').body).toHaveLength(0);
    expect(slotOf(next, 'A', 'b1')).toMatchObject({ status: 'INFECTED', modifiers: [v] });
    expect(discardIds(next)).toEqual([t.id]);
  });

  it('rechaza robar un órgano IMMUNIZED', () => {
    const t = treat('ORGAN_THIEF');
    const state = mkState([
      { id: 'A', hand: handWith(t) },
      { id: 'B', body: [slot('b1', 'BLUE', [medicine('BLUE'), medicine('BLUE')])] },
    ]);
    expect(errorCode(playCard(state, 'A', t, steal('b1')))).toBe('ORGAN_IMMUNIZED');
  });

  it('rechaza si el jugador activo ya tiene ese color', () => {
    const t = treat('ORGAN_THIEF');
    const state = mkState([
      { id: 'A', hand: handWith(t), body: [slot('a1', 'BLUE')] },
      { id: 'B', body: [slot('b1', 'BLUE')] },
    ]);
    expect(errorCode(playCard(state, 'A', t, steal('b1')))).toBe('DUPLICATE_ORGAN_COLOR');
  });

  it('rechaza robarse a sí mismo', () => {
    const t = treat('ORGAN_THIEF');
    const state = mkState([{ id: 'A', hand: handWith(t), body: [slot('a1', 'BLUE')] }, { id: 'B' }]);
    expect(errorCode(playCard(state, 'A', t, { targetPlayerId: 'A', targetSlotId: 'a1' }))).toBe(
      'SAME_PLAYER',
    );
  });
});

describe('CONTAGION', () => {
  it('traslada virus propios a órganos rivales HEALTHY, dejando el propio HEALTHY', () => {
    const t = treat('CONTAGION');
    const v1 = virus('RED', 'v1');
    const v2 = virus('BLUE', 'v2');
    const state = mkState([
      { id: 'A', hand: handWith(t), body: [slot('a1', 'RED', [v1]), slot('a2', 'BLUE', [v2])] },
      { id: 'B', body: [slot('b1', 'RED')] },
      { id: 'C', body: [slot('c1', 'MULTICOLOR')] },
    ]);
    const next = ok(
      playCard(state, 'A', t, {
        transfers: [
          { fromSlotId: 'a1', toPlayerId: 'B', toSlotId: 'b1' },
          { fromSlotId: 'a2', toPlayerId: 'C', toSlotId: 'c1' },
        ],
      }),
    );
    expect(slotOf(next, 'A', 'a1')).toMatchObject({ status: 'HEALTHY', modifiers: [] });
    expect(slotOf(next, 'A', 'a2')).toMatchObject({ status: 'HEALTHY', modifiers: [] });
    expect(slotOf(next, 'B', 'b1')).toMatchObject({ status: 'INFECTED', modifiers: [v1] });
    expect(slotOf(next, 'C', 'c1')).toMatchObject({ status: 'INFECTED', modifiers: [v2] });
    expect(discardIds(next)).toEqual([t.id]);
  });

  const base = () => {
    const t = treat('CONTAGION');
    return { t, v: virus('RED', 'v1') };
  };

  it('exige al menos una transferencia', () => {
    const { t } = base();
    const state = mkState([{ id: 'A', hand: handWith(t) }, { id: 'B' }]);
    expect(errorCode(playCard(state, 'A', t, { transfers: [] }))).toBe('EMPTY_TRANSFERS');
  });

  it('rechaza órgano destino que no esté estrictamente HEALTHY', () => {
    const { t, v } = base();
    const state = mkState([
      { id: 'A', hand: handWith(t), body: [slot('a1', 'RED', [v])] },
      { id: 'B', body: [slot('b1', 'RED', [medicine('RED')])] },
    ]);
    expect(
      errorCode(playCard(state, 'A', t, { transfers: [{ fromSlotId: 'a1', toPlayerId: 'B', toSlotId: 'b1' }] })),
    ).toBe('ORGAN_NOT_HEALTHY');
  });

  it('rechaza origen no infectado, destino propio y color incompatible', () => {
    const { t, v } = base();
    const state = mkState([
      { id: 'A', hand: handWith(t), body: [slot('a1', 'RED', [v]), slot('a2', 'BLUE')] },
      { id: 'B', body: [slot('b1', 'GREEN')] },
    ]);
    const run = (tr: { fromSlotId: string; toPlayerId: string; toSlotId: string }) =>
      errorCode(playCard(state, 'A', t, { transfers: [tr] }));
    expect(run({ fromSlotId: 'a2', toPlayerId: 'B', toSlotId: 'b1' })).toBe('INVALID_TARGET');
    expect(run({ fromSlotId: 'a1', toPlayerId: 'A', toSlotId: 'a2' })).toBe('SAME_PLAYER');
    expect(run({ fromSlotId: 'a1', toPlayerId: 'B', toSlotId: 'b1' })).toBe('INCOMPATIBLE_COLOR');
  });

  it('no permite dos virus hacia el mismo órgano destino', () => {
    const t = treat('CONTAGION');
    const state = mkState([
      {
        id: 'A',
        hand: handWith(t),
        body: [slot('a1', 'RED', [virus('RED')]), slot('a2', 'MULTICOLOR', [virus('MULTICOLOR')])],
      },
      { id: 'B', body: [slot('b1', 'RED')] },
    ]);
    expect(
      errorCode(
        playCard(state, 'A', t, {
          transfers: [
            { fromSlotId: 'a1', toPlayerId: 'B', toSlotId: 'b1' },
            { fromSlotId: 'a2', toPlayerId: 'B', toSlotId: 'b1' },
          ],
        }),
      ),
    ).toBe('INVALID_TARGET');
  });
});

describe('LATEX_GLOVE', () => {
  it('descarta las manos de todos los demás y salta automáticamente sus turnos tras repartir 3 cartas', () => {
    const g = treat('LATEX_GLOVE');
    const bHand = filler(3);
    const cHand = filler(3);
    const state = mkState(
      [{ id: 'A', hand: handWith(g) }, { id: 'B', hand: bHand }, { id: 'C', hand: cHand }],
      { drawPile: filler(20) },
    );
    const next = ok(playCard(state, 'A', g));

    // B y C descartaron sus manos originales
    const discarded = discardIds(next);
    expect(discarded).toContain(g.id);
    for (const c of [...bHand, ...cHand]) expect(discarded).toContain(c.id);

    // Reparto automático de 3 cartas y salto de B y C; el turno vuelve a A
    expect(player(next, 'B').hand).toHaveLength(3);
    expect(player(next, 'C').hand).toHaveLength(3);
    expect(player(next, 'A').hand).toHaveLength(3);
    expect(player(next, 'B').hand.map((c) => c.id)).not.toEqual(bHand.map((c) => c.id));
    expect(next.turnState.currentPlayerId).toBe('A');
    expect(next.lastActionLog?.actionType).toBe('LATEX_GLOVE_SKIP');
    expect(next.lastActionLog?.actorId).toBe('C');
    // 1 (A) + 3 (B) + 3 (C) cartas robadas
    expect(next.decks.drawPile).toHaveLength(20 - 7);
  });

  it('con 2 jugadores el rival es saltado y el turno regresa al jugador activo', () => {
    const g = treat('LATEX_GLOVE');
    const state = mkState([{ id: 'A', hand: handWith(g) }, { id: 'B' }]);
    const next = ok(playCard(state, 'A', g));
    expect(next.turnState.currentPlayerId).toBe('A');
    expect(player(next, 'B').hand).toHaveLength(3);
    expect(next.lastActionLog?.actionType).toBe('LATEX_GLOVE_SKIP');
  });

  it('el salto actúa en bucle solo sobre jugadores con mano vacía', () => {
    const o = organ('RED');
    const state = mkState([
      { id: 'A', hand: handWith(o) },
      { id: 'B', hand: [] },
      { id: 'C' },
    ]);
    const next = ok(playCard(state, 'A', o));
    expect(player(next, 'B').hand).toHaveLength(3);
    expect(next.turnState.currentPlayerId).toBe('C');
  });

  it('rechaza un objetivo no nulo', () => {
    const g = treat('LATEX_GLOVE');
    const state = mkState([{ id: 'A', hand: handWith(g) }, { id: 'B' }]);
    expect(errorCode(playCard(state, 'A', g, { targetPlayerId: 'B' }))).toBe('INVALID_TARGET');
  });
});

describe('MEDICAL_ERROR', () => {
  it('intercambia los cuerpos completos incluyendo órganos IMMUNIZED', () => {
    const t = treat('MEDICAL_ERROR');
    const aBody = [slot('a1', 'RED'), slot('a2', 'GREEN', [virus('GREEN')])];
    const bBody = [slot('b1', 'BLUE', [medicine('BLUE'), medicine('BLUE')])];
    const state = mkState([
      { id: 'A', hand: handWith(t), body: aBody },
      { id: 'B', body: bBody },
    ]);
    const next = ok(playCard(state, 'A', t, { targetPlayerId: 'B' }));
    expect(player(next, 'A').body.map((s) => s.slotId)).toEqual(['b1']);
    expect(slotOf(next, 'A', 'b1')!.status).toBe('IMMUNIZED');
    expect(player(next, 'B').body.map((s) => s.slotId)).toEqual(['a1', 'a2']);
    expect(discardIds(next)).toEqual([t.id]);
  });

  it('es válido si uno de los cuerpos está vacío', () => {
    const t = treat('MEDICAL_ERROR');
    const state = mkState([
      { id: 'A', hand: handWith(t), body: [slot('a1', 'RED')] },
      { id: 'B', body: [] },
    ]);
    const next = ok(playCard(state, 'A', t, { targetPlayerId: 'B' }));
    expect(player(next, 'A').body).toEqual([]);
    expect(player(next, 'B').body.map((s) => s.slotId)).toEqual(['a1']);
  });

  it('rechaza elegirse a sí mismo', () => {
    const t = treat('MEDICAL_ERROR');
    const state = mkState([{ id: 'A', hand: handWith(t) }, { id: 'B' }]);
    expect(errorCode(playCard(state, 'A', t, { targetPlayerId: 'A' }))).toBe('SAME_PLAYER');
  });
});

// ---------------------------------------------------------------------------
// 4. Victoria inmediata
// ---------------------------------------------------------------------------

describe('Condición de victoria', () => {
  const threeHealthy = () => [slot('r', 'RED'), slot('g', 'GREEN'), slot('b', 'BLUE')];

  it('gana de inmediato con 4 órganos sanos: FINISHED, winnerId y sin avanzar turno', () => {
    const o = organ('YELLOW');
    const state = mkState([
      { id: 'A', hand: handWith(o), body: threeHealthy() },
      { id: 'B' },
    ]);
    const next = ok(playCard(state, 'A', o));
    expect(next.status).toBe('FINISHED');
    expect(next.winnerId).toBe('A');
    expect(next.turnState.currentPlayerId).toBe('A');
  });

  it('cuentan VACCINATED e IMMUNIZED, pero no INFECTED', () => {
    const o = organ('YELLOW');
    const state = mkState([
      {
        id: 'A',
        hand: handWith(o),
        body: [
          slot('r', 'RED', [medicine('RED')]),
          slot('g', 'GREEN', [medicine('GREEN'), medicine('GREEN')]),
          slot('b', 'BLUE'),
        ],
      },
      { id: 'B' },
    ]);
    expect(ok(playCard(state, 'A', o)).winnerId).toBe('A');

    const infected = mkState([
      { id: 'A', hand: handWith(o), body: [slot('r', 'RED'), slot('g', 'GREEN'), slot('b', 'BLUE', [virus('BLUE')])] },
      { id: 'B' },
    ]);
    const next = ok(playCard(infected, 'A', o));
    expect(next.status).toBe('IN_PROGRESS');
    expect(next.winnerId).toBeNull();
    expect(next.turnState.currentPlayerId).toBe('B');
  });

  it('el órgano MULTICOLOR sano cuenta como cuarto órgano', () => {
    const o = organ('MULTICOLOR');
    const state = mkState([{ id: 'A', hand: handWith(o), body: threeHealthy() }, { id: 'B' }]);
    expect(ok(playCard(state, 'A', o)).winnerId).toBe('A');
  });

  it('curar el 4.º órgano con medicina provoca la victoria', () => {
    const m = medicine('YELLOW');
    const state = mkState([
      { id: 'A', hand: handWith(m), body: [...threeHealthy(), slot('y', 'YELLOW', [virus('YELLOW')])] },
      { id: 'B' },
    ]);
    const next = ok(playCard(state, 'A', m, { targetPlayerId: 'A', targetSlotId: 'y' }));
    expect(next.status).toBe('FINISHED');
    expect(next.winnerId).toBe('A');
  });

  it('robar un órgano que completa 4 sanos también gana (Ladrón de Órganos)', () => {
    const t = treat('ORGAN_THIEF');
    const state = mkState([
      { id: 'A', hand: handWith(t), body: threeHealthy() },
      { id: 'B', body: [slot('y', 'YELLOW')] },
    ]);
    const next = ok(playCard(state, 'A', t, { targetPlayerId: 'B', targetSlotId: 'y' }));
    expect(next.winnerId).toBe('A');
  });

  it('no se aceptan más acciones una vez FINISHED', () => {
    const o = organ('YELLOW');
    const state = mkState([{ id: 'A', hand: handWith(o), body: threeHealthy() }, { id: 'B' }]);
    const finished = ok(playCard(state, 'A', o));
    const extra = organ('RED');
    finished.players[0]!.hand.push(extra);
    expect(errorCode(playCard(finished, 'A', extra))).toBe('GAME_NOT_IN_PROGRESS');
  });

  it('la victoria se verifica tras reponer la mano (paso 4 antes del paso 5)', () => {
    const o = organ('YELLOW');
    const state = mkState([{ id: 'A', hand: handWith(o), body: threeHealthy() }, { id: 'B' }]);
    const next = ok(playCard(state, 'A', o));
    expect(player(next, 'A').hand).toHaveLength(3);
  });
});
