import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Eye, LogOut, RotateCcw, Trophy } from 'lucide-react';

interface VictoryModalProps {
  open: boolean;
  winnerNickname: string;
  iWon: boolean;
  isHost: boolean;
  onRematch: () => void;
  onLeave: () => void;
}

const CONFETTI_COLORS = ['#fb7185', '#fbbf24', '#34d399', '#38bdf8', '#c084fc', '#bef264'];

/** Overlay de victoria con revancha (solo Host) y opción de inspeccionar la mesa final. */
export function VictoryModal({
  open,
  winnerNickname,
  iWon,
  isHost,
  onRematch,
  onLeave,
}: VictoryModalProps) {
  const [minimized, setMinimized] = useState(false);

  // Al iniciar una revancha el modal se cierra: la próxima victoria debe abrir expandida.
  useEffect(() => {
    if (!open) setMinimized(false);
  }, [open]);

  const confetti = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 1.2,
        duration: 2.4 + Math.random() * 2,
        size: 6 + Math.random() * 8,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rotate: Math.random() * 360,
      })),
    [],
  );

  const actions = (
    <>
      {isHost ? (
        <button id="rematch-button" type="button" className="btn btn-primary" onClick={onRematch}>
          <RotateCcw size={18} /> Revancha
        </button>
      ) : (
        <p id="rematch-waiting" className="text-sm text-slate-300">
          Esperando a que el Host inicie la revancha...
        </p>
      )}
      <button id="leave-lobby-button" type="button" className="btn btn-ghost" onClick={onLeave}>
        <LogOut size={18} /> Salir al Lobby
      </button>
    </>
  );

  return (
    <AnimatePresence>
      {open && !minimized && (
        <motion.div
          key="victory-overlay"
          id="victory-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/70 p-4 backdrop-blur-sm"
        >
          {confetti.map((c) => (
            <motion.span
              key={c.id}
              className="pointer-events-none absolute top-0 rounded-sm"
              style={{ left: `${c.left}%`, width: c.size, height: c.size * 0.6, background: c.color }}
              initial={{ y: -40, rotate: c.rotate, opacity: 1 }}
              animate={{ y: '110vh', rotate: c.rotate + 540, opacity: [1, 1, 0.6] }}
              transition={{ duration: c.duration, delay: c.delay, repeat: Infinity, ease: 'linear' }}
            />
          ))}

          <motion.div
            initial={{ scale: 0.7, y: 40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className="glass relative flex w-full max-w-md flex-col items-center gap-4 rounded-3xl p-8 text-center"
          >
            <motion.div
              animate={{ rotate: [-6, 6, -6], scale: [1, 1.1, 1] }}
              transition={{ duration: 2.4, repeat: Infinity }}
              className="flex h-20 w-20 items-center justify-center rounded-full bg-linear-to-br from-amber-300 to-toxic-400 text-ink-950 shadow-[0_0_50px_-4px_hsl(60_95%_60%/0.8)]"
            >
              <Trophy size={40} />
            </motion.div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Partida finalizada
            </p>
            <h2 className="text-gradient text-3xl font-extrabold" id="winner-name">
              {iWon ? '¡Ganaste!' : `¡Ganó ${winnerNickname}!`}
            </h2>
            <p className="text-sm text-slate-300">
              {iWon
                ? 'Lograste 4 órganos sanos. ¡Cuerpo impecable!'
                : `${winnerNickname} completó 4 órganos sanos de distinto color.`}
            </p>

            <div className="mt-2 flex w-full flex-col items-stretch gap-3">
              <button
                id="view-board-button"
                type="button"
                className="btn btn-ghost"
                onClick={() => setMinimized(true)}
              >
                <Eye size={18} /> Ver mesa final
              </button>
              <div className="flex flex-col items-stretch gap-3">{actions}</div>
            </div>
          </motion.div>
        </motion.div>
      )}

      {open && minimized && (
        <motion.div
          key="victory-bar"
          id="victory-bar"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          className="glass fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-2xl px-4 py-3"
        >
          <Trophy size={20} className="text-amber-300" />
          <span className="font-semibold text-white">
            {iWon ? '¡Ganaste!' : `Ganó ${winnerNickname}`}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-ghost !py-2 text-sm" onClick={() => setMinimized(false)}>
              Ver resultado
            </button>
            {actions}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
