export type RoomRole = "host" | "player";

export interface CreateRoomRequest {
  appId: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CreateRoomResponse {
  roomId: string;
  code: string;
  hostToken?: string;
  playerToken?: string;
  [key: string]: unknown;
}

export interface AppConfigResponse {
  appId: string;
  [key: string]: unknown;
}

export interface RoomLookupResponse {
  roomId: string;
  code: string;
  locked?: boolean;
  full?: boolean;
  [key: string]: unknown;
}

export interface ClientPacket<TParams = unknown> {
  opcode: string;
  seq: number;
  params?: TParams;
}

export interface ServerPacket<TResult = unknown> {
  pc?: number;
  opcode: string;
  result?: TResult;
  re?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  [key: string]: unknown;
}

export interface SocketConnectOptions {
  role: RoomRole;
  roomCode?: string;
  roomId?: string;
  token?: string;
  query?: Record<string, string>;
}

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "close", listener: (event: { code: number; reason: string }) => void): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  addEventListener(type: "message", listener: (event: { data: string }) => void): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface HttpClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
}

export interface SocketClientOptions {
  wsUrl: string;
  webSocketFactory?: WebSocketFactory;
}
