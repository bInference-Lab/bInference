import { BinferenceError } from "@binference/core";
import { type ClientFrame, decodeClientFrame, type EngineFrame } from "@binference/protocol";
import type { ProtocolSocket, SocketEvents, SocketFactory } from "./protocol-socket.js";

/** The engine's end of one fake socket, for tests. Events fire at once, in call order. */
interface FakeSocket extends ProtocolSocket {
  /** Every frame the client sent, decoded, oldest first. */
  sent(): readonly ClientFrame[];
  /** Opens the socket, so the client sends `open`. */
  accept(): void;
  /** Sends a frame to the client. */
  deliver(frame: EngineFrame): void;
  /** Sends raw text to the client. */
  deliverText(text: string): void;
  /** Closes the socket from the engine's side, as a dropped network does. */
  drop(code?: number): void;
}

/** A fake engine that hands the client one fake socket per connection attempt. */
export interface FakeEngine {
  readonly openSocket: SocketFactory;
  /** Every socket the client opened, oldest first. */
  sockets(): readonly FakeSocket[];
  /** The newest socket; throws when the client opened none. */
  latest(): FakeSocket;
}

type Listeners = { [K in keyof SocketEvents]: ((event: SocketEvents[K]) => void)[] };

const connectingState = 0;
const openState = 1;
const closedState = 3;
// The WebSocket close code for a connection lost without a close frame.
const abnormalClosure = 1006;

function createFakeSocket(): FakeSocket {
  const listeners: Listeners = { open: [], message: [], close: [] };
  const sent: ClientFrame[] = [];
  let state = connectingState;
  const close = (code: number, reason: string): void => {
    if (state === closedState) {
      return;
    }
    state = closedState;
    listeners.close.forEach((listener) => listener({ code, reason }));
  };
  const deliverText = (text: string): void => {
    listeners.message.forEach((listener) => listener({ data: text }));
  };
  return {
    get readyState() {
      return state;
    },
    send(data) {
      const decoded = decodeClientFrame(data);
      if (!decoded.ok) {
        throw new BinferenceError({ code: decoded.error, message: "The client sent a bad frame." });
      }
      sent.push(decoded.value);
    },
    close: (code = 1000, reason = "") => close(code, reason),
    addEventListener(type, listener) {
      listeners[type].push(listener);
    },
    sent: () => [...sent],
    accept() {
      state = openState;
      listeners.open.forEach((listener) => listener({ type: "open" }));
    },
    deliver: (frame) => deliverText(JSON.stringify(frame)),
    deliverText,
    drop: (code = abnormalClosure) => close(code, ""),
  };
}

/** Creates a {@link FakeEngine}. */
export function createFakeEngine(): FakeEngine {
  const sockets: FakeSocket[] = [];
  return {
    openSocket: () => {
      const socket = createFakeSocket();
      sockets.push(socket);
      return socket;
    },
    sockets: () => [...sockets],
    latest() {
      const socket = sockets.at(-1);
      if (socket === undefined) {
        throw new BinferenceError({ code: "client.no_socket", message: "No socket is open." });
      }
      return socket;
    },
  };
}
