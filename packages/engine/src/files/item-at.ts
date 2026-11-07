/**
 * The item at a place in a list, or `fallback` past its ends: for the file code's reads by index,
 * where the place is known to be inside the list and a miss would only read as empty.
 */
export function itemAt<T>(items: readonly T[], at: number, fallback: T): T {
  return items[at] ?? fallback;
}
