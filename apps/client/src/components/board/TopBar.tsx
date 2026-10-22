import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Biohazard, Clock, Layers, LogOut, SkipForward, Trash2, WifiOff } from 'lucide-react';
import type { ClientGameStateDTO } from '@virus/shared';
import { CardView } from './CardView';
import { nicknameOf } from './cardMeta';
import { useGameStore } from '../../store/useGameStore';

/** Duración de turno por defecto (SPEC §6); se usa solo si el servidor no envía `config`. */
const DEFAULT_TURN_SECONDS = 45;

/** Reloj regresivo fluido: se re-sincroniza con cada `game:state_sync` y descuenta cada segundo. */
function useCountdown(game: ClientGameStateDTO): number {
  const [remaining, setRemaining] = useState(game.turnState.turnRemainingSeconds);

  useEffect(() => {
    const deadline = Date.now() + game.turnState.turnRemainingSeconds * 1000;
    setRemaining(Math.max(0, Math.ceil(game.turnState.turnRemainingSeconds)));
    if (game.status !== 'IN_PROGRESS') return;
    const id = window.setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 250);
    return () => window.clearInterval(id);
  }, [game]);

  return remaining;
}

interface TopBarProps {
  game: ClientGameStateDTO;
  onLeave: () => void;
}

export function TopBar({ game, onLeave }: TopBarProps) {
  const remaining = useCountdown(game);
  const { turnState, decks } = game;
  const isMyTurn = turnState.isMyTurn;
  const urgent = remaining <= 10 && game.status === 'IN_PROGRESS';
  const currentName = isMyTurn ? 'Tú' : nicknameOf(game, turnState.currentPlayerId);
  const turnSeconds = game.config?.turnTimeoutSeconds ?? DEFAULT_TURN_SECONDS;
  const progress = Math.min(1, remaining / turnSeconds);
  const forceSkipTurn = useGameStore((s) => s.forceSkipTurn);
  // SPEC §6: el Host puede saltar el turno de un oponente desconectado.
  const currentOpponent = game.opponents.find((o) => o.playerId === turnState.currentPlayerId);
  const canForceSkip =
    game.status === 'IN_PROGRESS' && game.me.isHost && !!currentOpponent && !currentOpponent.isConnected;

  return (
    <header
      id="top-bar"
      className="glass sticky top-2 z-30 mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <Biohazard className="text-virus-400" size={22} />
        <div className="leading-tight">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Sala</p>
          <p id="room-code" className="font-mono text-lg font-bold tracking-widest text-white">
            {game.roomId}
          </p>
        </div>
      </div>

      <div className="leading-tight">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Turno</p>
        <p id="turn-number" className="text-lg font-bold text-white">
          #{turnState.turnNumber}
        </p>
      </div>

      <motion.div
        key={turnState.currentPlayerId}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        id="current-player"
        className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 ${
          isMyTurn
            ? 'border-virus-400 bg-virus-400/15 text-virus-400 shadow-[0_0_24px_-4px_hsl(152_90%_58%/0.8)]'
            : 'border-white/10 bg-white/5 text-slate-200'
        }`}
      >
        {isMyTurn && <span className="h-2 w-2 animate-pulse-ring rounded-full bg-virus-400" />}
        <span className="text-sm font-semibold">
          {isMyTurn ? '¡Es tu turno!' : `Turno de ${currentName}`}
        </span>
      </motion.div>

      {canForceSkip && (
        <motion.button
          id="force-skip-button"
          type="button"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="inline-flex items-center gap-2 rounded-xl border border-danger-400/60 bg-danger-400/15 px-3 py-1.5 text-sm font-semibold text-danger-400 shadow-[0_0_20px_-4px_hsl(350_90%_60%/0.7)] transition hover:bg-danger-400/25"
          onClick={forceSkipTurn}
        >
          <WifiOff size={15} /> Jugador desconectado — Saltar turno <SkipForward size={15} />
        </motion.button>
      )}

      <div
        id="turn-clock"
        className={`flex min-w-28 flex-col gap-1 ${urgent ? 'text-danger-400' : 'text-slate-200'}`}
      >
        <div className="flex items-center gap-1.5">
          <Clock size={16} className={urgent ? 'animate-pulse' : ''} />
          <span className="font-mono text-lg font-bold tabular-nums">{remaining}s</span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
          <motion.div
            className={`h-full rounded-full ${urgent ? 'bg-danger-400' : 'bg-virus-400'}`}
            animate={{ width: `${progress * 100}%` }}
            transition={{ duration: 0.4, ease: 'linear' }}
          />
        </div>
      </div>

      <div className="ml-auto flex items-center gap-4">
        <div className="flex items-center gap-2" title="Mazo de robo">
          <Layers size={18} className="text-pulse-400" />
          <div className="leading-tight">
            <p className="text-[10px] uppercase tracking-widest text-slate-400">Mazo</p>
            <p id="draw-pile-count" className="font-bold text-white">
              {decks.drawPileCount}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2" title="Pila de descarte">
          <Trash2 size={18} className="text-slate-400" />
          <div className="leading-tight">
            <p className="text-[10px] uppercase tracking-widest text-slate-400">Descarte</p>
            <p id="discard-pile-count" className="font-bold text-white">
              {decks.discardPileCount}
            </p>
          </div>
          {decks.topDiscardCard ? (
            <CardView key={decks.topDiscardCard.id} card={decks.topDiscardCard} size="xs" />
          ) : (
            <div className="h-14 w-10 rounded-lg border border-dashed border-white/15" />
          )}
        </div>
        <button
          id="leave-game-button"
          type="button"
          className="btn btn-ghost !px-3 !py-2 text-sm"
          onClick={onLeave}
        >
          <LogOut size={16} /> Salir
        </button>
      </div>
    </header>
  );
}
