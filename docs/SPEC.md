# Especificación Técnica del Sistema: Virus! Online (`SPEC.md`)

## 1. Resumen del Dominio y Reglas Generales
- **Jugadores por sala:** Mínimo 2, máximo 6 jugadores.
- **Condición de victoria:** Gana de forma inmediata el primer jugador que logre tener en su cuerpo (`body`) **4 órganos sanos** de diferente color al mismo tiempo.
- **Definición de Órgano Sano:** Un `OrganSlot` cuyo `status` sea `HEALTHY` (sin modificadores), `VACCINATED` (1 medicina) o `IMMUNIZED` (2 medicinas). Un órgano en estado `INFECTED` NO cuenta para la victoria.
- **Regla de Unicidad de Color en el Cuerpo:** Ningún jugador puede tener en su `body` dos órganos del mismo `color` al mismo tiempo. El órgano `MULTICOLOR` actúa como un quinto color comodín independiente, por lo que un jugador puede llegar a tener hasta 5 órganos en mesa (Rojo, Verde, Azul, Amarillo y Multicolor), necesitando solo 4 de ellos sanos para ganar.

---

## 2. Composición Exacta del Mazo (68 Cartas)

El generador del mazo (`deck.ts`) debe instanciar exactamente **68 cartas** con identificadores únicos (`id`):

| Tipo (`CardType`) | Color (`CardColor`) | Subtipo (`TreatmentType`) | Cantidad | Total Categoría |
| :--- | :--- | :--- | :---: | :---: |
| `ORGAN` | `RED`, `GREEN`, `BLUE`, `YELLOW` | `null` | 5 de cada color | 20 |
| `ORGAN` | `MULTICOLOR` | `null` | 1 | 1 |
| `VIRUS` | `RED`, `GREEN`, `BLUE`, `YELLOW` | `null` | 4 de cada color | 16 |
| `VIRUS` | `MULTICOLOR` | `null` | 1 | 1 |
| `MEDICINE` | `RED`, `GREEN`, `BLUE`, `YELLOW`, `MULTICOLOR` | `null` | 4 de cada color | 20 |
| `TREATMENT` | `NONE` | `TRANSPLANT` (Trasplante) | 3 | 3 |
| `TREATMENT` | `NONE` | `ORGAN_THIEF` (Ladrón de Órganos) | 3 | 3 |
| `TREATMENT` | `NONE` | `CONTAGION` (Contagio) | 2 | 2 |
| `TREATMENT` | `NONE` | `LATEX_GLOVE` (Guante de Látex) | 1 | 1 |
| `TREATMENT` | `NONE` | `MEDICAL_ERROR` (Error Médico) | 1 | 1 |
| **TOTAL** | | | | **68** |

---

## 3. Contratos de Datos y Tipos (`@virus/shared`)

### 3.1. Enums y Entidades Base

```typescript
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
  organCard: Card;      // Debe ser type === 'ORGAN'
  modifiers: Card[];    // Arreglo real de cartas VIRUS o MEDICINE apiladas
  status: OrganStatus;  // Calculado dinámicamente según modifiers
}
```

### 3.2. Estado Interno del Servidor (`GameState`)

```typescript
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
    minPlayers: number;         // Default: 2
    maxPlayers: number;         // Default: 6
    organsToWin: number;        // Default: 4
    turnTimeoutSeconds: number; // Parametrizable por el Host al crear sala: entre 15 y 120 (Default: 45)
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
```

### 3.3. Estado Sanitizado para el Cliente (`ClientGameStateDTO`)

```typescript
export interface PublicOpponentDTO {
  playerId: string;
  nickname: string;
  isHost: boolean;
  isConnected: boolean;
  handCount: number; // Oculta las cartas reales del rival
  body: OrganSlot[];
}

export interface ClientGameStateDTO {
  roomId: string;
  status: RoomStatus;
  config: {
    turnTimeoutSeconds: number;
  };
  turnState: {
    currentPlayerId: string;
    isMyTurn: boolean;
    turnOrder: string[];
    turnRemainingSeconds: number;
    turnNumber: number;
  };
  decks: {
    drawPileCount: number; // Oculta el orden del mazo
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
```

