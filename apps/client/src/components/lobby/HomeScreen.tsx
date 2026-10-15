import { useState } from 'react';
import type { FormEvent } from 'react';
import { motion } from 'framer-motion';
import { DoorOpen, LogIn, Plus, ShieldPlus, Wifi, WifiOff } from 'lucide-react';
import { useGameStore } from '../../store/useGameStore';
import type { ConnectionStatus } from '../../store/useGameStore';

const NICKNAME_MIN = 2;
const NICKNAME_MAX = 20;
// Espejo de ROOM_CODE_LENGTH / ROOM_CODE_ALPHABET de @virus/shared (se evita importar runtime CJS en Vite).
const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_CODE_REGEX = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const label =
    status === 'connected' ? 'Conectado' : status === 'connecting' ? 'Conectando…' : 'Sin conexión';
  const color =
    status === 'connected'
      ? 'text-virus-400 border-virus-400/30'
      : status === 'connecting'
        ? 'text-toxic-400 border-toxic-400/30'
        : 'text-danger-400 border-danger-400/30';
  return (
    <span
      id="connection-badge"
      className={`inline-flex items-center gap-1.5 rounded-full border bg-black/30 px-3 py-1 text-xs font-medium ${color}`}
    >
      {status === 'disconnected' ? <WifiOff size={13} /> : <Wifi size={13} />}
      {label}
    </span>
  );
}

export function HomeScreen() {
  const connection = useGameStore((s) => s.connection);
  const createRoom = useGameStore((s) => s.createRoom);
  const joinRoom = useGameStore((s) => s.joinRoom);

  const [nickname, setNickname] = useState('');
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);

  const trimmed = nickname.trim();
  const nicknameValid = trimmed.length >= NICKNAME_MIN && trimmed.length <= NICKNAME_MAX;
  const codeValid = ROOM_CODE_REGEX.test(code);
  const online = connection === 'connected';
  const showNicknameError = touched && !nicknameValid;

  const handleCreate = () => {
    setTouched(true);
    if (!nicknameValid || !online) return;
    createRoom(trimmed);
  };

  const handleJoin = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!nicknameValid || !codeValid || !online) return;
    joinRoom(code, trimmed);
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="bg-ambient pointer-events-none absolute inset-0" />
      <div className="bg-grid pointer-events-none absolute inset-0" />
      <div className="animate-float pointer-events-none absolute -left-24 top-1/4 size-80 rounded-full bg-virus-500/20 blur-3xl" />
      <div
        className="animate-float pointer-events-none absolute -right-20 bottom-10 size-72 rounded-full bg-pulse-400/15 blur-3xl"
        style={{ animationDelay: '-4s' }}
      />

      <motion.section
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="glass relative w-full max-w-md rounded-3xl p-7 sm:p-9"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-virus-400/80">
            <ShieldPlus size={14} /> Multijugador online
          </span>
          <ConnectionBadge status={connection} />
        </div>

        <h1 className="text-gradient text-6xl font-extrabold tracking-tight">Virus!</h1>
        <p className="mt-2 text-sm text-slate-300/80">
          Junta 4 órganos sanos antes que tus rivales te los infecten.
        </p>

        <div className="mt-7">
          <label htmlFor="nickname-input" className="mb-1.5 block text-sm font-medium text-slate-200">
            Tu apodo
          </label>
          <input
            id="nickname-input"
            className="input-field"
            type="text"
            autoComplete="nickname"
            placeholder="Ej: Paciente Cero"
            maxLength={NICKNAME_MAX + 10}
            value={nickname}
            aria-invalid={showNicknameError}
            aria-describedby="nickname-hint"
            onChange={(e) => setNickname(e.target.value)}
            onBlur={() => setTouched(true)}
          />
          <p
            id="nickname-hint"
            className={`mt-1.5 text-xs ${showNicknameError ? 'text-danger-400' : 'text-slate-400'}`}
          >
            Entre {NICKNAME_MIN} y {NICKNAME_MAX} caracteres ({trimmed.length}/{NICKNAME_MAX}).
          </p>
        </div>

        <button
          id="create-room-button"
          type="button"
          className="btn btn-primary mt-5 w-full"
          disabled={!online}
          onClick={handleCreate}
        >
          <Plus size={18} /> Crear sala
        </button>

        <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-widest text-slate-500">
          <span className="h-px flex-1 bg-white/10" /> o únete <span className="h-px flex-1 bg-white/10" />
        </div>

        <form onSubmit={handleJoin} className="flex flex-col gap-3" id="join-room-form">
          <label htmlFor="room-code-input" className="text-sm font-medium text-slate-200">
            Código de sala
          </label>
          <div className="flex gap-2">
            <input
              id="room-code-input"
              className="input-field text-center font-mono text-lg font-bold uppercase tracking-[0.4em]"
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="ABC234"
              maxLength={ROOM_CODE_LENGTH}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
            <button
              id="join-room-button"
              type="submit"
              className="btn btn-ghost shrink-0"
              disabled={!online || !codeValid}
            >
              <LogIn size={18} /> Unirse
            </button>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <DoorOpen size={13} /> {ROOM_CODE_LENGTH} caracteres, sin 0, O, 1, I ni L.
          </p>
        </form>
      </motion.section>
    </main>
  );
}
