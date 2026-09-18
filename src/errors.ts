export class GameRoomsError extends Error {
  public readonly status?: number;
  public readonly code?: string;
  public readonly details?: unknown;

  constructor(message: string, options?: { status?: number; code?: string; details?: unknown }) {
    super(message);
    this.name = this.constructor.name;
    this.status = options?.status;
    this.code = options?.code;
    this.details = options?.details;
  }
}

export class RoomNotFoundError extends GameRoomsError {}
export class RoomLockedError extends GameRoomsError {}
export class RoomFullError extends GameRoomsError {}
export class ProtocolError extends GameRoomsError {}
