import { AnimatePresence, motion } from 'framer-motion';
import { Activity } from 'lucide-react';
import type { ClientGameStateDTO } from '@virus/shared';
import { describeLastAction } from './cardMeta';

/** Banner con la última jugada traducida a español. */
export function ActionFeed({ game }: { game: ClientGameStateDTO }) {
  const log = game.lastActionLog;
  const text = log ? describeLastAction(game, log) : 'La partida ha comenzado. ¡Buena suerte!';
  const key = log ? `${log.timestamp}-${log.actionType}-${log.actorId}` : 'start';

  return (
    <div
      id="action-feed"
      className="mx-auto flex w-full max-w-7xl items-center gap-3 overflow-hidden rounded-xl border border-pulse-400/20 bg-pulse-400/5 px-4 py-2 text-sm text-slate-200"
      aria-live="polite"
    >
      <Activity size={16} className="shrink-0 text-pulse-400" />
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={key}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.2 }}
          className="truncate"
        >
          {text}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
