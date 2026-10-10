const headLength = 6;
const tailLength = 4;

/**
 * The address of a CAIP-10 account or the reference of a CAIP-19 asset: the part after the last
 * colon, as the chain family writes it.
 */
export function addressPartOf(ref: string): string {
  return ref.slice(ref.lastIndexOf(":") + 1);
}

/** An address as a card shows it, `0x1234…abcd`: its first 6 and last 4 characters. */
export function shortAddress(address: string): string {
  return address.length <= headLength + tailLength + 2
    ? address
    : `${address.slice(0, headLength)}…${address.slice(-tailLength)}`;
}
