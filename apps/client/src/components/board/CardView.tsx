import { motion } from 'framer-motion';
import { Biohazard, Syringe } from 'lucide-react';
import type { Card } from '@virus/shared';
import { CARD_TYPE_META, COLOR_STYLES, TREATMENT_META } from './cardMeta';

export type CardSize = 'xs' | 'sm' | 'md';

const SIZE_CLASSES: Record<CardSize, string> = {
  xs: 'h-14 w-10 rounded-lg',
  sm: 'h-28 w-20 rounded-xl',
  md: 'h-44 w-28 rounded-2xl',
};

interface CardViewProps {
  card?: Card;
  /** Dorso de carta (rivales / mazo). */
  faceDown?: boolean;
  size?: CardSize;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}

/** Carta del juego: distingue colores, tipo y (en tratamientos) describe el efecto en español. */
export function CardView({
  card,
  faceDown = false,
  size = 'md',
  selected = false,
  disabled = false,
  onClick,
  className = '',
}: CardViewProps) {
  const interactive = Boolean(onClick) && !disabled;
  const base = `relative shrink-0 select-none overflow-hidden border-2 ${SIZE_CLASSES[size]} ${className}`;

  if (faceDown || !card) {
    return (
      <div className={`${base} card-back flex items-center justify-center`} aria-label="Carta boca abajo">
        <Biohazard className="text-virus-400/50" size={size === 'md' ? 34 : size === 'sm' ? 24 : 16} />
      </div>
    );
  }

  const style = COLOR_STYLES[card.color];
  const treatment = card.treatmentType ? TREATMENT_META[card.treatmentType] : null;
  const typeMeta = CARD_TYPE_META[card.type];

  // Ícono central según el tipo de carta.
  let CenterIcon = style.Icon;
  if (card.type === 'VIRUS') CenterIcon = Biohazard;
  else if (card.type === 'MEDICINE') CenterIcon = Syringe;
  else if (treatment) CenterIcon = treatment.Icon;

  const iconSize = size === 'md' ? 36 : size === 'sm' ? 26 : 18;
  const title = treatment ? treatment.name : card.name;

  return (
    <motion.div
      role={onClick ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={onClick ? selected : undefined}
      aria-disabled={onClick ? disabled : undefined}
      title={treatment ? `${treatment.name}: ${treatment.description}` : card.name}
      onClick={interactive ? onClick : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      whileHover={interactive ? { y: -10, scale: 1.05 } : undefined}
      whileTap={interactive ? { scale: 0.96 } : undefined}
      animate={{ y: selected ? -18 : 0, opacity: disabled && onClick ? 0.55 : 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      style={selected ? { boxShadow: `0 0 0 3px white, 0 10px 34px ${style.glow}` } : { boxShadow: `0 6px 18px -8px ${style.glow}` }}
      className={`${base} ${style.face} ${interactive ? 'cursor-pointer' : ''}`}
    >
      {size === 'xs' ? (
        <div className="flex h-full items-center justify-center">
          <CenterIcon className={style.text} size={iconSize} />
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-between p-1.5 text-center">
          <span
            className={`rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-wide ${style.chip}`}
          >
            {typeMeta.label}
          </span>
          <CenterIcon className={`${style.text} drop-shadow-[0_0_10px_currentColor]`} size={iconSize} />
          <div className="w-full">
            <p
              className={`font-bold leading-tight text-white ${size === 'md' ? 'text-[12px]' : 'text-[10px]'}`}
            >
              {title}
            </p>
            {treatment && size === 'md' && (
              <p className="mt-0.5 text-[9px] leading-tight text-slate-200/80">{treatment.description}</p>
            )}
            {!treatment && size === 'md' && (
              <p className={`mt-0.5 text-[10px] font-semibold ${style.text}`}>{style.label}</p>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}
