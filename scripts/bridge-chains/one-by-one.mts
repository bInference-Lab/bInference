/**
 * Runs `step` on each item one after the other, so a public endpoint never sees a burst, and
 * gives the answers in order.
 */
export async function oneByOne<T, R>(
  items: readonly T[],
  step: (item: T) => Promise<R>,
): Promise<R[]> {
  return items.reduce<Promise<R[]>>(
    async (done, item) => [...(await done), await step(item)],
    Promise.resolve([]),
  );
}
