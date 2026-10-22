import type { Card, CardColor, TreatmentType } from './types';

export const DECK_SIZE = 68;
export const HAND_SIZE = 3;
export const MAX_DISCARD_CARDS = 3;
export const LATEX_GLOVE_REFILL = 3;

export const DEFAULT_CONFIG = {
  minPlayers: 2,
  maxPlayers: 6,
  organsToWin: 4,
  turnTimeoutSeconds: 45,
} as const;

export const MIN_TURN_TIMEOUT_SECONDS = 15;
export const MAX_TURN_TIMEOUT_SECONDS = 120;

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export const GC_INTERVAL_MS = 5 * 60 * 1000;
export const GC_ALL_DISCONNECTED_MS = 10 * 60 * 1000;
export const GC_IDLE_MS = 30 * 60 * 1000;

export const BASE_COLORS = ['RED', 'GREEN', 'BLUE', 'YELLOW'] as const;

const COLOR_NAMES: Record<Exclude<CardColor, 'NONE'>, string> = {
  RED: 'Rojo',
  GREEN: 'Verde',
  BLUE: 'Azul',
  YELLOW: 'Amarillo',
  MULTICOLOR: 'Multicolor',
};

const ORGAN_NAMES: Record<Exclude<CardColor, 'NONE'>, string> = {
  RED: 'Corazón',
  GREEN: 'Estómago',
  BLUE: 'Cerebro',
  YELLOW: 'Hueso',
  MULTICOLOR: 'Órgano Comodín',
};

export const TREATMENT_COMPOSITION: ReadonlyArray<{
  treatmentType: TreatmentType;
  name: string;
  count: number;
}> = [
  { treatmentType: 'TRANSPLANT', name: 'Trasplante', count: 3 },
  { treatmentType: 'ORGAN_THIEF', name: 'Ladrón de Órganos', count: 3 },
  { treatmentType: 'CONTAGION', name: 'Contagio', count: 2 },
  { treatmentType: 'LATEX_GLOVE', name: 'Guante de Látex', count: 1 },
  { treatmentType: 'MEDICAL_ERROR', name: 'Error Médico', count: 1 },
];

/**
 * Genera el mazo ordenado (sin barajar) de exactamente 68 cartas con ids únicos.
 * Determinista: el barajado (Fisher-Yates) es responsabilidad del motor.
 */
export function createDeck(): Card[] {
  const cards: Card[] = [];
  let seq = 0;
  const push = (card: Omit<Card, 'id'>, prefix: string): void => {
    seq += 1;
    cards.push({ id: `${prefix}-${String(seq).padStart(2, '0')}`, ...card });
  };

  // ORGAN: 5 de cada color base + 1 multicolor = 21
  for (const color of BASE_COLORS) {
    for (let i = 0; i < 5; i++) {
      push(
        { type: 'ORGAN', color, treatmentType: null, name: `Órgano ${ORGAN_NAMES[color]}` },
        `organ-${color.toLowerCase()}`,
      );
    }
  }
  push(
    { type: 'ORGAN', color: 'MULTICOLOR', treatmentType: null, name: ORGAN_NAMES.MULTICOLOR },
    'organ-multicolor',
  );

  // VIRUS: 4 de cada color base + 1 multicolor = 17
  for (const color of BASE_COLORS) {
    for (let i = 0; i < 4; i++) {
      push(
        { type: 'VIRUS', color, treatmentType: null, name: `Virus ${COLOR_NAMES[color]}` },
        `virus-${color.toLowerCase()}`,
      );
    }
  }
  push(
    { type: 'VIRUS', color: 'MULTICOLOR', treatmentType: null, name: 'Virus Multicolor' },
    'virus-multicolor',
  );

  // MEDICINE: 4 de cada uno de los 5 colores = 20
  for (const color of [...BASE_COLORS, 'MULTICOLOR'] as const) {
    for (let i = 0; i < 4; i++) {
      push(
        { type: 'MEDICINE', color, treatmentType: null, name: `Medicina ${COLOR_NAMES[color]}` },
        `medicine-${color.toLowerCase()}`,
      );
    }
  }

  // TREATMENT: 3 + 3 + 2 + 1 + 1 = 10
  for (const t of TREATMENT_COMPOSITION) {
    for (let i = 0; i < t.count; i++) {
      push(
        { type: 'TREATMENT', color: 'NONE', treatmentType: t.treatmentType, name: t.name },
        `treatment-${t.treatmentType.toLowerCase()}`,
      );
    }
  }

  if (cards.length !== DECK_SIZE) {
    throw new Error(`Deck invariant violated: expected ${DECK_SIZE}, got ${cards.length}`);
  }
  return cards;
}
