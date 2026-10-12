// IP addresses as the guard reads them: text to bytes, with no lookup. Only the canonical forms a
// resolver or a parsed URL gives are read. A form with a leading zero, which some resolvers read as
// octal, or an IPv6 zone is not read at all, so it never counts as public.

const ipv4Part = /^(?:0|[1-9]\d{0,2})$/;
const ipv6Group = /^[\da-f]{1,4}$/i;

/** The 4 bytes of a dotted IPv4 address, or none when the text is not one. */
export function ipv4Bytes(text: string): Uint8Array | undefined {
  const parts = text.split(".");
  if (parts.length !== 4 || !parts.every((part) => ipv4Part.test(part))) {
    return undefined;
  }
  const values = parts.map(Number);
  return values.every((value) => value <= 255) ? Uint8Array.from(values) : undefined;
}

// Hex groups, each 16 bits; an empty side of `::` has none.
function hexGroups(side: string): number[] | undefined {
  if (side === "") {
    return [];
  }
  const texts = side.split(":");
  return texts.every((group) => ipv6Group.test(group))
    ? texts.map((group) => Number.parseInt(group, 16))
    : undefined;
}

// The groups of the right side of an IPv6 address, whose last part may be a dotted IPv4 address.
function tailGroups(side: string): number[] | undefined {
  const cut = side.lastIndexOf(":");
  const last = side.slice(cut + 1);
  if (!last.includes(".")) {
    return hexGroups(side);
  }
  const ipv4 = ipv4Bytes(last);
  const head = hexGroups(cut < 0 ? "" : side.slice(0, cut));
  if (ipv4 === undefined || head === undefined) {
    return undefined;
  }
  const [a = 0, b = 0, c = 0, d = 0] = ipv4;
  return [...head, (a << 8) | b, (c << 8) | d];
}

function bytesOfGroups(groups: readonly number[]): Uint8Array {
  return Uint8Array.from(groups.flatMap((group) => [group >> 8, group & 0xff]));
}

// The 8 groups of an address written with `::`, which stands for at least one zero group.
function joinedGroups(left: string, right: string): number[] | undefined {
  const head = hexGroups(left);
  const tail = tailGroups(right);
  if (head === undefined || tail === undefined || head.length + tail.length > 7) {
    return undefined;
  }
  return [...head, ...Array.from({ length: 8 - head.length - tail.length }, () => 0), ...tail];
}

/** The 16 bytes of an IPv6 address, with or without its brackets, or none when it is not one. */
export function ipv6Bytes(text: string): Uint8Array | undefined {
  const bare = text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text;
  if (!bare.includes(":")) {
    return undefined;
  }
  const halves = bare.split("::");
  const groups =
    halves.length === 2 ? joinedGroups(halves[0] ?? "", halves[1] ?? "") : tailGroups(bare);
  return halves.length <= 2 && groups?.length === 8 ? bytesOfGroups(groups) : undefined;
}