---

## 4. Máquina de Estados de `OrganSlot` y Reglas de Jugadas

### 4.1. Compatibilidad de Colores y Modificadores Multicolor
1. **Compatibilidad Base con el Órgano:** Una carta modificadora (`VIRUS` o `MEDICINE`) es compatible con el órgano base de un `OrganSlot` si y solo si:
   - `modifier.color === organSlot.organCard.color`
   - O `modifier.color === 'MULTICOLOR'`
   - O `organSlot.organCard.color === 'MULTICOLOR'`
2. **Vulnerabilidad de la Medicina Multicolor:** Si un `OrganSlot` está en estado `'VACCINATED'` y su medicina apilada (`modifiers[0]`) tiene `color === 'MULTICOLOR'`, **cualquier carta `VIRUS` de cualquier color** (`RED`, `GREEN`, `BLUE`, `YELLOW` o `MULTICOLOR`) es válida sobre ese `OrganSlot` para destruir dicha vacuna multicolor.
3. **Vulnerabilidad del Virus Multicolor:** Si un `OrganSlot` está en estado `'INFECTED'` y su virus apilado (`modifiers[0]`) tiene `color === 'MULTICOLOR'`, **cualquier carta `MEDICINE` de cualquier color** (`RED`, `GREEN`, `BLUE`, `YELLOW` o `MULTICOLOR`) jugada por el dueño del órgano es válida sobre ese `OrganSlot` para curar/eliminar dicho virus multicolor. *(Nota: Para extirpar ese órgano añadiendo un segundo virus, o para inmunizar un órgano vacunado añadiendo una segunda medicina, la segunda carta sí debe cumplir la Compatibilidad Base con el `organCard` descrita en el punto 1).*

### 4.2. Transiciones de Estado en `OrganSlot`
1. **Aplicar `VIRUS` sobre un `OrganSlot` (propio o rival, cumpliendo la sección 4.1):**
   - Si `status === 'HEALTHY'`: se añade el virus a `modifiers`. El estado pasa a `'INFECTED'`.
   - Si `status === 'VACCINATED'`: la medicina que estaba en `modifiers` y el nuevo virus se envían a `discardPile`. `modifiers` queda vacío (`[]`) y el estado pasa a `'HEALTHY'`.
   - Si `status === 'INFECTED'`: el `organCard`, el virus previo y el nuevo virus se envían a `discardPile`. El `OrganSlot` se elimina del arreglo `body` del jugador.
   - Si `status === 'IMMUNIZED'`: **Jugada inválida**. Un órgano inmunizado no puede ser objetivo de virus.

2. **Aplicar `MEDICINE` sobre un `OrganSlot` (exclusivamente en el `body` propio, cumpliendo la sección 4.1):**
   - Si `status === 'HEALTHY'`: se añade la medicina a `modifiers`. El estado pasa a `'VACCINATED'`.
   - Si `status === 'INFECTED'`: el virus que estaba en `modifiers` y la nueva medicina se envían a `discardPile`. `modifiers` queda vacío (`[]`) y el estado pasa a `'HEALTHY'`.
   - Si `status === 'VACCINATED'`: se añade la segunda medicina a `modifiers`. El estado pasa a `'IMMUNIZED'`.
   - Si `status === 'IMMUNIZED'`: **Jugada inválida**. Ya tiene 2 medicinas.

### 4.3. Reglas Exactas de los 5 Tratamientos (`TREATMENT`)
Al jugarse cualquier carta de tratamiento, la carta de tratamiento en sí siempre va a `discardPile` tras resolver su efecto:

