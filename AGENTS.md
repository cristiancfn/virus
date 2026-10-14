# Directrices de Arquitectura y Desarrollo para Agentes (`AGENTS.md`)

Este repositorio contiene la implementación full-stack en tiempo real del juego de cartas **Virus!**, estructurado como un monorepo con TypeScript estricto.

## 1. Fuente Única de la Verdad
Antes de diseñar, modificar o generar cualquier archivo de código, **DEBES leer `docs/SPEC.md`**. Ese documento contiene el contrato inmutable de datos, la composición exacta del mazo de 68 cartas, las reglas de validación de los tratamientos, el protocolo de eventos WebSocket y las reglas de sanitización anti-trampas. No inventes reglas de juego ni modifiques los nombres de las propiedades JSON definidas allí.

## 2. Estructura del Monorepo (`pnpm workspaces`)
- `packages/shared` (`@virus/shared`): Tipos de TypeScript, Enums, constantes del mazo de 68 cartas y esquemas de validación con **Zod**. No debe tener dependencias de React ni de Express/Socket.io.
- `apps/server` (`@virus/server`): Backend en Node.js + Express + Socket.io desplegable en **Render**.
  - `src/engine/`: Motor de reglas puro del juego. **PROHIBIDO importar `socket.io` o librerías de red dentro de `src/engine/`**. Todas las funciones del motor deben ser puras, deterministas y 100% testeables con **Vitest**.
  - `src/rooms/`: Gestión de salas en memoria (`Map`), códigos de 6 caracteres, reconexión por `sessionToken`, recolector de basura (Garbage Collector) y sanitización de estado (`ClientGameStateDTO`).
  - `src/sockets/`: Controladores de eventos de Socket.io y temporizadores de turno (Auto-Pass de 45 segundos).
- `apps/client` (`@virus/client`): Frontend SPA en React (Vite) + TypeScript + Tailwind CSS + Zustand + Framer Motion desplegable en **Vercel**.

## 3. Reglas de Oro de Ingeniería
1. **Autoridad Total del Servidor:** El cliente jamás calcula el resultado de una jugada ni muta el estado del juego por su cuenta. El cliente solo emite intenciones (`game:action`) y renderiza el estado recibido en `game:state_sync`.
2. **Sanitización Obligatoria (Anti-Cheat):** Nunca emitas el objeto interno `GameState` a través de WebSockets. Siempre transforma el estado mediante `buildClientState(gameState, viewerPlayerId)` para enviar un `ClientGameStateDTO` individual a cada socket conectado, ocultando `drawPile` y las manos (`hand`) de los oponentes.
3. **Identidad Desacoplada del Socket:** Nunca uses `socket.id` como identificador de jugador (`playerId`). Usa `playerId` público para la lógica del juego y valida las reconexiones exclusivamente mediante el `sessionToken` privado del jugador.
4. **Conservación de Cartas en Modificadores:** Un `OrganSlot` en mesa nunca debe usar contadores numéricos simples para vacunas o virus. Siempre debe almacenar el arreglo exacto de objetos `Card` en `modifiers: Card[]` para que, al destruirse o curarse, las cartas exactas (incluyendo comodines `MULTICOLOR`) regresen a `discardPile`.
5. **Validación con Zod:** Todo payload entrante por WebSocket desde el cliente debe validarse primero con los esquemas de Zod definidos en `@virus/shared` antes de invocar al motor de reglas.

## 4. Flujo de Trabajo y Verificación
- Después de cualquier cambio en `packages/shared`, compila y verifica tipos con `pnpm --filter @virus/shared build`.
- Cualquier modificación en `apps/server/src/engine/` requiere ejecutar `pnpm --filter @virus/server test` (Vitest) y asegurar que el 100% de los tests unitarios pasen antes de tocar la capa de sockets o el cliente.