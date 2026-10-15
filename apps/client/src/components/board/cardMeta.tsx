import {
  ArrowLeftRight,
  Bean,
  Biohazard,
  Bone,
  Brain,
  Bug,
  Crosshair,
  Hand,
  Heart,
  Lock,
  ShieldCheck,
  Shuffle,
  Skull,
  Sparkles,
  Syringe,
  type LucideIcon,
} from 'lucide-react';
import type {
  ActionLog,
  Card,
  CardColor,
  CardType,
  ClientGameStateDTO,
  OrganSlot,
  OrganStatus,
  TreatmentType,
} from '@virus/shared';

// ---------------------------------------------------------------------------
// Colores / órganos
// ---------------------------------------------------------------------------

export interface ColorStyle {
  /** Nombre del color en español. */
  label: string;
  /** Nombre del órgano asociado. */
  organName: string;
  Icon: LucideIcon;
  /** Clases del marco + fondo de la carta (cara). */
  face: string;
  /** Clases de texto de acento. */
  text: string;
  /** Clases de chip/etiqueta. */
  chip: string;
  /** Color de resplandor (box-shadow) como valor CSS. */
  glow: string;
}

export const COLOR_STYLES: Record<CardColor, ColorStyle> = {
  RED: {
    label: 'Rojo',
    organName: 'Corazón',
    Icon: Heart,
    face: 'border-rose-400/70 bg-linear-to-br from-rose-500/45 via-rose-900/60 to-ink-950',
    text: 'text-rose-300',
    chip: 'bg-rose-500/20 text-rose-200 border-rose-400/40',
    glow: 'hsl(350 90% 60% / 0.55)',
  },
  GREEN: {
    label: 'Verde',
    organName: 'Estómago',
    Icon: Bean,
    face: 'border-emerald-400/70 bg-linear-to-br from-emerald-500/45 via-emerald-900/60 to-ink-950',
    text: 'text-emerald-300',
    chip: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40',
    glow: 'hsl(152 90% 55% / 0.55)',
  },
  BLUE: {
    label: 'Azul',
    organName: 'Cerebro',
    Icon: Brain,
    face: 'border-sky-400/70 bg-linear-to-br from-sky-500/45 via-sky-900/60 to-ink-950',
    text: 'text-sky-300',
    chip: 'bg-sky-500/20 text-sky-200 border-sky-400/40',
    glow: 'hsl(200 95% 60% / 0.55)',
  },
  YELLOW: {
    label: 'Amarillo',
    organName: 'Hueso',
    Icon: Bone,
    face: 'border-amber-300/70 bg-linear-to-br from-amber-400/45 via-amber-900/55 to-ink-950',
    text: 'text-amber-200',
    chip: 'bg-amber-400/20 text-amber-100 border-amber-300/40',
    glow: 'hsl(45 95% 58% / 0.55)',
  },
  MULTICOLOR: {
    label: 'Multicolor',
    organName: 'Comodín',
    Icon: Sparkles,
    face: 'border-white/50 bg-rainbow-soft',
    text: 'text-white',
    chip: 'bg-rainbow-soft text-white border-white/40',
    glow: 'hsl(290 90% 65% / 0.55)',
  },
  NONE: {
    label: 'Tratamiento',
    organName: 'Tratamiento',
    Icon: Syringe,
    face: 'border-fuchsia-400/70 bg-linear-to-br from-fuchsia-500/40 via-purple-900/60 to-ink-950',
    text: 'text-fuchsia-300',
    chip: 'bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-400/40',
    glow: 'hsl(290 90% 62% / 0.55)',
  },
};

export const ORGAN_FULL_NAMES: Record<Exclude<CardColor, 'NONE'>, string> = {
  RED: 'Corazón',
  GREEN: 'Estómago',
  BLUE: 'Cerebro',
  YELLOW: 'Hueso',
  MULTICOLOR: 'Órgano Comodín',
};

// ---------------------------------------------------------------------------
// Tipos de carta y tratamientos
// ---------------------------------------------------------------------------

export const CARD_TYPE_META: Record<CardType, { label: string; Icon: LucideIcon }> = {
  ORGAN: { label: 'Órgano', Icon: Heart },
  VIRUS: { label: 'Virus', Icon: Biohazard },
  MEDICINE: { label: 'Medicina', Icon: Syringe },
  TREATMENT: { label: 'Tratamiento', Icon: Syringe },
};

export const TREATMENT_META: Record<
  TreatmentType,
  { name: string; description: string; Icon: LucideIcon }
> = {
  TRANSPLANT: {
    name: 'Trasplante',
    description: 'Intercambia dos órganos de jugadores distintos.',
    Icon: ArrowLeftRight,
  },
  ORGAN_THIEF: {
    name: 'Ladrón de Órganos',
    description: 'Roba un órgano de un rival para tu cuerpo.',
    Icon: Crosshair,
  },
  CONTAGION: {
    name: 'Contagio',
    description: 'Pasa tus virus a órganos sanos rivales.',
    Icon: Bug,
  },
  LATEX_GLOVE: {
    name: 'Guante de Látex',
    description: 'Todos los demás descartan su mano.',
    Icon: Hand,
  },
  MEDICAL_ERROR: {
    name: 'Error Médico',
    description: 'Intercambia tu cuerpo entero con un rival.',
    Icon: Shuffle,
  },
};

// ---------------------------------------------------------------------------
// Estados de órgano
// ---------------------------------------------------------------------------

export const STATUS_META: Record<
  OrganStatus,
  { label: string; Icon: LucideIcon; badge: string }
