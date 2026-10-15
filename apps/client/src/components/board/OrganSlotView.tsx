import { AnimatePresence, motion } from 'framer-motion';
import type { OrganSlot } from '@virus/shared';
import { CardView } from './CardView';
import { STATUS_META } from './cardMeta';

export type SlotHighlight = 'none' | 'valid' | 'selected' | 'dim';

interface OrganSlotViewProps {
  slot: OrganSlot;
  highlight?: SlotHighlight;
  onClick?: () => void;
}

const HIGHLIGHT_CLASSES: Record<SlotHighlight, string> = {
  none: 'border-white/10',
  valid: 'border-virus-400 bg-virus-400/10 shadow-[0_0_24px_-4px_hsl(152_90%_58%/0.8)]',
  selected: 'border-white bg-white/10 shadow-[0_0_28px_-2px_hsl(0_0%_100%/0.6)]',
  dim: 'border-white/5 opacity-40',
};

/** Órgano en mesa: carta base + modificadores apilados (virus/medicinas) + insignia de estado. */
export function OrganSlotView({ slot, highlight = 'none', onClick }: OrganSlotViewProps) {
  const status = STATUS_META[slot.status];
  const StatusIcon = status.Icon;
  const clickable = Boolean(onClick) && highlight !== 'dim' && highlight !== 'none';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.8, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.6 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={`${slot.organCard.name} (${status.label})`}
      id={`slot-${slot.slotId}`}
      onClick={clickable ? onClick : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      whileHover={clickable ? { scale: 1.05 } : undefined}
      className={`relative flex flex-col items-center gap-1.5 rounded-2xl border-2 p-2 transition-colors ${HIGHLIGHT_CLASSES[highlight]} ${
        clickable ? 'cursor-pointer' : ''
      }`}
    >
      <div className="flex items-end gap-1">
        <CardView card={slot.organCard} size="sm" />
        <div className="flex min-h-14 flex-col-reverse gap-1">
          <AnimatePresence initial={false}>
            {slot.modifiers.map((mod) => (
              <motion.div
                key={mod.id}
                initial={{ opacity: 0, x: -10, scale: 0.7 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 10, scale: 0.7 }}
              >
                <CardView card={mod} size="xs" />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${status.badge}`}
      >
        <StatusIcon size={12} />
        {status.label}
      </span>
    </motion.div>
  );
}
