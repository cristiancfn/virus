export type CardType = 'ORGAN' | 'VIRUS' | 'MEDICINE' | 'TREATMENT';
export type CardColor = 'RED' | 'GREEN' | 'BLUE' | 'YELLOW' | 'MULTICOLOR' | 'NONE';
export type TreatmentType =
  | 'TRANSPLANT'
  | 'ORGAN_THIEF'
  | 'CONTAGION'
  | 'LATEX_GLOVE'
  | 'MEDICAL_ERROR';
export type OrganStatus = 'HEALTHY' | 'INFECTED' | 'VACCINATED' | 'IMMUNIZED';
export type RoomStatus = 'WAITING' | 'IN_PROGRESS' | 'FINISHED' | 'ABANDONED';

export interface Card {
  id: string;
  type: CardType;
  color: CardColor;
  treatmentType: TreatmentType | null;
  name: string;
}

export interface OrganSlot {
  slotId: string;
  organCard: Card; // Debe ser type === 'ORGAN'
  modifiers: Card[]; // Arreglo real de cartas VIRUS o MEDICINE apiladas
  status: OrganStatus; // Calculado dinámicamente según modifiers
}

// ---------- Estado interno del servidor ----------

export interface ServerPlayer {
  playerId: string;
  sessionToken: string; // PRIVADO: nunca se envía a otros jugadores
  socketId: string | null;
  nickname: string;
  isHost: boolean;
  isConnected: boolean;
  hand: Card[];
  body: OrganSlot[];
}

export interface ActionLog {
  actorId: string;
  actionType: 'PLAY_CARD' | 'DISCARD' | 'AUTO_PASS' | 'LATEX_GLOVE_SKIP';
  cardPlayed?: string;
  targets?: string[];
  timestamp: string;
}

export interface GameState {
  roomId: string;
  status: RoomStatus;
  lastActivityTimestamp: number;
  config: {
    minPlayers: number;
    maxPlayers: number;
    organsToWin: number;
    turnTimeoutSeconds: number;
  };
  turnState: {
    currentPlayerId: string;
    turnOrder: string[];
    direction: 1;
    turnNumber: number;
    turnStartedAt: number;
  };
  decks: {
    drawPile: Card[];
    discardPile: Card[];
  };
  players: ServerPlayer[];
  winnerId: string | null;
  lastActionLog: ActionLog | null;
}

// ---------- Estado sanitizado para el cliente ----------

export interface PublicOpponentDTO {
  playerId: string;
  nickname: string;
  isHost: boolean;
  isConnected: boolean;
  handCount: number;
  body: OrganSlot[];
}

export interface ClientGameStateDTO {
  roomId: string;
  status: RoomStatus;
  turnState: {
    currentPlayerId: string;
    isMyTurn: boolean;
    turnOrder: string[];
    turnRemainingSeconds: number;
    turnNumber: number;
  };
  decks: {
    drawPileCount: number;
    discardPileCount: number;
    topDiscardCard: Card | null;
  };
  me: {
    playerId: string;
    nickname: string;
    isHost: boolean;
    hand: Card[];
    body: OrganSlot[];
  };
  opponents: PublicOpponentDTO[];
  winnerId: string | null;
  lastActionLog: ActionLog | null;
}

// ---------- Protocolo WebSocket ----------

export type PlayCardTarget =
  | null
  | { targetPlayerId: string; targetSlotId: string }
  | {
      firstPlayerId: string;
      firstSlotId: string;
      secondPlayerId: string;
      secondSlotId: string;
    }
  | {
      transfers: Array<{
        fromSlotId: string;
        toPlayerId: string;
        toSlotId: string;
      }>;
    }
  | { targetPlayerId: string };

export type GameActionPayload =
  | {
      roomId: string;
      playerId: string;
      actionType: 'DISCARD';
      payload: {
        cardIds: string[];
      };
    }
  | {
      roomId: string;
      playerId: string;
      actionType: 'PLAY_CARD';
      payload: {
        cardId: string;
        target: PlayCardTarget;
      };
    };

export interface RoomCreatePayload {
  nickname: string;
}
export interface RoomJoinPayload {
  roomId: string;
  nickname: string;
}
export interface RoomReconnectPayload {
  roomId: string;
  playerId: string;
  sessionToken: string;
}
export interface GameStartPayload {
  roomId: string;
}
export interface GameRematchPayload {
  roomId: string;
}

export interface RoomJoinedSuccessPayload {
  roomId: string;
  playerId: string;
  sessionToken: string;
}

export interface RoomUpdatedPayload {
  roomId: string;
  status: RoomStatus;
  players: {
    playerId: string;
    nickname: string;
    isHost: boolean;
    isConnected: boolean;
  }[];
}

export interface GameActionErrorPayload {
  code: string;
  message: string;
}

export interface GameOverPayload {
  winnerId: string;
  winnerNickname: string;
  finalState: ClientGameStateDTO;
}

export interface ClientToServerEvents {
  'room:create': (payload: RoomCreatePayload) => void;
  'room:join': (payload: RoomJoinPayload) => void;
  'room:reconnect': (payload: RoomReconnectPayload) => void;
  'game:start': (payload: GameStartPayload) => void;
  'game:action': (payload: GameActionPayload) => void;
  'game:rematch': (payload: GameRematchPayload) => void;
}

export interface ServerToClientEvents {
  'room:joined_success': (payload: RoomJoinedSuccessPayload) => void;
  'room:updated': (payload: RoomUpdatedPayload) => void;
  'game:state_sync': (payload: ClientGameStateDTO) => void;
  'game:action_error': (payload: GameActionErrorPayload) => void;
  'game:over': (payload: GameOverPayload) => void;
}
