import { describe, expect, it } from "vitest";
import { checkPublicUrl, maxUrlChars } from "./check-url.js";

describe("checkPublicUrl", () => {
  it("answers a public URL without its fragment", () => {
    const checked = JSON.stringify(checkPublicUrl("https://example.com/a/b?c=1#x"));
    expect(checked).toBe('{"ok":true,"value":"https://example.com/a/b?c=1"}');
  });

  it.each(["http://93.184.215.14/", "https://[2606:4700:4700::1111]:8443/x"])(
    "lets a public address through: %s",
    (url) => {
      expect(checkPublicUrl(url).ok).toBe(true);
    },
  );

  it.each([
    ["not a URL", "example.com/page", "not_url"],
    ["too long", `https://example.com/${"a".repeat(maxUrlChars)}`, "not_url"],
    ["a file URL", "file:///etc/passwd", "scheme"],
    ["an FTP URL", "ftp://example.com/", "scheme"],
    ["a data URL", "data:text/html,hi", "scheme"],
    ["a JavaScript URL", "javascript:alert(1)", "scheme"],
    ["a user name", "https://user@example.com/", "credentials"],
    ["a password", "https://user:secret@example.com/", "credentials"],
    ["loopback", "http://127.0.0.1:8080/", "private_host"],
    ["loopback in decimal", "http://2130706433/", "private_host"],
    ["loopback in hex", "http://0x7f.0.0.1/", "private_host"],
    ["loopback in octal", "http://0177.0.0.1/", "private_host"],
    ["loopback in short form", "http://127.1/", "private_host"],
    ["IPv6 loopback", "http://[::1]/", "private_host"],
    ["IPv4-mapped loopback", "http://[::ffff:127.0.0.1]/", "private_host"],
    ["the metadata service", "http://169.254.169.254/latest/meta-data/", "private_host"],
    ["the IPv6 metadata service", "http://[fd00:ec2::254]/", "private_host"],
    ["a private address", "http://192.168.1.1/admin", "private_host"],
    ["unspecified", "http://0.0.0.0/", "private_host"],
    ["localhost", "http://localhost:3000/", "private_host"],
    ["localhost with a dot", "http://localhost./", "private_host"],
    ["a localhost name", "http://app.localhost/", "private_host"],
    ["an mDNS name", "http://printer.local/", "private_host"],
    ["an internal name", "http://metadata.google.internal/", "private_host"],
    ["a home network name", "http://router.home.arpa/", "private_host"],
    ["a single label", "http://intranet/", "private_host"],
  ])("refuses %s", (_name, url, refusal) => {
    expect(checkPublicUrl(url)).toStrictEqual({ ok: false, error: refusal });
  });
});
