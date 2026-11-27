import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { gzipCopy } from "../precompress-plugin";

describe("precompress", () => {
  it("writes a gzip copy whose header holds no time and no system, so every machine writes the same bytes", () => {
    const text = new TextEncoder().encode("<p>binference</p>\n".repeat(200));
    const gzip = gzipCopy(text);
    // RFC 1952: magic, deflate, no flags, a zero time, best compression, an unknown system.
    expect([...gzip.subarray(0, 10)]).toStrictEqual([
      0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0xff,
    ]);
    expect(new Uint8Array(gunzipSync(gzip))).toStrictEqual(text);
  });
});
