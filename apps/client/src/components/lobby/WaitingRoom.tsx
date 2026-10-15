import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, Crown, LogOut, Play, UserRound, Users } from 'lucide-react';
import { useGameStore } from '../../store/useGameStore';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

export function WaitingRoom() {
  const room = useGameStore((s) => s.room);
  const session = useGameStore((s) => s.session);
  const connection = useGameStore((s) => s.connection);
  const startGame = useGameStore((s) => s.startGame);
  const leaveRoom = useGameStore((s) => s.leaveRoom);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  if (!room) return null;

  const me = room.players.find((p) => p.playerId === session?.playerId);
  const isHost = me?.isHost ?? false;
  const connectedCount = room.players.filter((p) => p.isConnected).length;
  const canStart = isHost && connectedCount >= MIN_PLAYERS && connection === 'connected';

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.roomId);
    } catch {
      // Fallback para contextos sin Clipboard API (http no seguro).
      const el = document.createElement('textarea');
      el.value = room.roomId;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      el.remove();
    }
    setCopied(true);
  };

  const hint = !isHost
    ? 'Esperando a que el anfitrión inicie la partida…'
    : connectedCount < MIN_PLAYERS
      ? `Se necesitan al menos ${MIN_PLAYERS} jugadores conectados para empezar.`
      : '¡Todo listo! Puedes iniciar la partida.';

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="bg-ambient pointer-events-none absolute inset-0" />
      <div className="bg-grid pointer-events-none absolute inset-0" />

      <motion.section
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="glass relative w-full max-w-lg rounded-3xl p-7 sm:p-9"
      >
        <p className="text-center text-xs font-semibold uppercase tracking-[0.3em] text-virus-400/80">
          Sala de espera
        </p>

        <div className="mt-4 flex flex-col items-center gap-3">
          <div
            id="room-code"
            aria-label="Código de la sala"
            className="text-gradient font-mono text-5xl font-bold tracking-[0.3em] sm:text-6xl"
          >
            {room.roomId}
          </div>
          <button id="copy-code-button" type="button" className="btn btn-ghost !py-2 text-sm" onClick={copyCode}>
            {copied ? <Check size={16} className="text-virus-400" /> : <Copy size={16} />}
            {copied ? '¡Copiado!' : 'Copiar código'}
          </button>
        </div>

        <div className="mt-8 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Users size={16} className="text-virus-400" /> Jugadores
          </h2>
          <span className="rounded-full bg-white/5 px-2.5 py-0.5 font-mono text-xs text-slate-300">
            {room.players.length}/{MAX_PLAYERS}
          </span>
        </div>

        <ul id="player-list" className="mt-3 flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {room.players.map((p) => (
              <motion.li
                key={p.playerId}
                layout
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: p.isConnected ? 1 : 0.55, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
                className="flex items-center gap-3 rounded-2xl border border-white/5 bg-black/25 px-4 py-3"
              >
                <span className="flex size-9 items-center justify-center rounded-full bg-virus-500/15 text-virus-400">
                  <UserRound size={18} />
                </span>
                <span className="flex-1 truncate font-medium">
                  {p.nickname}
                  {p.playerId === session?.playerId && (
                    <span className="ml-2 text-xs font-normal text-slate-400">(tú)</span>
                  )}
                </span>
                {p.isHost && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-toxic-400/15 px-2 py-0.5 text-xs font-semibold text-toxic-400">
                    <Crown size={12} /> Host
                  </span>
                )}
                <span
                  className={`inline-flex items-center gap-1.5 text-xs ${p.isConnected ? 'text-virus-400' : 'text-slate-500'}`}
                >
                  <span
                    className={`size-2 rounded-full ${p.isConnected ? 'bg-virus-400 animate-pulse-ring' : 'bg-slate-500'}`}
                  />
                  {p.isConnected ? 'Conectado' : 'Desconectado'}
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>

        <p id="start-hint" className="mt-5 text-center text-sm text-slate-400">
          {hint}
        </p>

        <div className="mt-5 flex gap-3">
          <button id="leave-room-button" type="button" className="btn btn-ghost" onClick={leaveRoom}>
            <LogOut size={18} /> Salir
          </button>
          <button
            id="start-game-button"
            type="button"
            className="btn btn-primary flex-1"
            disabled={!canStart}
            onClick={startGame}
          >
            <Play size={18} /> Iniciar partida
          </button>
        </div>
      </motion.section>
    </main>
  );
}
