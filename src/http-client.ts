import { GameRoomsError, RoomFullError, RoomLockedError, RoomNotFoundError } from "./errors";
import type { AppConfigResponse, CreateRoomRequest, CreateRoomResponse, HttpClientOptions, RoomLookupResponse } from "./types";

export class GameRoomsHttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  async createRoom(request: CreateRoomRequest): Promise<CreateRoomResponse> {
    return this.request<CreateRoomResponse>("POST", "/rooms", request);
  }

  async getAppConfig(appId: string): Promise<AppConfigResponse> {
    return this.request<AppConfigResponse>("GET", `/apps/${encodeURIComponent(appId)}/config`);
  }

  async lookupRoom(code: string): Promise<RoomLookupResponse> {
    return this.request<RoomLookupResponse>("GET", `/rooms/code/${encodeURIComponent(code)}`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const hasBody = body !== undefined;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: hasBody ? { "content-type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(body) : undefined
    });

    const payload = await this.readJson(response);

    if (!response.ok) {
      const message = this.readMessage(payload) ?? `${method} ${path} failed with ${response.status}`;
      if (response.status === 404) {
        throw new RoomNotFoundError(message, { status: 404, details: payload });
      }

      if (response.status === 423) {
        throw new RoomLockedError(message, { status: 423, details: payload });
      }

      if (response.status === 409) {
        throw new RoomFullError(message, { status: 409, details: payload });
      }

      throw new GameRoomsError(message, { status: response.status, details: payload });
    }

    return payload as T;
  }

  private async readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { message: text };
    }
  }

  private readMessage(payload: unknown): string | undefined {
    if (!payload || typeof payload !== "object") {
      return undefined;
    }

    const candidate = (payload as { message?: unknown; error?: unknown }).message ??
      (payload as { message?: unknown; error?: unknown }).error;

    return typeof candidate === "string" ? candidate : undefined;
  }
}
