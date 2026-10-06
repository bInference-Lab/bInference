/** The socket opened. */
export interface SocketOpen {
  readonly type: string;
}

/** A message arrived; every protocol frame is text. */
export interface SocketMessage {
  readonly data: string | object;
}

/** The socket closed, with the WebSocket close code and reason. */
export interface SocketClose {
  readonly code: number;
  readonly reason: string;
}

/** The socket events the client listens to. */
export interface SocketEvents {
  readonly open: SocketOpen;
  readonly message: SocketMessage;
  readonly close: SocketClose;
}

/**
 * The part of the standard WebSocket the client uses. The global `WebSocket` of browsers and
 * Node fits it, so a factory can return `new WebSocket(url)` with no wrapper.
 */
export interface ProtocolSocket {
  /** 1 while open, as the WebSocket standard numbers its states. */
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener<K extends keyof SocketEvents>(
    type: K,
    listener: (event: SocketEvents[K]) => void,
  ): void;
}

/** Opens a new socket to the engine for each connection attempt. */
export type SocketFactory = () => ProtocolSocket;
