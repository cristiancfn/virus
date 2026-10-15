import { AnimatePresence, motion } from 'framer-motion';
import { Crown, Wifi, WifiOff } from 'lucide-react';
import type { OrganSlot, PublicOpponentDTO } from '@virus/shared';
import { CardView } from './CardView';
import { OrganSlotView } from './OrganSlotView';
import type { SlotHighlight } from './OrganSlotView';
import { countWinningOrgans } from './cardMeta';

interface OpponentPanelProps {
  opponent: PublicOpponentDTO;
  isCurrentTurn: boolean;
  /** true cuando el panel completo es un objetivo clicable (Error Médico). */
  targetable: boolean;
  onSelectPlayer: () => void;
  getSlotHighlight: (ownerId: string, slot: OrganSlot) => SlotHighlight;
  onSlotClick: (ownerId: string, slot: OrganSlot) => void;
}

export function OpponentPanel({
  opponent,
  isCurrentTurn,
  targetable,
  onSelectPlayer,
  getSlotHighlight,
  onSlotClick,
}: OpponentPanelProps) {
  const healthy = countWinningOrgans(opponent.body);

  return (
    <motion.section
      layout
      id={`opponent-${opponent.playerId}`}
      initial={{ opacity: 0, y: -14 }}
      animate={{ opacity: 1, y: 0 }}
      role={targetable ? 'button' : undefined}
      tabIndex={targetable ? 0 : undefined}
      onClick={targetable ? onSelectPlayer : undefined}
      onKeyDown={
        targetable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectPlayer();
              }
            }
          : undefined
      }
      whileHover={targetable ? { scale: 1.015 } : undefined}
      className={`glass flex min-w-0 flex-col gap-3 rounded-2xl p-3 transition-shadow ${
        isCurrentTurn ? 'ring-2 ring-toxic-400/70' : ''
      } ${
        targetable
          ? 'cursor-pointer ring-2 ring-virus-400 shadow-[0_0_30px_-4px_hsl(152_90%_58%/0.7)]'
          : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {opponent.isConnected ? (
          <Wifi size={15} className="text-virus-400" aria-label="Conectado" />
        ) : (
          <WifiOff size={15} className="text-danger-400" aria-label="Desconectado" />
        )}
        <h3 className="truncate text-sm font-bold text-white">{opponent.nickname}</h3>
        {opponent.isHost && <Crown size={14} className="text-amber-300" aria-label="Host" />}
        {isCurrentTurn && (
          <span className="rounded-full bg-toxic-400/20 px-2 py-0.5 text-[10px] font-bold uppercase text-toxic-400">
            Su turno
          </span>
        )}
        {!opponent.isConnected && (
          <span className="rounded-full bg-danger-400/15 px-2 py-0.5 text-[10px] font-semibold text-danger-400">
            Desconectado
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-slate-400">
            Sanos <b className="text-slate-200">{healthy}</b>/4
          </span>
          <div className="flex items-center" title={`${opponent.handCount} cartas en mano`}>
            <div className="flex -space-x-5">
              {Array.from({ length: opponent.handCount }, (_, i) => (
                <CardView key={i} faceDown size="xs" />
              ))}
            </div>
            <span className="ml-1.5 text-xs font-semibold text-slate-300">×{opponent.handCount}</span>
          </div>
        </div>
      </div>

      <div className="scroll-thin flex min-h-36 gap-2 overflow-x-auto pb-1">
        <AnimatePresence initial={false}>
          {opponent.body.map((slot) => (
            <OrganSlotView
              key={slot.slotId}
              slot={slot}
              highlight={getSlotHighlight(opponent.playerId, slot)}
              onClick={() => onSlotClick(opponent.playerId, slot)}
            />
          ))}
        </AnimatePresence>
        {opponent.body.length === 0 && (
          <p className="m-auto text-xs italic text-slate-500">Sin órganos en mesa</p>
        )}
      </div>
    </motion.section>
  );
}
