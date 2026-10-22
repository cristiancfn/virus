import { z } from 'zod';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  MAX_DISCARD_CARDS,
  DEFAULT_CONFIG,
  MIN_TURN_TIMEOUT_SECONDS,
  MAX_TURN_TIMEOUT_SECONDS,
} from './constants';

const nonEmpty = z.string().min(1).max(100);

export const roomIdSchema = z
  .string()
  .length(ROOM_CODE_LENGTH)
  .regex(new RegExp(`^[${ROOM_CODE_ALPHABET}]+$`), 'Código de sala inválido');

export const nicknameSchema = z.string().trim().min(1).max(20);

export const cardTypeSchema = z.enum(['ORGAN', 'VIRUS', 'MEDICINE', 'TREATMENT']);
export const cardColorSchema = z.enum(['RED', 'GREEN', 'BLUE', 'YELLOW', 'MULTICOLOR', 'NONE']);
export const treatmentTypeSchema = z.enum([
  'TRANSPLANT',
  'ORGAN_THIEF',
  'CONTAGION',
  'LATEX_GLOVE',
  'MEDICAL_ERROR',
]);
export const organStatusSchema = z.enum(['HEALTHY', 'INFECTED', 'VACCINATED', 'IMMUNIZED']);
export const roomStatusSchema = z.enum(['WAITING', 'IN_PROGRESS', 'FINISHED', 'ABANDONED']);

export const cardSchema = z.object({
  id: z.string(),
  type: cardTypeSchema,
  color: cardColorSchema,
  treatmentType: treatmentTypeSchema.nullable(),
  name: z.string(),
});

export const organSlotSchema = z.object({
  slotId: z.string(),
  organCard: cardSchema,
  modifiers: z.array(cardSchema),
  status: organStatusSchema,
});

// ---------- Payloads cliente -> servidor ----------

export const turnTimeoutSecondsSchema = z
  .number()
  .int()
  .min(MIN_TURN_TIMEOUT_SECONDS)
  .max(MAX_TURN_TIMEOUT_SECONDS);

export const roomCreatePayloadSchema = z
  .object({
    nickname: nicknameSchema,
    turnTimeoutSeconds: turnTimeoutSecondsSchema.default(DEFAULT_CONFIG.turnTimeoutSeconds),
  })
  .strict();

export const roomJoinPayloadSchema = z
  .object({ roomId: roomIdSchema, nickname: nicknameSchema })
  .strict();

export const LeaveRoomSchema = z.object({ roomId: roomIdSchema }).strict();
export const ForceSkipSchema = z.object({ roomId: roomIdSchema }).strict();
export const roomLeavePayloadSchema = LeaveRoomSchema;
export const gameForceSkipPayloadSchema = ForceSkipSchema;

export const roomReconnectPayloadSchema = z
  .object({ roomId: roomIdSchema, playerId: nonEmpty, sessionToken: nonEmpty })
  .strict();

export const gameStartPayloadSchema = z.object({ roomId: roomIdSchema }).strict();
export const gameRematchPayloadSchema = z.object({ roomId: roomIdSchema }).strict();

// ---------- game:action ----------

const slotTargetSchema = z
  .object({ targetPlayerId: nonEmpty, targetSlotId: nonEmpty })
  .strict();

const transplantTargetSchema = z
  .object({
    firstPlayerId: nonEmpty,
    firstSlotId: nonEmpty,
    secondPlayerId: nonEmpty,
    secondSlotId: nonEmpty,
  })
  .strict();

const contagionTargetSchema = z
  .object({
    transfers: z
      .array(
        z
          .object({ fromSlotId: nonEmpty, toPlayerId: nonEmpty, toSlotId: nonEmpty })
          .strict(),
      )
      .min(1),
  })
  .strict();

const playerTargetSchema = z.object({ targetPlayerId: nonEmpty }).strict();

export const playCardTargetSchema = z.union([
  z.null(),
  slotTargetSchema,
  transplantTargetSchema,
  contagionTargetSchema,
  playerTargetSchema,
]);

export const discardActionSchema = z
  .object({
    roomId: roomIdSchema,
    playerId: nonEmpty,
    actionType: z.literal('DISCARD'),
    payload: z
      .object({
        cardIds: z
          .array(nonEmpty)
          .min(1)
          .max(MAX_DISCARD_CARDS)
          .refine((ids) => new Set(ids).size === ids.length, 'cardIds duplicados'),
      })
      .strict(),
  })
  .strict();

export const playCardActionSchema = z
  .object({
    roomId: roomIdSchema,
    playerId: nonEmpty,
    actionType: z.literal('PLAY_CARD'),
    payload: z.object({ cardId: nonEmpty, target: playCardTargetSchema }).strict(),
  })
  .strict();

export const gameActionPayloadSchema = z.discriminatedUnion('actionType', [
  discardActionSchema,
  playCardActionSchema,
]);
