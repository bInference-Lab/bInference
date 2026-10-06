import { createWaiters } from "./waiters.js";

const maxBehind = 1_000;

/**
 * Readings by topic, shared among every watcher of a topic: one subscription per topic, however
 * many watch it. A watcher that falls 1,000 readings behind loses the oldest: the newest reading
 * is what a watcher acts on.
 */
export interface FanOut<Reading> {
  /** Hands a reading to every watcher of its topic now. */
  publish(topic: string, reading: Reading): void;
  /**
   * The topic's readings from now on, in order. The stream rejects with the signal's reason once
   * the signal aborts, and leaves the topic then or when the reader stops early.
   */
  watch(topic: string, signal: AbortSignal): AsyncIterableIterator<Reading>;
  /** How many topics have a watcher now. */
  topics(): number;
}

/** Creates a {@link FanOut} with no watcher yet. */
export function createFanOut<Reading>(): FanOut<Reading> {
  const watchers = new Map<string, Set<(reading: Reading) => void>>();
  const leave = (topic: string, push: (reading: Reading) => void): void => {
    const group = watchers.get(topic);
    group?.delete(push);
    if (group?.size === 0) {
      watchers.delete(topic);
    }
  };
  return {
    publish(topic, reading) {
      for (const push of watchers.get(topic) ?? []) {
        push(reading);
      }
    },
    watch(topic, signal) {
      const queue: Reading[] = [];
      const waiters = createWaiters();
      const push = (reading: Reading): void => {
        queue.push(reading);
        queue.splice(0, queue.length - maxBehind);
        waiters.wake();
      };
      const stop = (): void => leave(topic, push);
      if (!signal.aborted) {
        watchers.set(topic, (watchers.get(topic) ?? new Set()).add(push));
        signal.addEventListener("abort", stop, { once: true });
      }
      const stream: AsyncIterableIterator<Reading> = {
        async next() {
          signal.throwIfAborted();
          const [reading] = queue.splice(0, 1);
          if (reading !== undefined) {
            return { done: false, value: reading };
          }
          await waiters.wait(signal);
          return stream.next();
        },
        async return() {
          stop();
          return await Promise.resolve({ done: true, value: undefined });
        },
        [Symbol.asyncIterator]: () => stream,
      };
      return stream;
    },
    topics: () => watchers.size,
  };
}
