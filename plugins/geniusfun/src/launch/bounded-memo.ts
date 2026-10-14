/** A memo of facts that never change once read, which keeps at most a set number of entries. */
export interface BoundedMemo<K, V> {
  /** The value kept for the key, or `undefined`. */
  get(key: K): V | undefined;
  /** Keeps a value; once the memo is full, the entry kept longest is dropped to make room. */
  set(key: K, value: V): void;
}

/**
 * Creates a {@link BoundedMemo} of at most `size` entries. A full memo drops its oldest entry for
 * each new one, so a long-running engine holds a fixed number of entries whatever it reads.
 */
export function createBoundedMemo<K, V>(size: number): BoundedMemo<K, V> {
  const entries = new Map<K, V>();
  return {
    get: (key) => entries.get(key),
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      const [oldest] = entries.keys();
      if (entries.size > size && oldest !== undefined) {
        entries.delete(oldest);
      }
    },
  };
}
