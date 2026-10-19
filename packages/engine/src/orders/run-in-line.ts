/**
 * Runs `work` once every earlier work of the same line has ended, whether it ended well or not,
 * and answers what it answered. `lines` holds the tail of each line while work waits in it, and
 * forgets a line once its last work ended.
 */
export async function runInLine<Key, Output>(
  lines: Map<Key, Promise<void>>,
  key: Key,
  work: () => Promise<Output>,
): Promise<Output> {
  const before = lines.get(key) ?? Promise.resolve();
  const run = before.then(work, work);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  lines.set(key, tail);
  try {
    return await run;
  } finally {
    if (lines.get(key) === tail) {
      lines.delete(key);
    }
  }
}
