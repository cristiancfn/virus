import type { Card, GameState, OrganSlot, PlayCardTarget, ServerPlayer } from '@virus/shared';
import { HAND_SIZE } from '@virus/shared';
import { drawCards } from './deck';
import type { Rng } from './deck';
import {
  computeOrganStatus,
  findPlayer,
  findSlot,
  isContagionTarget,
  isPlayerTarget,
  isSlotTarget,
  isTransplantTarget,
} from './validators';

/**
 * Los mutadores asumen que la acción ya fue validada (validators.ts).
 * Son puros: clonan el estado de entrada y devuelven uno nuevo.
 * Si una invariante se rompe lanzan un Error (indica un bug, no jugada inválida).
 */

export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function requirePlayer(state: GameState, playerId: string): ServerPlayer {
  const p = findPlayer(state, playerId);
  if (!p) throw new Error(`Invariant: player ${playerId} not found`);
  return p;
}

function requireSlot(player: ServerPlayer, slotId: string): OrganSlot {
  const s = findSlot(player, slotId);
  if (!s) throw new Error(`Invariant: slot ${slotId} not found for ${player.playerId}`);
  return s;
}

function takeFromHand(player: ServerPlayer, cardId: string): Card {
  const idx = player.hand.findIndex((c) => c.id === cardId);
  const card = player.hand[idx];
  if (idx === -1 || !card) throw new Error(`Invariant: card ${cardId} not in hand`);
  player.hand.splice(idx, 1);
  return card;
}

function badTarget(what: string): never {
  throw new Error(`Invariant: invalid target for ${what}`);
}

// ---------------------------------------------------------------------------
// Jugadas
// ---------------------------------------------------------------------------

/** Juega un ÓRGANO en el cuerpo propio. */
export function playOrgan(state: GameState, playerId: string, cardId: string): GameState {
  const next = cloneState(state);
  const player = requirePlayer(next, playerId);
  const card = takeFromHand(player, cardId);
  player.body.push({
    slotId: `slot-${card.id}`,
    organCard: card,
    modifiers: [],
    status: 'HEALTHY',
  });
  return next;
}

/** SPEC §4.2.1: aplicar VIRUS. */
export function playVirus(
  state: GameState,
  playerId: string,
  cardId: string,
  target: PlayCardTarget,
): GameState {
  if (!target || !isSlotTarget(target)) badTarget('VIRUS');
  const next = cloneState(state);
  const actor = requirePlayer(next, playerId);
  const virus = takeFromHand(actor, cardId);
  const owner = requirePlayer(next, target.targetPlayerId);
  const slot = requireSlot(owner, target.targetSlotId);

  switch (slot.status) {
    case 'HEALTHY':
      slot.modifiers.push(virus);
      slot.status = computeOrganStatus(slot.modifiers);
      break;
    case 'VACCINATED':
      next.decks.discardPile.push(...slot.modifiers, virus);
      slot.modifiers = [];
      slot.status = 'HEALTHY';
      break;
    case 'INFECTED':
      next.decks.discardPile.push(slot.organCard, ...slot.modifiers, virus);
      owner.body = owner.body.filter((s) => s.slotId !== slot.slotId);
      break;
    case 'IMMUNIZED':
      throw new Error('Invariant: cannot infect an immunized organ');
  }
  return next;
}

/** SPEC §4.2.2: aplicar MEDICINA en el cuerpo propio. */
export function playMedicine(
  state: GameState,
  playerId: string,
  cardId: string,
  target: PlayCardTarget,
): GameState {
  if (!target || !isSlotTarget(target)) badTarget('MEDICINE');
  const next = cloneState(state);
  const actor = requirePlayer(next, playerId);
  const medicine = takeFromHand(actor, cardId);
  const slot = requireSlot(actor, target.targetSlotId);

  switch (slot.status) {
    case 'HEALTHY':
    case 'VACCINATED':
      slot.modifiers.push(medicine);
      slot.status = computeOrganStatus(slot.modifiers);
      break;
    case 'INFECTED':
      next.decks.discardPile.push(...slot.modifiers, medicine);
      slot.modifiers = [];
      slot.status = 'HEALTHY';
      break;
    case 'IMMUNIZED':
      throw new Error('Invariant: cannot medicate an immunized organ');
  }
  return next;
}

/** TRANSPLANT: intercambia dos OrganSlot conservando modifiers y status. */
export function playTransplant(
  state: GameState,
  playerId: string,
  cardId: string,
  target: PlayCardTarget,
): GameState {
  if (!target || !isTransplantTarget(target)) badTarget('TRANSPLANT');
  const next = cloneState(state);
  const actor = requirePlayer(next, playerId);
  const card = takeFromHand(actor, cardId);

  const a = requirePlayer(next, target.firstPlayerId);
  const b = requirePlayer(next, target.secondPlayerId);
  const idxA = a.body.findIndex((s) => s.slotId === target.firstSlotId);
  const idxB = b.body.findIndex((s) => s.slotId === target.secondSlotId);
  const slotA = a.body[idxA];
  const slotB = b.body[idxB];
  if (!slotA || !slotB) badTarget('TRANSPLANT');
  a.body[idxA] = slotB;
  b.body[idxB] = slotA;

  next.decks.discardPile.push(card);
  return next;
}

