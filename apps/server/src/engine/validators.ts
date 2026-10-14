import type {
  Card,
  GameActionPayload,
  GameState,
  OrganSlot,
  OrganStatus,
  PlayCardTarget,
  ServerPlayer,
} from '@virus/shared';
import { MAX_DISCARD_CARDS } from '@virus/shared';

// ---------------------------------------------------------------------------
// Tipos de resultado de validación
// ---------------------------------------------------------------------------

export type EngineErrorCode =
  | 'GAME_NOT_IN_PROGRESS'
  | 'PLAYER_NOT_FOUND'
  | 'NOT_YOUR_TURN'
  | 'CARD_NOT_IN_HAND'
  | 'INVALID_DISCARD_COUNT'
  | 'INVALID_TARGET'
  | 'DUPLICATE_ORGAN_COLOR'
  | 'INCOMPATIBLE_COLOR'
  | 'ORGAN_IMMUNIZED'
  | 'ORGAN_NOT_HEALTHY'
  | 'SAME_PLAYER'
  | 'EMPTY_TRANSFERS';

export interface EngineError {
  code: EngineErrorCode;
  message: string;
}

export type ValidationResult = { ok: true } | { ok: false; error: EngineError };

const OK: ValidationResult = { ok: true };

function fail(code: EngineErrorCode, message: string): ValidationResult {
  return { ok: false, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Helpers de consulta (puros, no lanzan)
// ---------------------------------------------------------------------------

export function findPlayer(state: GameState, playerId: string): ServerPlayer | undefined {
  return state.players.find((p) => p.playerId === playerId);
}

export function findSlot(player: ServerPlayer, slotId: string): OrganSlot | undefined {
  return player.body.find((s) => s.slotId === slotId);
}

/** Estado derivado de los modificadores apilados (SPEC §4.2). */
export function computeOrganStatus(modifiers: readonly Card[]): OrganStatus {
  if (modifiers.some((m) => m.type === 'VIRUS')) return 'INFECTED';
  const medicines = modifiers.filter((m) => m.type === 'MEDICINE').length;
  if (medicines >= 2) return 'IMMUNIZED';
  if (medicines === 1) return 'VACCINATED';
  return 'HEALTHY';
}

/** SPEC §4.1: compatibilidad de color entre un modificador y un órgano. */
export function isColorCompatible(modifier: Card, slot: OrganSlot): boolean {
  return (
    modifier.color === slot.organCard.color ||
    modifier.color === 'MULTICOLOR' ||
    slot.organCard.color === 'MULTICOLOR'
  );
}

/** Un órgano cuenta para la victoria si NO está infectado (SPEC §1). */
export function isHealthyForVictory(slot: OrganSlot): boolean {
  return slot.status === 'HEALTHY' || slot.status === 'VACCINATED' || slot.status === 'IMMUNIZED';
}

export function countHealthyOrgans(player: ServerPlayer): number {
  return player.body.filter(isHealthyForVictory).length;
}

export function hasOrganColor(body: readonly OrganSlot[], color: Card['color']): boolean {
  return body.some((s) => s.organCard.color === color);
}

// ---------------------------------------------------------------------------
// Type guards de PlayCardTarget
// ---------------------------------------------------------------------------

export type SlotTarget = { targetPlayerId: string; targetSlotId: string };
export type TransplantTarget = {
  firstPlayerId: string;
  firstSlotId: string;
  secondPlayerId: string;
  secondSlotId: string;
};
export type ContagionTarget = {
  transfers: Array<{ fromSlotId: string; toPlayerId: string; toSlotId: string }>;
};
export type PlayerTarget = { targetPlayerId: string };

export function isSlotTarget(t: PlayCardTarget): t is SlotTarget {
  return t !== null && 'targetPlayerId' in t && 'targetSlotId' in t;
}
export function isTransplantTarget(t: PlayCardTarget): t is TransplantTarget {
  return t !== null && 'firstPlayerId' in t && 'secondPlayerId' in t;
}
export function isContagionTarget(t: PlayCardTarget): t is ContagionTarget {
  return t !== null && 'transfers' in t;
}
export function isPlayerTarget(t: PlayCardTarget): t is PlayerTarget {
  return t !== null && 'targetPlayerId' in t && !('targetSlotId' in t);
}

// ---------------------------------------------------------------------------
// Paso 1 del pipeline: turno y propiedad
// ---------------------------------------------------------------------------

export function validateTurn(state: GameState, playerId: string): ValidationResult {
  if (state.status !== 'IN_PROGRESS') {
    return fail('GAME_NOT_IN_PROGRESS', 'La partida no está en curso.');
  }
  if (!findPlayer(state, playerId)) {
    return fail('PLAYER_NOT_FOUND', 'Jugador no encontrado.');
  }
  if (state.turnState.currentPlayerId !== playerId) {
    return fail('NOT_YOUR_TURN', 'No es tu turno.');
  }
  return OK;
}

// ---------------------------------------------------------------------------
// Paso 2 del pipeline: reglas de dominio
// ---------------------------------------------------------------------------

export function validateDiscard(
  state: GameState,
  playerId: string,
  cardIds: readonly string[],
): ValidationResult {
  const turn = validateTurn(state, playerId);
  if (!turn.ok) return turn;
  const player = findPlayer(state, playerId) as ServerPlayer;

  if (cardIds.length < 1 || cardIds.length > MAX_DISCARD_CARDS) {
    return fail('INVALID_DISCARD_COUNT', 'Debes descartar entre 1 y 3 cartas.');
  }
  if (new Set(cardIds).size !== cardIds.length) {
    return fail('CARD_NOT_IN_HAND', 'Cartas duplicadas en el descarte.');
  }
  for (const id of cardIds) {
    if (!player.hand.some((c) => c.id === id)) {
      return fail('CARD_NOT_IN_HAND', 'La carta no está en tu mano.');
    }
  }
  return OK;
}

export function validatePlayCard(
  state: GameState,
  playerId: string,
  cardId: string,
  target: PlayCardTarget,
): ValidationResult {
  const turn = validateTurn(state, playerId);
  if (!turn.ok) return turn;
  const player = findPlayer(state, playerId) as ServerPlayer;

  const card = player.hand.find((c) => c.id === cardId);
  if (!card) return fail('CARD_NOT_IN_HAND', 'La carta no está en tu mano.');

  switch (card.type) {
    case 'ORGAN':
      return validateOrgan(player, card, target);
    case 'VIRUS':
      return validateVirus(state, card, target);
    case 'MEDICINE':
      return validateMedicine(player, card, target);
    case 'TREATMENT':
      return validateTreatment(state, player, card, target);
  }
}

function validateOrgan(player: ServerPlayer, card: Card, target: PlayCardTarget): ValidationResult {
  if (target !== null) return fail('INVALID_TARGET', 'Un órgano no requiere objetivo.');
  if (hasOrganColor(player.body, card.color)) {
    return fail('DUPLICATE_ORGAN_COLOR', 'Ya tienes un órgano de ese color.');
  }
  return OK;
}

function validateVirus(state: GameState, card: Card, target: PlayCardTarget): ValidationResult {
  if (target === null || !isSlotTarget(target)) {
    return fail('INVALID_TARGET', 'El virus requiere un órgano objetivo.');
  }
  const owner = findPlayer(state, target.targetPlayerId);
  const slot = owner ? findSlot(owner, target.targetSlotId) : undefined;
  if (!owner || !slot) return fail('INVALID_TARGET', 'Órgano objetivo inexistente.');
  if (!isColorCompatible(card, slot)) {
    return fail('INCOMPATIBLE_COLOR', 'El virus no es compatible con ese órgano.');
  }
  if (slot.status === 'IMMUNIZED') {
    return fail('ORGAN_IMMUNIZED', 'Un órgano inmunizado no puede ser infectado.');
  }
  return OK;
}

function validateMedicine(
  player: ServerPlayer,
  card: Card,
  target: PlayCardTarget,
): ValidationResult {
  if (target === null || !isSlotTarget(target)) {
    return fail('INVALID_TARGET', 'La medicina requiere un órgano objetivo.');
  }
  if (target.targetPlayerId !== player.playerId) {
    return fail('INVALID_TARGET', 'La medicina solo puede aplicarse en tu propio cuerpo.');
  }
  const slot = findSlot(player, target.targetSlotId);
  if (!slot) return fail('INVALID_TARGET', 'Órgano objetivo inexistente.');
  if (!isColorCompatible(card, slot)) {
    return fail('INCOMPATIBLE_COLOR', 'La medicina no es compatible con ese órgano.');
  }
  if (slot.status === 'IMMUNIZED') {
    return fail('ORGAN_IMMUNIZED', 'El órgano ya está inmunizado.');
  }
  return OK;
}

function validateTreatment(
  state: GameState,
  player: ServerPlayer,
  card: Card,
  target: PlayCardTarget,
): ValidationResult {
  switch (card.treatmentType) {
    case 'TRANSPLANT':
      return validateTransplant(state, target);
    case 'ORGAN_THIEF':
      return validateOrganThief(state, player, target);
    case 'CONTAGION':
      return validateContagion(state, player, target);
    case 'LATEX_GLOVE':
      return target === null
        ? OK
        : fail('INVALID_TARGET', 'El Guante de Látex no requiere objetivo.');
    case 'MEDICAL_ERROR':
      return validateMedicalError(state, player, target);
    default:
      return fail('INVALID_TARGET', 'Tratamiento desconocido.');
  }
}

function validateTransplant(state: GameState, target: PlayCardTarget): ValidationResult {
  if (target === null || !isTransplantTarget(target)) {
    return fail('INVALID_TARGET', 'El Trasplante requiere dos órganos objetivo.');
  }
  if (target.firstPlayerId === target.secondPlayerId) {
    return fail('SAME_PLAYER', 'Los órganos deben pertenecer a jugadores distintos.');
  }
  const a = findPlayer(state, target.firstPlayerId);
  const b = findPlayer(state, target.secondPlayerId);
  const slotA = a ? findSlot(a, target.firstSlotId) : undefined;
  const slotB = b ? findSlot(b, target.secondSlotId) : undefined;
  if (!a || !b || !slotA || !slotB) {
    return fail('INVALID_TARGET', 'Órgano objetivo inexistente.');
  }
  if (slotA.status === 'IMMUNIZED' || slotB.status === 'IMMUNIZED') {
    return fail('ORGAN_IMMUNIZED', 'No se pueden trasplantar órganos inmunizados.');
  }
  const bodyAAfter = a.body.filter((s) => s.slotId !== slotA.slotId);
  const bodyBAfter = b.body.filter((s) => s.slotId !== slotB.slotId);
  if (
    hasOrganColor(bodyAAfter, slotB.organCard.color) ||
    hasOrganColor(bodyBAfter, slotA.organCard.color)
  ) {
    return fail('DUPLICATE_ORGAN_COLOR', 'El intercambio dejaría un color duplicado.');
  }
  return OK;
}

function validateOrganThief(
  state: GameState,
  player: ServerPlayer,
  target: PlayCardTarget,
): ValidationResult {
  if (target === null || !isSlotTarget(target)) {
    return fail('INVALID_TARGET', 'El Ladrón de Órganos requiere un órgano objetivo.');
  }
  if (target.targetPlayerId === player.playerId) {
    return fail('SAME_PLAYER', 'Debes robar un órgano a un rival.');
  }
  const rival = findPlayer(state, target.targetPlayerId);
  const slot = rival ? findSlot(rival, target.targetSlotId) : undefined;
  if (!rival || !slot) return fail('INVALID_TARGET', 'Órgano objetivo inexistente.');
  if (slot.status === 'IMMUNIZED') {
    return fail('ORGAN_IMMUNIZED', 'No se puede robar un órgano inmunizado.');
  }
  if (hasOrganColor(player.body, slot.organCard.color)) {
    return fail('DUPLICATE_ORGAN_COLOR', 'Ya tienes un órgano de ese color.');
  }
  return OK;
}

function validateContagion(
  state: GameState,
  player: ServerPlayer,
  target: PlayCardTarget,
): ValidationResult {
  if (target === null || !isContagionTarget(target)) {
    return fail('INVALID_TARGET', 'El Contagio requiere una lista de transferencias.');
  }
  if (target.transfers.length === 0) {
    return fail('EMPTY_TRANSFERS', 'Debes transferir al menos un virus.');
  }
  const usedFrom = new Set<string>();
  const usedTo = new Set<string>();
  for (const t of target.transfers) {
    if (usedFrom.has(t.fromSlotId) || usedTo.has(t.toSlotId)) {
      return fail('INVALID_TARGET', 'Transferencia duplicada.');
    }
    usedFrom.add(t.fromSlotId);
    usedTo.add(t.toSlotId);

    const from = findSlot(player, t.fromSlotId);
    if (!from) return fail('INVALID_TARGET', 'El órgano de origen no es tuyo.');
    if (from.status !== 'INFECTED') {
      return fail('INVALID_TARGET', 'El órgano de origen no está infectado.');
    }
    if (t.toPlayerId === player.playerId) {
      return fail('SAME_PLAYER', 'El destino debe ser otro jugador.');
    }
    const dest = findPlayer(state, t.toPlayerId);
    const to = dest ? findSlot(dest, t.toSlotId) : undefined;
    if (!dest || !to) return fail('INVALID_TARGET', 'Órgano destino inexistente.');
    if (to.status !== 'HEALTHY') {
      return fail('ORGAN_NOT_HEALTHY', 'El órgano destino debe estar completamente libre.');
    }
    const virus = from.modifiers.find((m) => m.type === 'VIRUS');
    if (!virus || !isColorCompatible(virus, to)) {
      return fail('INCOMPATIBLE_COLOR', 'El virus no es compatible con el órgano destino.');
    }
  }
  return OK;
}

function validateMedicalError(
  state: GameState,
  player: ServerPlayer,
  target: PlayCardTarget,
): ValidationResult {
  if (target === null || !isPlayerTarget(target)) {
    return fail('INVALID_TARGET', 'El Error Médico requiere un jugador objetivo.');
  }
  if (target.targetPlayerId === player.playerId) {
    return fail('SAME_PLAYER', 'Debes elegir a otro jugador.');
  }
  if (!findPlayer(state, target.targetPlayerId)) {
    return fail('PLAYER_NOT_FOUND', 'Jugador objetivo inexistente.');
  }
  return OK;
}

// ---------------------------------------------------------------------------
// Punto de entrada unificado
// ---------------------------------------------------------------------------

export function validateAction(state: GameState, action: GameActionPayload): ValidationResult {
  if (action.actionType === 'DISCARD') {
    return validateDiscard(state, action.playerId, action.payload.cardIds);
  }
  return validatePlayCard(state, action.playerId, action.payload.cardId, action.payload.target);
}