1. **`TRANSPLANT` (Trasplante):**
   - Selecciona dos `OrganSlot` pertenecientes a dos jugadores distintos (pueden ser el jugador activo y un rival, o dos rivales entre sí).
   - **Restricciones:**
     - Ninguno de los dos órganos puede tener `status === 'IMMUNIZED'`.
     - Tras el intercambio, ninguno de los dos jugadores puede quedar con dos órganos del mismo `color` en su `body`.
   - **Efecto:** Se intercambian ambos `OrganSlot` conservando intactos sus respectivos arreglos `modifiers` y `status`.

2. **`ORGAN_THIEF` (Ladrón de Órganos):**
   - Selecciona un `OrganSlot` del `body` de un rival para robarlo y añadirlo al `body` del jugador activo.
   - **Restricciones:**
     - El órgano objetivo no puede tener `status === 'IMMUNIZED'`.
     - El jugador activo no puede tener ya un órgano de ese mismo `color` en su propio `body`.
   - **Efecto:** El `OrganSlot` (con sus modificadores actuales) se mueve del `body` del rival al `body` del jugador activo.

3. **`CONTAGION` (Contagio):**
   - Permite al jugador activo trasladar uno o más virus desde sus propios órganos `INFECTED` hacia órganos de los demás jugadores.
   - **Restricciones:**
     - Debe realizarse al menos 1 transferencia válida (no se puede jugar `CONTAGION` sin mover ningún virus, aunque sí se puede descartar en modo descarte).
     - Cada `fromSlotId` debe pertenecer al jugador activo y tener `status === 'INFECTED'`.
     - Cada `toSlotId` debe pertenecer a otro jugador, tener `status === 'HEALTHY'` (estrictamente libre: sin virus ni vacunas) y ser de un color compatible con el virus que se le transfiere (`virus.color === toSlot.organCard.color || virus.color === 'MULTICOLOR' || toSlot.organCard.color === 'MULTICOLOR'`).
     - No se pueden enviar dos virus al mismo `toSlotId` dentro del mismo `CONTAGION` (porque tras recibir el primero deja de estar `HEALTHY`).
   - **Efecto:** Por cada transferencia, el virus sale de `fromSlot.modifiers` (dejando al órgano propio `HEALTHY`) y entra a `toSlot.modifiers` (dejando al órgano rival `INFECTED`).

4. **`LATEX_GLOVE` (Guante de Látex):**
   - No requiere seleccionar objetivo (`target: null`).
   - **Efecto inmediato:** Todas las cartas en el arreglo `hand` de todos los demás jugadores se mueven a `discardPile`, dejando sus manos vacías (`hand: []`).
   - **Efecto diferido en cambio de turno:** Cuando el turno llega a un jugador con `hand.length === 0`, el motor le reparte 3 cartas automáticamente desde `drawPile`, registra un `lastActionLog` con `'LATEX_GLOVE_SKIP'` y **pasa el turno inmediatamente al siguiente jugador**.

5. **`MEDICAL_ERROR` (Error Médico):**
   - Selecciona a un jugador objetivo (`targetPlayerId`) distinto del jugador activo.
   - **Efecto:** Intercambia por completo el arreglo `body` del jugador activo con el arreglo `body` del jugador objetivo, **incluyendo** los órganos `IMMUNIZED`. Es válido incluso si uno de los dos jugadores tiene `body: []`.

---

## 5. Protocolo WebSocket y Payloads de `game:action`

### 5.1. Catálogo de Eventos
- **Cliente → Servidor:**
  - `room:create`: `{ nickname: string, turnTimeoutSeconds?: number }` (Entero entre 15 y 120, default: `45`)
  - `room:join`: `{ roomId: string, nickname: string }`
  - `room:leave`: `{ roomId: string }`
  - `room:reconnect`: `{ roomId: string, playerId: string, sessionToken: string }`
  - `game:start`: `{ roomId: string }`
  - `game:action`: `GameActionPayload` (ver sección 5.2)
  - `game:force_skip`: `{ roomId: string }` (Exclusivo para el Host cuando el jugador del turno actual tiene `isConnected === false`)
  - `game:rematch`: `{ roomId: string }`
