import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Card, ClientGameStateDTO, OrganSlot } from '@virus/shared';
import { useGameStore } from '../../store/useGameStore';
import { ActionFeed } from './ActionFeed';
import { ActionPrompt } from './ActionPrompt';
import { OpponentPanel } from './OpponentPanel';
import { PlayerZone } from './PlayerZone';
import { TopBar } from './TopBar';
import { VictoryModal } from './VictoryModal';
import { nicknameOf } from './cardMeta';
import { IDLE, computeSlotHighlight } from './interaction';
import type { Interaction } from './interaction';

const MAX_DISCARD = 3;

function BoardInner({ game }: { game: ClientGameStateDTO }) {
  const gameOver = useGameStore((s) => s.gameOver);
  const leaveRoom = useGameStore((s) => s.leaveRoom);
  const requestRematch = useGameStore((s) => s.requestRematch);
  const playCard = useGameStore((s) => s.playCard);
  const discardCards = useGameStore((s) => s.discardCards);

  const [interaction, setInteraction] = useState<Interaction>(IDLE);

  const finished = game.status === 'FINISHED' || game.winnerId !== null;
  const canAct = game.turnState.isMyTurn && game.status === 'IN_PROGRESS';

  // El estado del servidor manda: si cambia el turno o la carta ya no está en mano, se limpia la selección.
  useEffect(() => {
    setInteraction((prev) => {
      if (prev.kind === 'IDLE') return prev;
      if (!canAct) return IDLE;
      if ('card' in prev && !game.me.hand.some((c) => c.id === prev.card.id)) return IDLE;
      if (prev.kind === 'DISCARD') {
        const selected = prev.selected.filter((id) => game.me.hand.some((c) => c.id === id));
        return selected.length === prev.selected.length ? prev : { kind: 'DISCARD', selected };
      }
      return prev;
    });
  }, [game, canAct]);

  const reset = () => setInteraction(IDLE);

  // ---------- Mano ----------
  const handleHandCard = (card: Card) => {
    if (!canAct) return;

    if (interaction.kind === 'DISCARD') {
      const already = interaction.selected.includes(card.id);
      if (!already && interaction.selected.length >= MAX_DISCARD) return;
      setInteraction({
        kind: 'DISCARD',
        selected: already
          ? interaction.selected.filter((id) => id !== card.id)
          : [...interaction.selected, card.id],
      });
      return;
    }

    // Pulsar de nuevo la carta en juego cancela la selección.
    if ('card' in interaction && interaction.card.id === card.id) {
      reset();
      return;
    }

    if (card.type === 'ORGAN' || card.treatmentType === 'LATEX_GLOVE') {
      playCard(card.id, null);
      reset();
      return;
    }
    if (card.type === 'VIRUS' || card.type === 'MEDICINE' || card.treatmentType === 'ORGAN_THIEF') {
      setInteraction({ kind: 'TARGET_SLOT', card });
      return;
    }
    if (card.treatmentType === 'MEDICAL_ERROR') {
      setInteraction({ kind: 'TARGET_PLAYER', card });
      return;
    }
    if (card.treatmentType === 'TRANSPLANT') {
      setInteraction({ kind: 'TRANSPLANT', card, first: null });
      return;
    }
    if (card.treatmentType === 'CONTAGION') {
      setInteraction({ kind: 'CONTAGION', card, transfers: [], pendingFromSlotId: null });
    }
  };

  // ---------- Descarte ----------
  const toggleDiscardMode = () => {
    setInteraction((prev) => (prev.kind === 'DISCARD' ? IDLE : { kind: 'DISCARD', selected: [] }));
  };

  const confirmDiscard = () => {
    if (interaction.kind !== 'DISCARD' || interaction.selected.length === 0) return;
    discardCards(interaction.selected);
    reset();
  };

  // ---------- Órganos ----------
  const getSlotHighlight = (ownerId: string, slot: OrganSlot) =>
    canAct ? computeSlotHighlight(interaction, game, ownerId, slot) : 'none';

  const handleSlotClick = (ownerId: string, slot: OrganSlot) => {
    if (!canAct) return;
    const highlight = computeSlotHighlight(interaction, game, ownerId, slot);
    if (highlight === 'none') return;

    switch (interaction.kind) {
      case 'TARGET_SLOT':
        if (highlight !== 'valid') return;
        playCard(interaction.card.id, { targetPlayerId: ownerId, targetSlotId: slot.slotId });
        reset();
        return;

      case 'TRANSPLANT': {
        if (highlight === 'selected') {
          setInteraction({ ...interaction, first: null });
          return;
        }
        if (highlight !== 'valid') return;
        if (!interaction.first) {
          setInteraction({ ...interaction, first: { playerId: ownerId, slotId: slot.slotId } });
          return;
        }
        playCard(interaction.card.id, {
          firstPlayerId: interaction.first.playerId,
          firstSlotId: interaction.first.slotId,
          secondPlayerId: ownerId,
          secondSlotId: slot.slotId,
        });
        reset();
        return;
      }

      case 'CONTAGION': {
        if (ownerId === game.me.playerId) {
          if (highlight === 'selected') {
            setInteraction({ ...interaction, pendingFromSlotId: null });
          } else if (highlight === 'valid') {
            setInteraction({ ...interaction, pendingFromSlotId: slot.slotId });
          }
          return;
        }
        if (highlight !== 'valid' || !interaction.pendingFromSlotId) return;
        setInteraction({
          ...interaction,
          pendingFromSlotId: null,
          transfers: [
            ...interaction.transfers,
            { fromSlotId: interaction.pendingFromSlotId, toPlayerId: ownerId, toSlotId: slot.slotId },
          ],
        });
        return;
      }

      default:
        return;
    }
  };

  // ---------- Rivales (Error Médico) ----------
  const handleSelectPlayer = (playerId: string) => {
    if (!canAct || interaction.kind !== 'TARGET_PLAYER') return;
    playCard(interaction.card.id, { targetPlayerId: playerId });
    reset();
  };

  const confirmContagion = () => {
    if (interaction.kind !== 'CONTAGION' || interaction.transfers.length === 0) return;
    playCard(interaction.card.id, { transfers: interaction.transfers });
    reset();
  };

  const removeTransfer = (index: number) => {
    if (interaction.kind !== 'CONTAGION') return;
    setInteraction({
      ...interaction,
      transfers: interaction.transfers.filter((_, i) => i !== index),
    });
  };

  const opponentCols =
    game.opponents.length <= 1
      ? 'grid-cols-1'
      : game.opponents.length === 2
        ? 'grid-cols-1 lg:grid-cols-2'
        : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3';

  const winnerNickname =
    gameOver?.winnerNickname ?? (game.winnerId ? nicknameOf(game, game.winnerId) : '');

  return (
    <main className="relative min-h-screen overflow-x-hidden px-3 pb-10 pt-2 sm:px-5">
      <div className="bg-ambient pointer-events-none fixed inset-0 -z-10" />
      <div className="bg-grid pointer-events-none fixed inset-0 -z-10" />

      <div className="flex flex-col gap-4">
        <TopBar game={game} onLeave={leaveRoom} />
        <ActionFeed game={game} />

        <section
          id="opponents-zone"
          className={`mx-auto grid w-full max-w-7xl gap-3 ${opponentCols}`}
          aria-label="Rivales"
        >
          {game.opponents.map((opponent) => (
            <OpponentPanel
              key={opponent.playerId}
              opponent={opponent}
              isCurrentTurn={game.turnState.currentPlayerId === opponent.playerId}
              targetable={canAct && interaction.kind === 'TARGET_PLAYER'}
              onSelectPlayer={() => handleSelectPlayer(opponent.playerId)}
              getSlotHighlight={getSlotHighlight}
              onSlotClick={handleSlotClick}
            />
          ))}
        </section>

        <ActionPrompt
          interaction={interaction}
          game={game}
          onCancel={reset}
          onConfirmContagion={confirmContagion}
          onRemoveTransfer={removeTransfer}
        />

        <PlayerZone
          game={game}
          interaction={interaction}
          onHandCardClick={handleHandCard}
          onToggleDiscardMode={toggleDiscardMode}
          onConfirmDiscard={confirmDiscard}
          getSlotHighlight={getSlotHighlight}
          onSlotClick={handleSlotClick}
        />
      </div>

      <VictoryModal
        open={finished}
        winnerNickname={winnerNickname}
        iWon={game.winnerId === game.me.playerId}
        isHost={game.me.isHost}
        onRematch={requestRematch}
        onLeave={leaveRoom}
      />
    </main>
  );
}

/** Tablero completo e interactivo. Solo renderiza `game:state_sync`; emite intenciones vía store. */
export function GameBoard() {
  const game = useGameStore((s) => s.game);

  if (!game) {
    return (
      <main className="bg-ambient flex min-h-screen flex-col items-center justify-center gap-4 text-slate-300">
        <Loader2 className="animate-spin text-virus-400" size={36} />
        <p id="waiting-state-message">Esperando el estado de la partida…</p>
      </main>
    );
  }

  return <BoardInner game={game} />;
}
