import { describe, expect, it } from "vitest";
import { GameRoomsError, GameRoomsHttpClient, RoomFullError, RoomLockedError, RoomNotFoundError } from "../src";

describe("GameRoomsHttpClient", () => {
  it("creates a room", async () => {
    const client = new GameRoomsHttpClient({
      baseUrl: "https://example.test",
      fetch: async (_url, init) => {
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({ roomId: "r1", code: "ABCD" }), { status: 200 });
      }
    });

    const room = await client.createRoom({ appId: "draw" });
    expect(room.code).toBe("ABCD");
  });

  it("maps 404 to RoomNotFoundError", async () => {
    const client = new GameRoomsHttpClient({
      baseUrl: "https://example.test",
      fetch: async () => new Response(JSON.stringify({ message: "missing" }), { status: 404 })
    });

    await expect(client.lookupRoom("WXYZ")).rejects.toBeInstanceOf(RoomNotFoundError);
  });

  it("maps 423 to RoomLockedError", async () => {
    const client = new GameRoomsHttpClient({
      baseUrl: "https://example.test",
      fetch: async () => new Response(JSON.stringify({ message: "locked" }), { status: 423 })
    });

    await expect(client.lookupRoom("WXYZ")).rejects.toBeInstanceOf(RoomLockedError);
  });

  it("maps 409 to RoomFullError", async () => {
    const client = new GameRoomsHttpClient({
      baseUrl: "https://example.test",
      fetch: async () => new Response(JSON.stringify({ message: "full" }), { status: 409 })
    });

    await expect(client.lookupRoom("WXYZ")).rejects.toBeInstanceOf(RoomFullError);
  });

  it("throws if no fetch implementation is available", () => {
    const previousFetch = (globalThis as { fetch?: typeof fetch }).fetch;
    delete (globalThis as { fetch?: typeof fetch }).fetch;

    try {
      expect(() => {
        new GameRoomsHttpClient({ baseUrl: "https://example.test" });
      }).toThrow(GameRoomsError);
    } finally {
      (globalThis as { fetch?: typeof fetch }).fetch = previousFetch;
    }
  });

  it("throws for invalid baseUrl", () => {
    expect(() => {
      new GameRoomsHttpClient({ baseUrl: "/api", fetch: async () => new Response("{}") });
    }).toThrow(GameRoomsError);
  });
});