- **Servidor → Cliente:**
  - `room:joined_success`: `{ roomId: string, playerId: string, sessionToken: string }`
  - `room:updated`: `{ roomId: string, status: RoomStatus, config: { turnTimeoutSeconds: number }, players: { playerId: string, nickname: string, isHost: boolean, isConnected: boolean }[] }`
  - `game:state_sync`: `ClientGameStateDTO`
  - `game:action_error`: `{ code: string, message: string }`
  - `game:over`: `{ winnerId: string, winnerNickname: string, finalState: ClientGameStateDTO }`

### 5.2. Esquemas Polimórficos de `game:action`

```typescript
export type GameActionPayload =
  | {
      roomId: string;
      playerId: string;
      actionType: 'DISCARD';
      payload: {
        cardIds: string[]; // Mínimo 1, máximo 3 cartas de la mano del jugador
      };
    }
  | {
      roomId: string;
      playerId: string;
      actionType: 'PLAY_CARD';
      payload: {
        cardId: string;
        target:
          | null // Para ORGAN propio o LATEX_GLOVE
          | { targetPlayerId: string; targetSlotId: string } // Para VIRUS, MEDICINE, ORGAN_THIEF
          | {
              firstPlayerId: string;
              firstSlotId: string;
              secondPlayerId: string;
              secondSlotId: string;
            } // Para TRANSPLANT
          | {
              transfers: Array<{
                fromSlotId: string;
                toPlayerId: string;
                toSlotId: string;
              }>;
            } // Para CONTAGION
          | { targetPlayerId: string }; // Para MEDICAL_ERROR
      };
    };
```

### 5.3. Pipeline Transaccional de Ejecución del Turno (6 Pasos)
Cada vez que el servidor procesa `game:action`:
1. **Verificación de Turno y Propiedad:** Confirmar que `status === 'IN_PROGRESS'`, que `turnState.currentPlayerId === playerId` y que las cartas indicadas existen en `player.hand`.
2. **Validación de Reglas de Dominio:** Ejecutar el validador de la acción. Si falla, emitir `game:action_error` únicamente al emisor y abortar sin mutar el estado.
3. **Mutación del Estado y Descarte:** Retirar la(s) carta(s) jugada(s) de `player.hand`, aplicar el efecto en el tablero y mover las cartas descartadas o destruidas a `decks.discardPile`.
4. **Reposición de Mano (Robo Automático):** Calcular `needed = 3 - player.hand.length`. Robar `needed` cartas de `decks.drawPile`.
   - **Reciclaje de Mazo:** Si `drawPile.length < needed`, robar primero las que quedan en `drawPile`, tomar todo `discardPile`, barajarlo con el algoritmo *Fisher-Yates*, asignarlo a `drawPile` (vaciando `discardPile`) y terminar de robar las cartas faltantes.
5. **Verificación de Victoria:** Recorrer todos los jugadores en `players`. Si algún jugador tiene `4` o más `OrganSlot` en su `body` cuyo `status` sea `'HEALTHY'`, `'VACCINATED'` o `'IMMUNIZED'`, asignar `winnerId = player.playerId`, cambiar `status = 'FINISHED'`, detener el temporizador de turno y emitir `game:over` y `game:state_sync`.
6. **Avance de Turno y Salto por Guante de Látex:** Si no hay ganador, avanzar `currentPlayerId` al siguiente jugador en `turnOrder`.
   - Si el nuevo jugador activo tiene `hand.length === 0`, repartirle inmediatamente 3 cartas desde `drawPile`, registrar `lastActionLog` y volver a avanzar `currentPlayerId` al siguiente jugador (en bucle por si varios jugadores seguidos tienen 0 cartas). Reiniciar el temporizador de `config.turnTimeoutSeconds` y emitir `game:state_sync` sanitizado a cada cliente.

