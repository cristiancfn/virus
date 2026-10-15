import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Bug, Check, Crosshair, X } from 'lucide-react';
import type { ClientGameStateDTO } from '@virus/shared';
import type { Interaction } from './interaction';
import { bodyOf, promptFor } from './interaction';
import { nicknameOf } from './cardMeta';

interface ActionPromptProps {
  interaction: Interaction;
  game: ClientGameStateDTO;
  onCancel: () => void;
  onConfirmContagion: () => void;
  onRemoveTransfer: (index: number) => void;
}

/** Guía contextual de selección de objetivos + asistente de Contagio. */
export function ActionPrompt({
  interaction,
  game,
  onCancel,
  onConfirmContagion,
  onRemoveTransfer,
}: ActionPromptProps) {
  const text = promptFor(interaction);
  const card = 'card' in interaction ? interaction.card : null;

  return (
    <AnimatePresence>
      {text && card && (
        <motion.div
          key="prompt"
          id="action-prompt"
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          className="mx-auto w-full max-w-3xl rounded-2xl border border-virus-400/40 bg-ink-900/90 p-4 shadow-[0_0_40px_-8px_hsl(152_90%_58%/0.6)] backdrop-blur"
        >
          <div className="flex flex-wrap items-center gap-3">
            <Crosshair size={18} className="text-virus-400" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-widest text-virus-400">
                Jugando: {card.name}
              </p>
              <p className="text-sm text-slate-100">{text}</p>
            </div>
            <button
              id="cancel-selection-button"
              type="button"
              className="btn btn-ghost !px-3 !py-2 text-sm"
              onClick={onCancel}
            >
              <X size={16} /> Cancelar selección
            </button>
          </div>

          {interaction.kind === 'CONTAGION' && (
            <div className="mt-3 border-t border-white/10 pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <Bug size={14} /> Transferencias ({interaction.transfers.length})
              </p>
              <ul className="flex flex-col gap-1.5">
                <AnimatePresence initial={false}>
                  {interaction.transfers.map((t, i) => {
                    const from = game.me.body.find((s) => s.slotId === t.fromSlotId);
                    const to = bodyOf(game, t.toPlayerId).find((s) => s.slotId === t.toSlotId);
                    return (
                      <motion.li
                        key={`${t.fromSlotId}-${t.toSlotId}`}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 12 }}
                        className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5 text-sm"
                      >
                        <span className="text-lime-300">{from?.organCard.name ?? 'Órgano propio'}</span>
                        <ArrowRight size={14} className="text-slate-400" />
                        <span className="text-slate-100">
                          {nicknameOf(game, t.toPlayerId)} · {to?.organCard.name ?? 'Órgano'}
                        </span>
                        <button
                          type="button"
                          aria-label="Quitar transferencia"
                          className="ml-auto rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-danger-400"
                          onClick={() => onRemoveTransfer(i)}
                        >
                          <X size={14} />
                        </button>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
              {interaction.transfers.length === 0 && (
                <p className="text-xs italic text-slate-500">
                  Aún no has agregado ninguna transferencia. Debes mover al menos un virus.
                </p>
              )}
              <button
                id="confirm-contagion-button"
                type="button"
                className="btn btn-primary mt-3 !py-2 text-sm"
                disabled={interaction.transfers.length === 0}
                onClick={onConfirmContagion}
              >
                <Check size={16} /> Confirmar Contagio
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
