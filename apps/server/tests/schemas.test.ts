import { describe, expect, it } from 'vitest';
import {
  ForceSkipSchema,
  LeaveRoomSchema,
  roomCreatePayloadSchema,
} from '@virus/shared';

describe('roomCreatePayloadSchema', () => {
  it('aplica el default de 45 segundos', () => {
    expect(roomCreatePayloadSchema.parse({ nickname: 'Ana' })).toEqual({
      nickname: 'Ana',
      turnTimeoutSeconds: 45,
    });
  });

  it.each([15, 45, 120])('acepta enteros dentro del rango (%i)', (n) => {
    expect(roomCreatePayloadSchema.parse({ nickname: 'Ana', turnTimeoutSeconds: n })).toMatchObject({
      turnTimeoutSeconds: n,
    });
  });

  it.each([14, 121, 0, -1, 45.5, '45', null, Number.NaN])(
    'rechaza turnTimeoutSeconds inválido (%s)',
    (n) => {
      expect(roomCreatePayloadSchema.safeParse({ nickname: 'Ana', turnTimeoutSeconds: n }).success).toBe(
        false,
      );
    },
  );

  it('rechaza propiedades desconocidas', () => {
    expect(roomCreatePayloadSchema.safeParse({ nickname: 'Ana', extra: 1 }).success).toBe(false);
  });
});

describe('LeaveRoomSchema / ForceSkipSchema', () => {
  it.each([
    ['LeaveRoomSchema', LeaveRoomSchema],
    ['ForceSkipSchema', ForceSkipSchema],
  ] as const)('%s valida un roomId correcto y rechaza el resto', (_name, schema) => {
    expect(schema.safeParse({ roomId: 'ABC234' }).success).toBe(true);
    expect(schema.safeParse({ roomId: 'ABC23' }).success).toBe(false);
    expect(schema.safeParse({ roomId: 'ABC10O' }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ roomId: 'ABC234', extra: true }).success).toBe(false);
  });
});
