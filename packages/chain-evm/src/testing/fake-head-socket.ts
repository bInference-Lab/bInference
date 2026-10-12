import type { HeadSocket, HeadSocketEvents } from "../watching/head-socket.js";

/** A head socket a test drives: it opens, receives, fails and records what it sent. */
interface FakeHeadSocket extends HeadSocket {
  readonly url: string;
  /** Every message sent on the socket, oldest first. */
  sent(): readonly string[];
  /** Opens the socket, as a server's handshake does. */
  accept(): void;
  /** Delivers a message from the server. */
  receive(text: string): void;
  /** Drops the connection, as a server that goes away does. */
  drop(): void;
  /** Whether the client closed it. */
  isClosed(): boolean;
}

/** Opens fake head sockets and keeps each one it opened. */
export interface FakeHeadSockets {
  readonly open: (url: string) => FakeHeadSocket;
  /** The sockets opened so far, oldest first. */
  opened(): readonly FakeHeadSocket[];
}

type Listeners = { [K in keyof HeadSocketEvents]: ((event: HeadSocketEvents[K]) => void)[] };

function createFakeHeadSocket(url: string): FakeHeadSocket {
  const listeners: Listeners = { open: [], message: [], close: [], error: [] };
  const sent: string[] = [];
  const state = { readyState: 0, isClosed: false };
  return {
    url,
    get readyState() {
      return state.readyState;
    },
    send: (data) => {
      sent.push(data);
    },
    close: () => {
      state.isClosed = true;
      state.readyState = 3;
    },
    addEventListener(type, listener) {
      listeners[type].push(listener);
    },
    sent: () => [...sent],
    accept: () => {
      state.readyState = 1;
      listeners.open.forEach((listener) => listener({}));
    },
    receive: (text) => listeners.message.forEach((listener) => listener({ data: text })),
    drop: () => {
      state.readyState = 3;
      listeners.close.forEach((listener) => listener({}));
    },
    isClosed: () => state.isClosed,
  };
}

/** Creates a factory of fake head sockets for tests. */
export function createFakeHeadSockets(): FakeHeadSockets {
  const opened: FakeHeadSocket[] = [];
  return {
    open: (url) => {
      const socket = createFakeHeadSocket(url);
      opened.push(socket);
      return socket;
    },
    opened: () => [...opened],
  };
}
