/** Bytes a test writes in and a reader takes out, in order, as a pipe would carry them. */
export interface ByteChannel extends AsyncIterable<Uint8Array> {
  /** Adds text, encoded as UTF-8; ignored once the channel has ended. */
  push(text: string): void;
  /** Ends the channel: a reader gets what is left, then the end. */
  end(): void;
}

type Waiter = (result: IteratorResult<Uint8Array, undefined>) => void;

/** Creates an empty {@link ByteChannel}; its reads are answered in the order they were asked. */
export function createByteChannel(): ByteChannel {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const waiters: Waiter[] = [];
  const state = { hasEnded: false };
  const done: IteratorResult<Uint8Array, undefined> = { done: true, value: undefined };
  const settle = (): void => {
    while (waiters.length > 0 && (chunks.length > 0 || state.hasEnded)) {
      const chunk = chunks.shift();
      waiters.shift()?.(chunk === undefined ? done : { done: false, value: chunk });
    }
  };
  const iterator: AsyncIterator<Uint8Array, undefined> = {
    next: async () =>
      new Promise((resolve) => {
        waiters.push(resolve);
        settle();
      }),
    return: async () => {
      state.hasEnded = true;
      settle();
      return done;
    },
  };
  return {
    push(text) {
      if (!state.hasEnded) {
        chunks.push(encoder.encode(text));
        settle();
      }
    },
    end() {
      state.hasEnded = true;
      settle();
    },
    [Symbol.asyncIterator]: () => iterator,
  };
}
