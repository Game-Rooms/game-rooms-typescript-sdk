import { describe, expect, it } from "vitest";
import { GameRoomsSocketClient, ProtocolError, type WebSocketLike } from "../src";

class FakeSocket implements WebSocketLike {
  readyState = 1;
  private listeners: Record<string, Array<(event?: any) => void>> = {
    open: [],
    close: [],
    error: [],
    message: []
  };
  public sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    this.readyState = 3;
    for (const fn of this.listeners.close) {
      fn({ code, reason });
    }
  }

  addEventListener(type: "open" | "close" | "error" | "message", listener: (event?: any) => void): void {
    this.listeners[type].push(listener);
  }

  removeEventListener(type: "open" | "close" | "error" | "message", listener: (event?: any) => void): void {
    this.listeners[type] = this.listeners[type].filter((registered) => registered !== listener);
  }

  emit(type: "open" | "close" | "error" | "message", event?: any): void {
    for (const fn of this.listeners[type]) {
      fn(event);
    }
  }
}

describe("GameRoomsSocketClient", () => {
  it("sends seq packet and resolves matching response", async () => {
    const fake = new FakeSocket();
    const client = new GameRoomsSocketClient({
      wsUrl: "wss://example.test/socket",
      webSocketFactory: () => fake
    });

    const connected = client.connect({ role: "host", roomCode: "ABCD" });
    fake.emit("open");
    await connected;

    const requestPromise = client.request("object.get", { key: "score" });
    const sent = JSON.parse(fake.sent[0]) as { seq: number };

    fake.emit("message", { data: JSON.stringify({ pc: sent.seq, opcode: "object.get", result: 42 }) });

    await expect(requestPromise).resolves.toBe(42);
  });

  it("rejects request when server returns re", async () => {
    const fake = new FakeSocket();
    const client = new GameRoomsSocketClient({
      wsUrl: "wss://example.test/socket",
      webSocketFactory: () => fake
    });

    const connected = client.connect({ role: "player", roomCode: "ABCD" });
    fake.emit("open");
    await connected;

    const requestPromise = client.request("object.update", { key: "score", value: 1 });
    const sent = JSON.parse(fake.sent[0]) as { seq: number };

    fake.emit("message", {
      data: JSON.stringify({ pc: sent.seq, opcode: "object.update", re: { code: "locked", message: "locked" } })
    });

    await expect(requestPromise).rejects.toBeInstanceOf(ProtocolError);
  });

  it("rejects request when response opcode mismatches", async () => {
    const fake = new FakeSocket();
    const client = new GameRoomsSocketClient({
      wsUrl: "wss://example.test/socket",
      webSocketFactory: () => fake
    });

    const connected = client.connect({ role: "player", roomCode: "ABCD" });
    fake.emit("open");
    await connected;

    const requestPromise = client.request("object.get", { key: "score" });
    const sent = JSON.parse(fake.sent[0]) as { seq: number };

    fake.emit("message", {
      data: JSON.stringify({ pc: sent.seq, opcode: "object.update", result: 10 })
    });

    await expect(requestPromise).rejects.toBeInstanceOf(ProtocolError);
  });

  it("emits error for invalid JSON packets", async () => {
    const fake = new FakeSocket();
    const client = new GameRoomsSocketClient({
      wsUrl: "wss://example.test/socket",
      webSocketFactory: () => fake
    });

    const connected = client.connect({ role: "player", roomCode: "ABCD" });
    fake.emit("open");
    await connected;

    let errorCount = 0;
    client.on("error", () => {
      errorCount += 1;
    });

    fake.emit("message", { data: "not-json" });
    expect(errorCount).toBe(1);
  });

  it("emits error for unmatched pc", async () => {
    const fake = new FakeSocket();
    const client = new GameRoomsSocketClient({
      wsUrl: "wss://example.test/socket",
      webSocketFactory: () => fake
    });

    const connected = client.connect({ role: "host", roomCode: "ABCD" });
    fake.emit("open");
    await connected;

    let errorCount = 0;
    client.on("error", () => {
      errorCount += 1;
    });

    fake.emit("message", { data: JSON.stringify({ pc: 999, opcode: "noop" }) });
    expect(errorCount).toBe(1);
  });

  it("rejects pending requests on socket error", async () => {
    const fake = new FakeSocket();
    const client = new GameRoomsSocketClient({
      wsUrl: "wss://example.test/socket",
      webSocketFactory: () => fake
    });

    const connected = client.connect({ role: "player", roomCode: "ABCD" });
    fake.emit("open");
    await connected;

    const requestPromise = client.request("object.get", { key: "state" });
    let receivedError: unknown;
    client.on("error", (error) => {
      receivedError = error;
    });
    fake.emit("error", new Error("boom"));

    await expect(requestPromise).rejects.toBeInstanceOf(ProtocolError);
    expect(receivedError).toBeInstanceOf(ProtocolError);
  });

  it("requires exactly one room identifier", async () => {
    const fake = new FakeSocket();
    const client = new GameRoomsSocketClient({
      wsUrl: "wss://example.test/socket",
      webSocketFactory: () => fake
    });

    await expect(client.connect({ role: "host" })).rejects.toBeInstanceOf(ProtocolError);
    await expect(client.connect({ role: "host", roomCode: "ABCD", roomId: "room-1" })).rejects.toBeInstanceOf(ProtocolError);
  });

  it("rejects connect when socket closes before open", async () => {
    const fake = new FakeSocket();
    const client = new GameRoomsSocketClient({
      wsUrl: "wss://example.test/socket",
      webSocketFactory: () => fake
    });

    const connected = client.connect({ role: "host", roomCode: "ABCD" });
    fake.close(1006, "closed");

    await expect(connected).rejects.toBeInstanceOf(ProtocolError);
  });

  it("rejects connect when close() is called before open", async () => {
    const fake = new FakeSocket();
    fake.readyState = 0;
    const client = new GameRoomsSocketClient({
      wsUrl: "wss://example.test/socket",
      webSocketFactory: () => fake
    });

    const errors: unknown[] = [];
    client.on("error", (error) => {
      errors.push(error);
    });

    const connected = client.connect({ role: "host", roomCode: "ABCD" });
    client.close(1000, "cancel");

    await expect(connected).rejects.toBeInstanceOf(ProtocolError);
    expect(errors[0]).toBeInstanceOf(ProtocolError);
  });

  it("throws for invalid wsUrl", () => {
    expect(() => {
      new GameRoomsSocketClient({ wsUrl: "/socket" });
    }).toThrow(ProtocolError);
  });

  it("rejects connect when webSocketFactory throws", async () => {
    const client = new GameRoomsSocketClient({
      wsUrl: "wss://example.test/socket",
      webSocketFactory: () => {
        throw new Error("factory failed");
      }
    });

    await expect(client.connect({ role: "host", roomCode: "ABCD" })).rejects.toBeInstanceOf(ProtocolError);
  });
});
