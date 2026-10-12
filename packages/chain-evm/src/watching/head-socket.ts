/** A message a head socket received. */
export interface HeadSocketMessage {
  readonly data: string | object;
}

/** The socket events the block source listens to. */
export interface HeadSocketEvents {
  readonly open: object;
  readonly message: HeadSocketMessage;
  readonly close: object;
  readonly error: object;
}

/**
 * The part of the standard WebSocket a subscription to new blocks uses. The global `WebSocket` of
 * Node fits it, so a factory can return `new WebSocket(url)` with no wrapper.
 */
export interface HeadSocket {
  /** 1 while open, as the WebSocket standard numbers its states. */
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener<K extends keyof HeadSocketEvents>(
    type: K,
    listener: (event: HeadSocketEvents[K]) => void,
  ): void;
}

/** Opens a socket to a WebSocket endpoint; the URL may carry a key, so nothing logs it. */
export type HeadSocketFactory = (url: string) => HeadSocket;

/** An endpoint that pushes new block headers over WebSocket. */
export interface HeadSubscription {
  /** The `wss:` URL, which may carry a provider's key. */
  readonly url: string;
  readonly open: HeadSocketFactory;
  /**
   * How long the socket may go without a new head, or take to subscribe, before the source counts
   * it as dead and polls instead.
   */
  readonly headTimeoutMs: number;
  /** How long the source polls after the socket died before it opens a new one. */
  readonly restMs: number;
}