> = {
  HEALTHY: {
    label: 'Sano',
    Icon: Heart,
    badge: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50',
  },
  INFECTED: {
    label: 'Infectado',
    Icon: Skull,
    badge: 'bg-lime-400/20 text-lime-200 border-lime-300/60',
  },
  VACCINATED: {
    label: 'Vacunado',
    Icon: ShieldCheck,
    badge: 'bg-sky-500/20 text-sky-200 border-sky-400/50',
  },
  IMMUNIZED: {
    label: 'Inmunizado',
    Icon: Lock,
    badge: 'bg-amber-400/20 text-amber-100 border-amber-300/60',
  },
};


// ---------------------------------------------------------------------------
// Utilidades de reglas (SOLO para resaltar opciones; el servidor es la autoridad)
// ---------------------------------------------------------------------------

/** SPEC §4.1: compatibilidad de color modificador ↔ órgano. */
export function isColorCompatible(modifierColor: CardColor, organColor: CardColor): boolean {
  return (
    modifierColor === organColor || modifierColor === 'MULTICOLOR' || organColor === 'MULTICOLOR'
  );
}

/** SPEC §1: órgano sano = HEALTHY | VACCINATED | IMMUNIZED. */
export function isHealthyForWin(slot: OrganSlot): boolean {
  return slot.status !== 'INFECTED';
}

export function countWinningOrgans(body: OrganSlot[]): number {
  return body.filter(isHealthyForWin).length;
}

/** Primer virus apilado en el órgano (si está infectado). */
export function getSlotVirus(slot: OrganSlot): Card | undefined {
  return slot.modifiers.find((m) => m.type === 'VIRUS');
}

// ---------------------------------------------------------------------------
// Texto del feed de última jugada
// ---------------------------------------------------------------------------

const TYPE_FROM_PREFIX: Record<string, CardType> = {
  organ: 'ORGAN',
  virus: 'VIRUS',
  medicine: 'MEDICINE',
};

const TREATMENT_FROM_PREFIX: Record<string, TreatmentType> = {
  transplant: 'TRANSPLANT',
  organ_thief: 'ORGAN_THIEF',
  contagion: 'CONTAGION',
  latex_glove: 'LATEX_GLOVE',
  medical_error: 'MEDICAL_ERROR',
};

/** Todas las cartas visibles para el jugador (para resolver ids → nombre). */
function knownCards(game: ClientGameStateDTO): Card[] {
  const cards: Card[] = [...game.me.hand];
  if (game.decks.topDiscardCard) cards.push(game.decks.topDiscardCard);
  const bodies = [game.me.body, ...game.opponents.map((o) => o.body)];
  for (const body of bodies) {
    for (const slot of body) cards.push(slot.organCard, ...slot.modifiers);
  }
  return cards;
}

/**
 * Los ids del mazo tienen forma `organ-red-03`, `virus-multicolor-62`, `treatment-organ_thief-65`.
 * Si la carta no está visible, se reconstruye el nombre a partir del prefijo del id.
 */
export function cardNameFromId(cardId: string, game: ClientGameStateDTO): string {
  const known = knownCards(game).find((c) => c.id === cardId);
  if (known) return known.name;

  const parts = cardId.split('-');
  const kind = parts[0] ?? '';
  const sub = parts[1] ?? '';
  const treatment = kind === 'treatment' ? TREATMENT_FROM_PREFIX[sub] : undefined;
  if (treatment) return TREATMENT_META[treatment].name;

  const type = TYPE_FROM_PREFIX[kind];
  const color = sub.toUpperCase() as CardColor;
  const style = COLOR_STYLES[color];
  if (type && style) {
    if (type === 'ORGAN') {
      return color === 'MULTICOLOR' ? ORGAN_FULL_NAMES.MULTICOLOR : `Órgano ${style.organName}`;
    }
    return `${CARD_TYPE_META[type].label} ${style.label}`;
  }
  return 'una carta';
}

export function nicknameOf(game: ClientGameStateDTO, playerId: string): string {
  if (game.me.playerId === playerId) return game.me.nickname;
  return game.opponents.find((o) => o.playerId === playerId)?.nickname ?? 'Un jugador';
}

/** Traduce `lastActionLog` a un mensaje legible en español. */
export function describeLastAction(game: ClientGameStateDTO, log: ActionLog): string {
  const actor = log.actorId === game.me.playerId ? 'Tú' : nicknameOf(game, log.actorId);
  const isYou = log.actorId === game.me.playerId;
  const cardName = log.cardPlayed ? cardNameFromId(log.cardPlayed, game) : null;

  switch (log.actionType) {
    case 'PLAY_CARD': {
      const verb = isYou ? 'jugaste' : 'jugó';
      const targets = (log.targets ?? [])
        .filter((id, i, arr) => arr.indexOf(id) === i)
        .map((id) => (id === game.me.playerId ? 'ti' : nicknameOf(game, id)));
      const suffix = targets.length ? ` sobre ${targets.join(' y ')}` : '';
      return `${actor} ${verb} ${cardName ?? 'una carta'}${suffix}.`;
    }
    case 'DISCARD':
      return isYou ? 'Tú descartaste cartas de tu mano.' : `${actor} descartó cartas de su mano.`;
    case 'AUTO_PASS':
      return `⏱ Auto-Pass: a ${isYou ? 'ti' : nicknameOf(game, log.actorId)} se le acabó el tiempo${
        cardName ? ` y se descartó ${cardName}` : ''
      }.`;
    case 'LATEX_GLOVE_SKIP':
      return `🧤 ${isYou ? 'Tu turno fue saltado' : `Turno de ${nicknameOf(game, log.actorId)} saltado`} por el Guante de Látex.`;
    default:
      return '';
  }
}
