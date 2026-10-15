import { AnimatePresence, motion } from 'framer-motion';
import { Check, Crown, Trash2, X } from 'lucide-react';
import type { Card, ClientGameStateDTO, OrganSlot } from '@virus/shared';
import { CardView } from './CardView';
import { OrganSlotView } from './OrganSlotView';
import type { SlotHighlight } from './OrganSlotView';
import { countWinningOrgans } from './cardMeta';
import type { Interaction } from './interaction';

const ORGANS_TO_WIN = 4;

interface PlayerZoneProps {
  game: ClientGameStateDTO;
  interaction: Interaction;
  onHandCardClick: (card: Card) => void;
  onToggleDiscardMode: () => void;
  onConfirmDiscard: () => void;
  getSlotHighlight: (ownerId: string, slot: OrganSlot) => SlotHighlight;
  onSlotClick: (ownerId: string, slot: OrganSlot) => void;
}

export function PlayerZone({
  game,
  interaction,
  onHandCardClick,
  onToggleDiscardMode,
  onConfirmDiscard,
  getSlotHighlight,
  onSlotClick,
}: PlayerZoneProps) {
  const { me, turnState } = game;
  const isMyTurn = turnState.isMyTurn;
  const healthy = countWinningOrgans(me.body);
  const discarding = interaction.kind === 'DISCARD';
  const selectedIds = discarding ? interaction.selected : [];
  const playingCardId = 'card' in interaction ? interaction.card.id : null;

  return (
    <section
      id="player-zone"
      className={`glass mx-auto flex w-full max-w-7xl flex-col gap-4 rounded-3xl p-4 sm:p-5 ${
        isMyTurn ? 'ring-2 ring-virus-400/60 shadow-[0_0_44px_-10px_hsl(152_90%_58%/0.7)]' : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-base font-bold text-white">
          {me.nickname} <span className="text-xs font-medium text-slate-400">(Tú)</span>
          {me.isHost && <Crown size={14} className="text-amber-300" aria-label="Host" />}
        </h2>

        <div className="flex min-w-48 flex-1 items-center gap-3 sm:max-w-sm">
          <span id="healthy-progress" className="whitespace-nowrap text-sm text-slate-200">
            Órganos sanos: <b className="text-virus-400">{healthy}</b> / {ORGANS_TO_WIN}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="h-full rounded-full bg-linear-to-r from-virus-400 to-toxic-400"
              animate={{ width: `${Math.min(1, healthy / ORGANS_TO_WIN) * 100}%` }}
              transition={{ type: 'spring', stiffness: 120, damping: 18 }}
            />
          </div>
        </div>
      </div>

      <div className="scroll-thin flex min-h-36 gap-2 overflow-x-auto pb-1">
        <AnimatePresence initial={false}>
          {me.body.map((slot) => (
            <OrganSlotView
              key={slot.slotId}
              slot={slot}
              highlight={getSlotHighlight(me.playerId, slot)}
              onClick={() => onSlotClick(me.playerId, slot)}
            />
          ))}
        </AnimatePresence>
        {me.body.length === 0 && (
          <p className="m-auto text-xs italic text-slate-500">
            Tu cuerpo está vacío: juega un órgano para empezar.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Tu mano</p>
          {!isMyTurn && <span className="text-xs text-slate-500">Espera tu turno…</span>}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {discarding && (
              <motion.button
                id="confirm-discard-button"
                type="button"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="btn btn-primary !px-4 !py-2 text-sm"
                disabled={selectedIds.length === 0}
                onClick={onConfirmDiscard}
              >
                <Check size={16} /> Confirmar Descarte ({selectedIds.length})
              </motion.button>
            )}
            <button
              id="discard-mode-button"
              type="button"
              className="btn btn-ghost !px-4 !py-2 text-sm"
              disabled={!isMyTurn || me.hand.length === 0}
              onClick={onToggleDiscardMode}
            >
              {discarding ? (
                <>
                  <X size={16} /> Cancelar descarte
                </>
              ) : (
                <>
                  <Trash2 size={16} /> Modo Descarte
                </>
              )}
            </button>
          </div>
        </div>

        {discarding && (
          <p className="text-xs text-amber-200/90">
            Selecciona de 1 a 3 cartas de tu mano para descartarlas; luego robarás hasta tener 3.
          </p>
        )}

        <div id="player-hand" className="flex min-h-48 flex-wrap items-end justify-center gap-3 pt-5">
          <AnimatePresence initial={false}>
            {me.hand.map((card) => (
              <motion.div
                key={card.id}
                layout
                initial={{ opacity: 0, y: 40, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -40, scale: 0.7 }}
                transition={{ type: 'spring', stiffness: 300, damping: 26 }}
              >
                <CardView
                  card={card}
                  size="md"
                  disabled={!isMyTurn}
                  selected={selectedIds.includes(card.id) || playingCardId === card.id}
                  onClick={() => onHandCardClick(card)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
          {me.hand.length === 0 && <p className="m-auto text-sm italic text-slate-500">Sin cartas en mano</p>}
        </div>
      </div>
    </section>
  );
}
