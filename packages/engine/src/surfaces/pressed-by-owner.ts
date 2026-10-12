/** Reads the owner's numeric Telegram id, or `undefined` before the owner pairs. */
export type OwnerIdOf = (options: { readonly signal: AbortSignal }) => Promise<number | undefined>;

/**
 * Whether a button press came from the owner's numeric Telegram id: never before the owner pairs.
 * Rejects with the signal's reason once it aborts.
 */
export async function pressedByOwner(
  ownerId: OwnerIdOf,
  presserId: number,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  const owner = await ownerId({ signal });
  return owner !== undefined && owner === presserId;
}
