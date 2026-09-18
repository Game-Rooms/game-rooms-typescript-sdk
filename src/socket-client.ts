import { ProtocolError } from "./errors";
import type { ClientPacket, ServerPacket, SocketClientOptions, SocketConnectOptions, WebSocketFactory, WebSocketLike } from "./types";

type ListenerMap = {
  open: Array<() => void>;
  close: Array<(event: { code: number; reason: string }) => void>;
  error: Array<(event: unknown) => void>;
  notification: Array<(packet: ServerPacket) => void>;
  message: Array<(packet: ServerPacket) => void>;
};

const defaultFactory: WebSocketFactory = (url: string) => new WebSocket(url) as unknown as WebSocketLike;
const OPEN_STATE = 1;
const CLOSED_STATE = 3;

export class GameRoomsSocketClient {
  private readonly wsUrl: string;
  private readonly webSocketFactory: WebSocketFactory;
  private socket?: WebSocketLike;
  private sequence = 0;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>();
  private readonly listeners: ListenerMap = {
    open: [],
    close: [],
    error: [],
    notification: [],
    message: []
  };

  constructor(options: SocketClientOptions) {
    this.wsUrl = options.wsUrl.replace(/\/$/, "");
    this.webSocketFactory = options.webSocketFactory ?? defaultFactory;
  }

  connect(options: SocketConnectOptions): Promise<void> {
    if (this.socket && this.socket.readyState !== CLOSED_STATE) {
      return Promise.reject(new ProtocolError("Socket is already connected"));
    }

    const url = this.createConnectionUrl(options);
    this.socket = this.webSocketFactory(url);

    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new ProtocolError("WebSocket was not created"));
        return;
      }

      this.socket.addEventListener("open", () => {
        this.emit("open");
        resolve();
      });

      this.socket.addEventListener("close", (event) => {
        this.rejectAllPending(new ProtocolError("Socket closed", { details: event }));
        this.socket = undefined;
        this.emit("close", event);
      });

      this.socket.addEventListener("error", (event) => {
        this.emit("error", event);
        reject(new ProtocolError("Socket error", { details: event }));
      });

      this.socket.addEventListener("message", (event) => {
        this.handleIncoming(event.data);
      });
    });
  }

  close(code?: number, reason?: string): void {
    this.socket?.close(code, reason);
  }

  on<E extends keyof ListenerMap>(event: E, listener: ListenerMap[E][number]): void {
    this.listeners[event].push(listener as never);
  }

  request<TResult = unknown>(opcode: string, params?: unknown): Promise<TResult> {
    if (!this.socket) {
      return Promise.reject(new ProtocolError("Socket is not connected"));
    }
    if (this.socket.readyState !== OPEN_STATE) {
      return Promise.reject(new ProtocolError("Socket is not open"));
    }

    const seq = ++this.sequence;
    const payload: ClientPacket = { opcode, seq, params };

    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(seq, {
        resolve: resolve as (value: unknown) => void,
        reject
      });

      try {
        this.socket?.send(JSON.stringify(payload));
      } catch (error) {
        this.pending.delete(seq);
        reject(new ProtocolError("Failed to send request", { details: error }));
      }
    });
  }

  createObject(params: unknown): Promise<unknown> {
    return this.request("object.create", params);
  }

  updateObject(params: unknown): Promise<unknown> {
    return this.request("object.update", params);
  }

  getObject(params: unknown): Promise<unknown> {
    return this.request("object.get", params);
  }

  lockObject(params: unknown): Promise<unknown> {
    return this.request("object.lock", params);
  }

  relay(params: unknown): Promise<unknown> {
    return this.request("relay", params);
  }

  private createConnectionUrl(options: SocketConnectOptions): string {
    const url = new URL(this.wsUrl);
    url.searchParams.set("role", options.role);
    if (options.roomCode) {
      url.searchParams.set("code", options.roomCode);
    }

    if (options.roomId) {
      url.searchParams.set("roomId", options.roomId);
    }

    if (options.token) {
      url.searchParams.set("token", options.token);
    }

    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    return url.toString();
  }

  private handleIncoming(raw: string): void {
    let packet: ServerPacket;
    try {
      packet = JSON.parse(raw) as ServerPacket;
    } catch {
      this.emit("error", new ProtocolError("Invalid JSON packet", { details: raw }));
      return;
    }

    this.emit("message", packet);

    if (typeof packet.pc === "number") {
      const waiter = this.pending.get(packet.pc);
      if (!waiter) {
        this.emit("error", new ProtocolError(`No pending request for pc=${packet.pc}`, { details: packet }));
        return;
      }

      this.pending.delete(packet.pc);

      if (packet.re) {
        waiter.reject(new ProtocolError(packet.re.message ?? "Request failed", {
          code: packet.re.code,
          details: packet.re.details ?? packet
        }));
        return;
      }

      waiter.resolve(packet.result);
      return;
    }

    this.emit("notification", packet);
  }

  private rejectAllPending(error: Error): void {
    for (const [seq, waiter] of this.pending.entries()) {
      waiter.reject(error);
      this.pending.delete(seq);
    }
  }

  private emit(event: "open"): void;
  private emit(event: "close", payload: { code: number; reason: string }): void;
  private emit(event: "error", payload: unknown): void;
  private emit(event: "notification", payload: ServerPacket): void;
  private emit(event: "message", payload: ServerPacket): void;
  private emit(event: keyof ListenerMap, payload?: unknown): void {
    for (const listener of this.listeners[event]) {
      (listener as (...args: unknown[]) => void)(payload);
    }
  }
}
