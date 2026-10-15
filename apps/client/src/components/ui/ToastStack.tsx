import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { useGameStore } from '../../store/useGameStore';
import type { ErrorToast } from '../../store/useGameStore';

const TOAST_DURATION_MS = 5000;

function Toast({ toast }: { toast: ErrorToast }) {
  const dismissError = useGameStore((s) => s.dismissError);

  useEffect(() => {
    const t = setTimeout(() => dismissError(toast.id), TOAST_DURATION_MS);
    return () => clearTimeout(t);
  }, [toast.id, dismissError]);

  return (
    <motion.div
      layout
      role="alert"
      initial={{ opacity: 0, y: -24, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.18 } }}
      className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-danger-400/40 bg-ink-900/90 px-4 py-3 shadow-[0_12px_40px_-10px_hsl(350_90%_50%/0.45)] backdrop-blur-xl"
    >
      <AlertTriangle size={20} className="mt-0.5 shrink-0 text-danger-400" />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-danger-400/80">
          {toast.code}
        </p>
        <p className="text-sm text-slate-100">{toast.message}</p>
      </div>
      <button
        type="button"
        aria-label="Cerrar notificación"
        className="rounded-lg p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
        onClick={() => dismissError(toast.id)}
      >
        <X size={16} />
      </button>
    </motion.div>
  );
}

/** Muestra globalmente todos los `game:action_error` recibidos del servidor. */
export function ToastStack() {
  const errors = useGameStore((s) => s.errors);

  return (
    <div
      id="toast-stack"
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-0 top-4 z-50 mx-auto flex w-full max-w-md flex-col gap-2 px-4"
    >
      <AnimatePresence initial={false}>
        {errors.map((e) => (
          <Toast key={e.id} toast={e} />
        ))}
      </AnimatePresence>
    </div>
  );
}
