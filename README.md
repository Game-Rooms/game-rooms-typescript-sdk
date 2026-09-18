# game-rooms-typescript-sdk

TypeScript SDK for Game Rooms HTTP and realtime protocols.

## Installation

```bash
npm install game-rooms-typescript-sdk
```

## Usage

```ts
import { GameRoomsHttpClient, GameRoomsSocketClient } from "game-rooms-typescript-sdk";

const http = new GameRoomsHttpClient({
  baseUrl: "https://your-game-rooms-api.example"
});

const room = await http.createRoom({ appId: "my-game" });

const socket = new GameRoomsSocketClient({
  wsUrl: "wss://your-game-rooms-api.example/ws"
});

await socket.connect({
  role: "host",
  roomCode: room.code,
  token: room.hostToken
});

await socket.createObject({ key: "state", type: "object", value: { started: true } });
```

## Features

- HTTP methods for creating rooms, fetching app config, and room lookup.
- WebSocket request/response handling using `{ opcode, seq, params }` and `{ pc, opcode, result, re }` packets.
- Distinct typed errors for room-not-found, room-locked, and room-full conditions.
- Helpers for object create/update/get/lock and relay operations.
