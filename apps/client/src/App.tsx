import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useGameStore } from './store/useGameStore';
import { HomeScreen } from './components/lobby/HomeScreen';
import { WaitingRoom } from './components/lobby/WaitingRoom';
import { GamePlaceholder } from './components/game/GamePlaceholder';
import { ToastStack } from './components/ui/ToastStack';

function ReconnectingScreen() {
  return (
    <main className="bg-ambient flex min-h-screen flex-col items-center justify-center gap-4 text-slate-300">
      <Loader2 className="animate-spin text-virus-400" size={36} />
      <p id="reconnecting-message">Reconectando a tu partida…</p>
    </main>
  );
}

export default function App() {
  const init = useGameStore((s) => s.init);
  const room = useGameStore((s) => s.room);
  const isReconnecting = useGameStore((s) => s.isReconnecting);

  useEffect(() => {
    init();
  }, [init]);

  let view;
  if (!room) {
    view = isReconnecting ? <ReconnectingScreen /> : <HomeScreen />;
  } else if (room.status === 'WAITING') {
    view = <WaitingRoom />;
  } else if (room.status === 'IN_PROGRESS' || room.status === 'FINISHED') {
    view = <GamePlaceholder />;
  } else {
    view = <HomeScreen />;
  }

  return (
    <>
      {view}
      <ToastStack />
    </>
  );
}
