import { describe, expect, it } from "vitest";
import { isAddressHost, isPublicAddress } from "./public-address.js";

describe("isPublicAddress", () => {
  it.each([
    "142.250.74.10",
    "1.1.1.1",
    "8.8.8.8",
    "100.63.255.255",
    "100.128.0.1",
    "172.32.0.1",
    "2a00:1450:4001:82a::200a",
    "[2606:4700:4700::1111]",
    "::ffff:142.250.74.10",
    "2001:4860:4860::8888",
  ])("lets %s through", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    ["loopback", "127.0.0.1"],
    ["loopback anywhere in 127/8", "127.255.10.3"],
    ["this network", "0.0.0.0"],
    ["private 10/8", "10.1.2.3"],
    ["private 172.16/12", "172.31.255.255"],
    ["private 192.168/16", "192.168.1.1"],
    ["link-local and the metadata service", "169.254.169.254"],
    ["carrier-grade NAT and a metadata service", "100.100.100.200"],
    ["IETF assignments and a metadata service", "192.0.0.192"],
    ["documentation", "203.0.113.9"],
    ["benchmarking", "198.18.0.1"],
    ["multicast", "224.0.0.1"],
    ["broadcast", "255.255.255.255"],
    ["IPv6 loopback", "::1"],
    ["IPv6 loopback in brackets", "[::1]"],
    ["IPv6 unspecified", "::"],
    ["IPv6 link-local", "fe80::1"],
    ["IPv6 unique local and a metadata service", "fd00:ec2::254"],
    ["IPv6 multicast", "ff02::1"],
    ["IPv6 site-local", "fec0::1"],
    ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
    ["IPv4-mapped loopback in hex", "::ffff:7f00:1"],
    ["IPv4-mapped private", "::ffff:10.0.0.1"],
    ["IPv4-mapped metadata", "::ffff:169.254.169.254"],
    ["IPv4-compatible loopback", "::127.0.0.1"],
    ["NAT64", "64:ff9b::a00:1"],
    ["6to4", "2002:7f00:1::"],
    ["Teredo", "2001:0:4136:e378:8000:63bf:3fff:fdd2"],
    ["IPv6 documentation", "2001:db8::1"],
    ["IPv6 documentation (RFC 9637)", "3fff::1"],
    ["a name", "localhost"],
    ["an octal-looking part", "0177.0.0.1"],
    ["a zone", "fe80::1%en0"],
    ["too many groups", "1:2:3:4:5:6:7:8:9"],
    ["two gaps", "2001::1::2"],
    ["a part past 255", "256.1.1.1"],
  ])("refuses %s (%s)", (_name, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe("isAddressHost", () => {
  it.each(["1.2.3.4", "[::1]", "::1"])("reads %s as an address", (host) => {
    expect(isAddressHost(host)).toBe(true);
  });

  it.each(["example.com", "1.2.3", "localhost"])("reads %s as a name", (host) => {
    expect(isAddressHost(host)).toBe(false);
  });
});