---

## 6. Gestión de Salas, Reconexión por Nickname, Temporizadores y Limpieza

- **Generador de Códigos de Sala:** Cadenas aleatorias de 6 caracteres usando exclusivamente el alfabeto `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (sin `0`, `O`, `1`, `I`, `L`).
- **Salida y Desconexión en Estado `WAITING`:** Mientras la sala está en `WAITING`, si un jugador emite `room:leave` o se desconecta (`disconnect`), **se elimina inmediatamente** del arreglo `players` de la sala para no dejar jugadores fantasma desconectados en la sala de espera. Si era el Host (`isHost === true`), se transfiere `isHost = true` al siguiente jugador restante. Si la sala queda sin jugadores, se elimina del `Map`.
- **Salida en Partida en Curso (`IN_PROGRESS`):** Si un jugador emite `room:leave` o se desconecta durante una partida `IN_PROGRESS`, su registro se conserva con `isConnected = false` para no romper el ciclo de turnos ni perder sus cartas/órganos. Si el jugador que se desconecta en `IN_PROGRESS` tenía `isHost === true`, el rol `isHost = true` se transfiere dinámicamente al primer jugador que continúe con `isConnected === true` para que la sala nunca quede sin un Host activo capaz de gestionar la partida; si todos se desconectan, el primero en reconectarse asume `isHost = true`.
- **Reclamación de Asiento por Nickname (Case-Insensitive) en `room:join`:** Cuando un usuario intenta unirse a una sala mediante `room:join` (tanto en estado `WAITING` como en `IN_PROGRESS`), el servidor busca primero si en `gameState.players` existe un jugador cuyo `nickname` coincida ignorando mayúsculas/minúsculas y espacios extremos (`p.nickname.trim().toLowerCase() === nickname.trim().toLowerCase()`):
  - Si existe y tiene `isConnected === true`: rechaza la unión con `game:action_error` (`NICKNAME_TAKEN`, *"Ya existe un jugador conectado con ese nombre en la sala"*).
  - Si existe y tiene `isConnected === false`: **Reclama el asiento existente** (sin duplicar al usuario ni rechazar con error de partida ya iniciada). El servidor actualiza su `socketId`, marca `isConnected = true`, le emite `room:joined_success` con el `playerId` y `sessionToken` de ese asiento, emite `room:updated` a la sala y, si la partida está en `IN_PROGRESS` o `FINISHED`, le emite su `game:state_sync` (reactivando el temporizador de turno si todos estaban desconectados).
  - Si NO existe ningún jugador con ese `nickname`: procede como jugador nuevo (permitido únicamente si `status === 'WAITING'` y hay menos de 6 jugadores).
- **Temporizador de Turno Parametrizable (`turnTimeoutSeconds`) y Salto Forzado por el Host (`game:force_skip`):**
  - Al iniciar cada turno se programa un timeout de `gameState.config.turnTimeoutSeconds` (entre 15 y 120 segundos, default 45s). Si expira sin jugada válida, el servidor ejecuta el **Auto-Pass**: descarta automáticamente `player.hand[0]` (o repone 3 cartas si tenía 0), roba 1 carta y avanza el turno registrando `actionType: 'AUTO_PASS'`.
  - Si el jugador del turno actual (`turnState.currentPlayerId`) tiene `isConnected === false`, el jugador con `isHost === true` puede emitir `game:force_skip` en cualquier momento para ejecutar el **Auto-Pass** de ese jugador desconectado de inmediato sin esperar a que expire el temporizador.
- **Garbage Collector:** Un `setInterval` cada 5 minutos elimina del `Map` de salas aquellas que lleven más de 10 minutos con todos los jugadores desconectados (`isConnected === false`) o más de 30 minutos sin cambios en `lastActivityTimestamp` estando en `WAITING` o `FINISHED`.