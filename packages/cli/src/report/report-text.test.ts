import { describe, expect, it } from "vitest";
import { pathMark, redactReportJson } from "./report-json.js";
import { redactReportText, urlMark } from "./report-text.js";

const places = { home: "/srv/ana" };
const address = "0x30435f9D276c6BC54F56161Fb3dFB7bDC2a8DBcB";

describe("redactReportText", () => {
  it.each([
    ["a private key", `0x${"ab".repeat(32)}`],
    ["a bot token", "7012345678:AAH4kLz9_Qw-ErTy7uIoP1aSdFgHjKlZx"],
    ["a client token", "bnt_Q2xpZW50VG9rZW5Gb3JUZXN0cw"],
    ["an owner key code", "bnok1abcde fghij klmno pqrst"],
    ["an API key", "sk-proj-4f9Qx2LmZ8vR1tY6uI0oP3aS"],
    ["a base64 key", "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg"],
  ])("masks %s", (_kind, secret) => {
    const text = redactReportText(`before ${secret} after`, places);
    expect(text).not.toContain(secret);
    expect(text).toMatch(/^before \[redacted\]/);
  });

  it("cuts an address to its short form", () => {
    expect(redactReportText(`sent to ${address}`, places)).toBe("sent to 0x3043…DBcB");
  });

  it("keeps only a URL's origin, so no path, query or user name carries a key", () => {
    const text = redactReportText(
      "rpc https://user:pass@bsc.example.com:8545/v1/keyed?apikey=abc down",
      places,
    );
    expect(text).toBe("rpc https://bsc.example.com:8545 down");
    expect(redactReportText("see http://[bad and file:///etc/key", places)).toBe(
      `see ${urlMark} and ${urlMark}`,
    );
  });

  it("writes the home folder as ~ and keeps binference ids and dotted names", () => {
    const id = "int_0192f3a4-1b2c-7d3e-8f40-123456789abc";
    const text = redactReportText(`/srv/ana/.binference/logs ${id} engine.backup_key_old`, places);
    expect(text).toBe(`~/.binference/logs ${id} engine.backup_key_old`);
  });
});

describe("redactReportJson", () => {
  it("cuts URLs to their origin, hides paths and redacts every other string and key", () => {
    const redacted = redactReportJson(
      {
        urls: ["https://bsc.example.com/v1/4f9Qx2LmZ8vR1tY6uI0oP3aSdF"],
        copyTo: "~/backups",
        windows: "C:\\Data\\ana\\backups",
        deny: [`eip155:56/erc20:${address}`],
        [address]: true,
        port: 7456,
      },
      places,
    );
    expect(redacted).toStrictEqual({
      urls: ["https://bsc.example.com"],
      copyTo: pathMark,
      windows: pathMark,
      deny: ["eip155:56/erc20:0x3043…DBcB"],
      "0x3043…DBcB": true,
      port: 7456,
    });
  });
});
