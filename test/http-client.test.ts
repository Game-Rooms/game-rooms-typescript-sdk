import { describe, expect, it } from "vitest";
import { GameRoomsHttpClient, RoomLockedError, RoomNotFoundError } from "../src";

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
});
