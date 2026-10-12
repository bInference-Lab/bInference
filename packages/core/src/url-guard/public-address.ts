import { ipv4Bytes, ipv6Bytes } from "./ip-address.js";

// Which addresses may belong to a service on the internet. From the IANA special-purpose address
// registries (RFC 6890 and its updates): no private, loopback, link-local, carrier-grade NAT,
// documentation, benchmarking, multicast or reserved address is public, so neither is a hosting
// provider's metadata address (169.254.169.254, fd00:ec2::254, 100.100.100.200, 192.0.0.192). IPv6 is public
// only inside global unicast (2000::/3), less its special blocks; an IPv4-mapped address is judged
// as the IPv4 address it carries, and every other form that carries an IPv4 address (NAT64, 6to4,
// Teredo, the deprecated compatible form) is not public.

type Block = readonly [prefix: readonly number[], bits: number];

const ipv4Blocks: readonly Block[] = [
  [[0], 8],
  [[10], 8],
  [[100, 64], 10],
  [[127], 8],
  [[169, 254], 16],
  [[172, 16], 12],
  [[192, 0, 0], 24],
  [[192, 0, 2], 24],
  [[192, 88, 99], 24],
  [[192, 168], 16],
  [[198, 18], 15],
  [[198, 51, 100], 24],
  [[203, 0, 113], 24],
  [[224], 4],
  [[240], 4],
];

const ipv6GlobalUnicast: Block = [[0x20], 3];

const ipv6Blocks: readonly Block[] = [
  // IETF protocol assignments, Teredo among them.
  [[0x20, 0x01, 0x00, 0x00], 23],
  [[0x20, 0x01, 0x0d, 0xb8], 32],
  // 6to4.
  [[0x20, 0x02], 16],
  // Documentation (RFC 9637).
  [[0x3f, 0xff, 0x00], 20],
];

// ::ffff:0:0/96: the IPv4-mapped form, judged by the IPv4 address in its last 4 bytes.
const mappedPrefix: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff];

function inBlock(bytes: Readonly<Uint8Array>, [prefix, bits]: Block): boolean {
  for (let bit = 0; bit < bits; bit += 8) {
    const width = Math.min(8, bits - bit);
    const mask = (0xff << (8 - width)) & 0xff;
    const index = bit / 8;
    if (((bytes[index] ?? 0) & mask) !== ((prefix[index] ?? 0) & mask)) {
      return false;
    }
  }
  return true;
}

function isPublicIpv4(bytes: Readonly<Uint8Array>): boolean {
  return !ipv4Blocks.some((block) => inBlock(bytes, block));
}

function isPublicIpv6(bytes: Readonly<Uint8Array>): boolean {
  if (mappedPrefix.every((value, index) => bytes[index] === value)) {
    return isPublicIpv4(bytes.slice(12));
  }
  return inBlock(bytes, ipv6GlobalUnicast) && !ipv6Blocks.some((block) => inBlock(bytes, block));
}

/**
 * Whether an IP address may belong to a service on the internet: not private, loopback,
 * link-local, multicast, unspecified, reserved or set aside for documentation, and no hosting
 * provider's metadata address. An IPv6 address may carry its brackets. Text that is not an IP address in its
 * usual form is not public.
 */
export function isPublicAddress(address: string): boolean {
  const ipv4 = ipv4Bytes(address);
  if (ipv4 !== undefined) {
    return isPublicIpv4(ipv4);
  }
  const ipv6 = ipv6Bytes(address);
  return ipv6 !== undefined && isPublicIpv6(ipv6);
}

/** Whether a URL's host names an IP address, IPv4 or bracketed IPv6, rather than a name. */
export function isAddressHost(host: string): boolean {
  return ipv4Bytes(host) !== undefined || ipv6Bytes(host) !== undefined;
}