/** ORGAN_THIEF: roba un órgano rival (con sus modificadores) al cuerpo propio. */
export function playOrganThief(
  state: GameState,
  playerId: string,
  cardId: string,
  target: PlayCardTarget,
): GameState {
  if (!target || !isSlotTarget(target)) badTarget('ORGAN_THIEF');
  const next = cloneState(state);
  const actor = requirePlayer(next, playerId);
  const card = takeFromHand(actor, cardId);
  const rival = requirePlayer(next, target.targetPlayerId);
  const slot = requireSlot(rival, target.targetSlotId);

  rival.body = rival.body.filter((s) => s.slotId !== slot.slotId);
  actor.body.push(slot);

  next.decks.discardPile.push(card);
  return next;
}

/** CONTAGION: mueve virus de órganos propios infectados a órganos rivales sanos. */
export function playContagion(
  state: GameState,
  playerId: string,
  cardId: string,
  target: PlayCardTarget,
): GameState {
  if (!target || !isContagionTarget(target)) badTarget('CONTAGION');
  const next = cloneState(state);
  const actor = requirePlayer(next, playerId);
  const card = takeFromHand(actor, cardId);

  for (const t of target.transfers) {
    const from = requireSlot(actor, t.fromSlotId);
    const dest = requirePlayer(next, t.toPlayerId);
    const to = requireSlot(dest, t.toSlotId);
    const virusIdx = from.modifiers.findIndex((m) => m.type === 'VIRUS');
    const virus = from.modifiers[virusIdx];
    if (!virus) badTarget('CONTAGION');
    from.modifiers.splice(virusIdx, 1);
    from.status = computeOrganStatus(from.modifiers);
    to.modifiers.push(virus);
    to.status = computeOrganStatus(to.modifiers);
  }

  next.decks.discardPile.push(card);
  return next;
}

/** LATEX_GLOVE: las manos de todos los demás jugadores van al discardPile. */
export function playLatexGlove(state: GameState, playerId: string, cardId: string): GameState {
  const next = cloneState(state);
  const actor = requirePlayer(next, playerId);
  const card = takeFromHand(actor, cardId);

  next.decks.discardPile.push(card);
  for (const p of next.players) {
    if (p.playerId === playerId) continue;
    next.decks.discardPile.push(...p.hand);
    p.hand = [];
  }
  return next;
}

/** MEDICAL_ERROR: intercambia por completo el body con el del jugador objetivo. */
export function playMedicalError(
  state: GameState,
  playerId: string,
  cardId: string,
  target: PlayCardTarget,
): GameState {
  if (!target || !isPlayerTarget(target)) badTarget('MEDICAL_ERROR');
  const next = cloneState(state);
  const actor = requirePlayer(next, playerId);
  const card = takeFromHand(actor, cardId);
  const other = requirePlayer(next, target.targetPlayerId);

  const tmp = actor.body;
  actor.body = other.body;
  other.body = tmp;

  next.decks.discardPile.push(card);
  return next;
}

/** Despacha PLAY_CARD según el tipo de carta (pasos 3 del pipeline, sin robo). */
export function applyPlayCard(
  state: GameState,
  playerId: string,
  cardId: string,
  target: PlayCardTarget,
): GameState {
  const card = requirePlayer(state, playerId).hand.find((c) => c.id === cardId);
  if (!card) throw new Error(`Invariant: card ${cardId} not in hand`);

  switch (card.type) {
    case 'ORGAN':
      return playOrgan(state, playerId, cardId);
    case 'VIRUS':
      return playVirus(state, playerId, cardId, target);
    case 'MEDICINE':
      return playMedicine(state, playerId, cardId, target);
    case 'TREATMENT':
      switch (card.treatmentType) {
        case 'TRANSPLANT':
          return playTransplant(state, playerId, cardId, target);
        case 'ORGAN_THIEF':
          return playOrganThief(state, playerId, cardId, target);
        case 'CONTAGION':
          return playContagion(state, playerId, cardId, target);
        case 'LATEX_GLOVE':
          return playLatexGlove(state, playerId, cardId);
        case 'MEDICAL_ERROR':
          return playMedicalError(state, playerId, cardId, target);
        default:
          throw new Error('Invariant: unknown treatment');
      }
  }
}

/** DISCARD: mueve 1-3 cartas de la mano al discardPile. */
export function applyDiscard(
  state: GameState,
  playerId: string,
  cardIds: readonly string[],
): GameState {
  const next = cloneState(state);
  const player = requirePlayer(next, playerId);
  for (const id of cardIds) {
    next.decks.discardPile.push(takeFromHand(player, id));
  }
  return next;
}

// ---------------------------------------------------------------------------
// Robo de cartas
// ---------------------------------------------------------------------------

/** Roba `count` cartas para un jugador (con reciclaje del discardPile si hace falta). */
export function drawForPlayer(
  state: GameState,
  playerId: string,
  count: number,
  rng: Rng,
): GameState {
  const next = cloneState(state);
  const player = requirePlayer(next, playerId);
  const { cards, decks } = drawCards(next.decks, count, rng);
  player.hand.push(...cards);
  next.decks = decks;
  return next;
}

/** Paso 4: repone la mano hasta HAND_SIZE (3). */
export function refillHand(state: GameState, playerId: string, rng: Rng): GameState {
  const player = requirePlayer(state, playerId);
  const needed = HAND_SIZE - player.hand.length;
  if (needed <= 0) return cloneState(state);
  return drawForPlayer(state, playerId, needed, rng);
}
