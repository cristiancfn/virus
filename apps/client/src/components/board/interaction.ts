import type { Card, ClientGameStateDTO, OrganSlot } from '@virus/shared';
import { getSlotVirus, isColorCompatible } from './cardMeta';
import type { SlotHighlight } from './OrganSlotView';

/**
 * Máquina de estados LOCAL de la UI (solo selección de objetivos). El cliente jamás calcula el
 * resultado de una jugada: estas utilidades únicamente resaltan opciones plausibles; el servidor
 * valida y resuelve (AGENTS.md §3.1).
 */

export interface ContagionTransfer {
  fromSlotId: string;
  toPlayerId: string;
  toSlotId: string;
}

export type Interaction =
  | { kind: 'IDLE' }
  | { kind: 'DISCARD'; selected: string[] }
  /** VIRUS, MEDICINE u ORGAN_THIEF: elegir un OrganSlot. */
  | { kind: 'TARGET_SLOT'; card: Card }
  /** MEDICAL_ERROR: elegir un rival. */
  | { kind: 'TARGET_PLAYER'; card: Card }
  | { kind: 'TRANSPLANT'; card: Card; first: { playerId: string; slotId: string } | null }
  | {
      kind: 'CONTAGION';
      card: Card;
      transfers: ContagionTransfer[];
      pendingFromSlotId: string | null;
    };

export const IDLE: Interaction = { kind: 'IDLE' };

export function bodyOf(game: ClientGameStateDTO, playerId: string): OrganSlot[] {
  if (game.me.playerId === playerId) return game.me.body;
  return game.opponents.find((o) => o.playerId === playerId)?.body ?? [];
}

function hasColor(body: OrganSlot[], color: Card['color'], exceptSlotId?: string): boolean {
  return body.some((s) => s.slotId !== exceptSlotId && s.organCard.color === color);
}

/** Resaltado de un OrganSlot según la interacción activa. */
export function computeSlotHighlight(
  interaction: Interaction,
  game: ClientGameStateDTO,
  ownerId: string,
  slot: OrganSlot,
): SlotHighlight {
  const isMine = ownerId === game.me.playerId;
  const immunized = slot.status === 'IMMUNIZED';

  switch (interaction.kind) {
    case 'TARGET_SLOT': {
      const { card } = interaction;
      if (immunized) return 'dim';
      if (card.type === 'MEDICINE') {
        return isMine && isColorCompatible(card.color, slot.organCard.color) ? 'valid' : 'dim';
      }
      if (card.type === 'VIRUS') {
        return isColorCompatible(card.color, slot.organCard.color) ? 'valid' : 'dim';
      }
      if (card.treatmentType === 'ORGAN_THIEF') {
        return !isMine && !hasColor(game.me.body, slot.organCard.color) ? 'valid' : 'dim';
      }
      return 'dim';
    }

    case 'TRANSPLANT': {
      if (immunized) return 'dim';
      const { first } = interaction;
      if (!first) return 'valid';
      if (first.slotId === slot.slotId) return 'selected';
      if (ownerId === first.playerId) return 'dim';
      const firstSlot = bodyOf(game, first.playerId).find((s) => s.slotId === first.slotId);
      if (!firstSlot) return 'dim';
      // Tras el intercambio ninguno puede repetir color (SPEC §4.3.1).
      const firstOk = !hasColor(bodyOf(game, first.playerId), slot.organCard.color, first.slotId);
      const secondOk = !hasColor(bodyOf(game, ownerId), firstSlot.organCard.color, slot.slotId);
      return firstOk && secondOk ? 'valid' : 'dim';
    }

    case 'CONTAGION': {
      const usedFrom = new Set(interaction.transfers.map((t) => t.fromSlotId));
      const usedTo = new Set(interaction.transfers.map((t) => t.toSlotId));
      if (isMine) {
        if (slot.slotId === interaction.pendingFromSlotId) return 'selected';
        if (slot.status === 'INFECTED' && !usedFrom.has(slot.slotId)) return 'valid';
        return 'dim';
      }
      const fromSlot = game.me.body.find((s) => s.slotId === interaction.pendingFromSlotId);
      const virus = fromSlot ? getSlotVirus(fromSlot) : undefined;
      if (!virus) return 'dim';
      if (usedTo.has(slot.slotId)) return 'dim';
      return slot.status === 'HEALTHY' && isColorCompatible(virus.color, slot.organCard.color)
        ? 'valid'
        : 'dim';
    }

    default:
      return 'none';
  }
}

/** Texto guía mostrado mientras el jugador elige objetivos. */
export function promptFor(interaction: Interaction): string | null {
  switch (interaction.kind) {
    case 'TARGET_SLOT': {
      const { card } = interaction;
      if (card.type === 'MEDICINE') return 'Elige uno de TUS órganos para aplicar la medicina.';
      if (card.type === 'VIRUS') return 'Elige un órgano compatible (no inmunizado) para infectarlo.';
      return 'Elige el órgano de un rival que quieres robar.';
    }
    case 'TARGET_PLAYER':
      return 'Elige al rival con quien intercambiarás tu cuerpo completo.';
    case 'TRANSPLANT':
      return interaction.first
        ? 'Paso 2/2: elige el segundo órgano (de otro jugador distinto).'
        : 'Paso 1/2: elige el primer órgano a intercambiar (no inmunizado).';
    case 'CONTAGION':
      return interaction.pendingFromSlotId
        ? 'Ahora elige un órgano rival SANO y compatible para pasarle el virus.'
        : 'Elige uno de tus órganos INFECTADOS para mover su virus.';
    default:
      return null;
  }
}
