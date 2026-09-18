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
    for (const fn of this.listeners.close) {
      fn({ code, reason });
    }
  }

  addEventListener(type: "open" | "close" | "error" | "message", listener: (event?: any) => void): void {
    this.listeners[type].push(listener);
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
});
