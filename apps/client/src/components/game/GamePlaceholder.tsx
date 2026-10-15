import { useState } from 'react';
import { motion } from 'framer-motion';
import { Braces, LogOut, RotateCcw, Trophy } from 'lucide-react';
import { useGameStore } from '../../store/useGameStore';

/** Placeholder del tablero (se construye en la Misión 5). */
export function GamePlaceholder() {
  const game = useGameStore((s) => s.game);
  const room = useGameStore((s) => s.room);
  const gameOver = useGameStore((s) => s.gameOver);
  const leaveRoom = useGameStore((s) => s.leaveRoom);
  const requestRematch = useGameStore((s) => s.requestRematch);
  const [showFull, setShowFull] = useState(false);

  const finished = room?.status === 'FINISHED';

  const summary = game
    ? {
        roomId: game.roomId,
        status: game.status,
        turnState: game.turnState,
        me: { playerId: game.me.playerId, nickname: game.me.nickname, handSize: game.me.hand.length },
        opponents: game.opponents.map((o) => ({ nickname: o.nickname, handCount: o.handCount })),
        decks: game.decks,
        winnerId: game.winnerId,
      }
    : null;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="bg-ambient pointer-events-none absolute inset-0" />
      <div className="bg-grid pointer-events-none absolute inset-0" />

      <motion.section
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass relative w-full max-w-2xl rounded-3xl p-7 sm:p-9"
      >
        <h1 className="text-gradient text-3xl font-extrabold">
          {finished ? 'Partida finalizada' : 'Partida en curso'}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Sala <span className="font-mono text-slate-200">{room?.roomId}</span> · El tablero llegará en la Misión 5.
        </p>

        {finished && gameOver && (
          <div
            id="winner-banner"
            className="mt-5 flex items-center gap-3 rounded-2xl border border-toxic-400/30 bg-toxic-400/10 px-4 py-3 text-toxic-400"
          >
            <Trophy size={20} />
            <span className="font-semibold">Ganador: {gameOver.winnerNickname}</span>
          </div>
        )}

        <pre
          id="game-state-json"
          className="mt-5 max-h-96 overflow-auto rounded-2xl border border-white/5 bg-black/40 p-4 font-mono text-xs leading-relaxed text-virus-400/90"
        >
          {game
            ? JSON.stringify(showFull ? game : summary, null, 2)
            : 'Esperando game:state_sync del servidor…'}
        </pre>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            id="toggle-state-button"
            type="button"
            className="btn btn-ghost"
            disabled={!game}
            onClick={() => setShowFull((v) => !v)}
          >
            <Braces size={18} /> {showFull ? 'Ver resumen' : 'Ver estado completo'}
          </button>
          {finished && (
            <button id="rematch-button" type="button" className="btn btn-primary" onClick={requestRematch}>
              <RotateCcw size={18} /> Revancha
            </button>
          )}
          <button id="leave-game-button" type="button" className="btn btn-ghost ml-auto" onClick={leaveRoom}>
            <LogOut size={18} /> Salir
          </button>
        </div>
      </motion.section>
    </main>
  );
}
