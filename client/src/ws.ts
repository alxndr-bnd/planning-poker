import { WS_PATH, type ClientMessage, type ServerMessage } from "@pp/shared";

type Handler = (msg: ServerMessage) => void;

/**
 * Thin WebSocket client with auto-reconnect. On (re)connect it calls `onOpen`
 * so the caller can re-send `join` — this is how we heal after Cloud Run's
 * ~60-min socket timeout or any transient drop.
 */
export class PokerSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private handler: Handler;
  private onOpen: () => void;
  private closedByUser = false;
  private backoff = 500;

  constructor(handler: Handler, onOpen: () => void) {
    this.handler = handler;
    this.onOpen = onOpen;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.url = `${proto}://${location.host}${WS_PATH}`;
  }

  connect() {
    this.closedByUser = false;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 500;
      this.onOpen();
    };
    ws.onmessage = (ev) => {
      try {
        this.handler(JSON.parse(ev.data) as ServerMessage);
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      if (this.closedByUser) return;
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 5000);
    };
  }

  send(msg: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close() {
    this.closedByUser = true;
    this.ws?.close();
  }
}

/** Generate an unguessable, URL-safe room id (matches server ROOM_ID_RE). */
export function newRoomId(len = 10): string {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
