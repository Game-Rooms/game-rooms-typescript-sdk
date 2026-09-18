import { ProtocolError } from "./errors";
import type { ClientPacket, ServerPacket, SocketClientOptions, SocketConnectOptions, WebSocketFactory, WebSocketLike } from "./types";

type ListenerMap = {
  open: Array<() => void>;
  close: Array<(event: { code: number; reason: string }) => void>;
  error: Array<(event: unknown) => void>;
  notification: Array<(packet: ServerPacket) => void>;
  message: Array<(packet: ServerPacket) => void>;
};
type ActiveSocketHandlers = {
  socket: WebSocketLike;
  open: () => void;
  close: (event: { code: number; reason: string }) => void;
  error: (event: unknown) => void;
  message: (event: { data: string }) => void;
};

const defaultFactory: WebSocketFactory = (url: string) => {
  const WebSocketConstructor = (globalThis as { WebSocket?: new (value: string) => WebSocketLike }).WebSocket;
  if (!WebSocketConstructor) {
    throw new ProtocolError("No WebSocket implementation found; provide webSocketFactory in this runtime");
  }

  return new WebSocketConstructor(url);
};
const OPEN_STATE = 1;

export class GameRoomsSocketClient {
  private readonly wsUrl: string;
  private readonly webSocketFactory: WebSocketFactory;
  private socket?: WebSocketLike;
  private activeHandlers?: ActiveSocketHandlers;
  private connectReject?: (reason?: unknown) => void;
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
    let parsedWsUrl: URL;
    try {
      parsedWsUrl = new URL(options.wsUrl);
    } catch {
      throw new ProtocolError("Invalid wsUrl; expected an absolute WebSocket URL");
    }
    if (parsedWsUrl.protocol !== "ws:" && parsedWsUrl.protocol !== "wss:") {
      throw new ProtocolError("Invalid wsUrl; expected an absolute WebSocket URL");
    }
    this.wsUrl = parsedWsUrl.toString().replace(/\/$/, "");
    this.webSocketFactory = options.webSocketFactory ?? defaultFactory;
  }

  connect(options: SocketConnectOptions): Promise<void> {
    if (this.socket) {
      return Promise.reject(new ProtocolError("Socket is already connected"));
    }

    let url: string;
    try {
      url = this.createConnectionUrl(options);
    } catch (error) {
      return Promise.reject(error);
    }
    try {
      this.socket = this.webSocketFactory(url);
    } catch (error) {
      return Promise.reject(new ProtocolError("Failed to create WebSocket", { details: error }));
    }

    return new Promise((resolve, reject) => {
      this.connectReject = reject;
      if (!this.socket) {
        reject(new ProtocolError("WebSocket was not created"));
        return;
      }

      const socket = this.socket;
      let settled = false;
      const openHandler = () => {
        socket.removeEventListener?.("open", openHandler);
        this.connectReject = undefined;
        settled = true;
        this.emit("open");
        resolve();
      };

      const closeHandler = (event: { code: number; reason: string }) => {
        this.detachSocketListeners(socket, openHandler, closeHandler, errorHandler, messageHandler);
        this.activeHandlers = undefined;
        this.connectReject = undefined;
        this.rejectAllPending(new ProtocolError("Socket closed", { details: event }));
        this.socket = undefined;
        this.emit("close", event);
        if (!settled) {
          reject(new ProtocolError("Socket closed before connection opened", { details: event }));
        }
      };

      const errorHandler = (event: unknown) => {
        const wrappedError = new ProtocolError("Socket error", { details: event });
        this.detachSocketListeners(socket, openHandler, closeHandler, errorHandler, messageHandler);
        this.activeHandlers = undefined;
        this.connectReject = undefined;
        this.rejectAllPending(wrappedError);
        this.socket = undefined;
        this.emit("error", wrappedError);
        if (!settled) {
          reject(wrappedError);
        }
      };

      const messageHandler = (event: { data: string }) => {
        this.handleIncoming(event.data);
      };

      socket.addEventListener("open", openHandler);
      socket.addEventListener("close", closeHandler);
      socket.addEventListener("error", errorHandler);
      socket.addEventListener("message", messageHandler);
      this.activeHandlers = { socket, open: openHandler, close: closeHandler, error: errorHandler, message: messageHandler };
    });
  }

  close(code?: number, reason?: string): void {
    const socket = this.socket;
    if (!socket) {
      return;
    }

    if (socket.readyState !== OPEN_STATE) {
      this.detachCurrentSocketListeners();
      this.socket = undefined;
      const closeError = new ProtocolError("Socket closed before connection opened", {
        details: { code: code ?? 1000, reason: reason ?? "" }
      });
      this.connectReject?.(closeError);
      this.connectReject = undefined;
      this.rejectAllPending(closeError);
      this.emit("close", { code: code ?? 1000, reason: reason ?? "" });
    }

    socket.close(code, reason);
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
    if (Boolean(options.roomCode) === Boolean(options.roomId)) {
      throw new ProtocolError("Provide exactly one of roomCode or roomId");
    }

    const url = new URL(this.wsUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

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

  private detachSocketListeners(
    socket: WebSocketLike,
    openHandler: () => void,
    closeHandler: (event: { code: number; reason: string }) => void,
    errorHandler: (event: unknown) => void,
    messageHandler: (event: { data: string }) => void
  ): void {
    socket.removeEventListener?.("open", openHandler);
    socket.removeEventListener?.("close", closeHandler);
    socket.removeEventListener?.("error", errorHandler);
    socket.removeEventListener?.("message", messageHandler);
  }

  private detachCurrentSocketListeners(): void {
    const handlers = this.activeHandlers;
    if (!handlers) {
      return;
    }

    this.detachSocketListeners(handlers.socket, handlers.open, handlers.close, handlers.error, handlers.message);
    this.activeHandlers = undefined;
  }
}
