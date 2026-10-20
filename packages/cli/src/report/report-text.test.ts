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

  it("replaces every URL, so no host, path, query or user name stays", () => {
    const text = redactReportText(
      "rpc https://user:pass@node.ana-private.example:8545/v1/keyed?apikey=abc down",
      places,
    );
    expect(text).toBe(`rpc ${urlMark} down`);
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
  it("keeps only each URL's kind, hides paths and redacts every other string and key", () => {
    const redacted = redactReportJson(
      {
        chains: { rpc: { "eip155:56": { urls: ["https://node.ana-private.example/v1/key"] } } },
        relays: { "eip155:56": ["https://relay.example/send"] },
        remote: { publicUrl: "https://ana-laptop.tail1234.ts.net" },
        models: { providers: { openai: { baseUrl: "https://llm.ana-private.example/v1" } } },
        telegram: { webhookUrl: "https://hooks.ana-private.example/tg" },
        check: [{ endpoint: "https://other.example" }],
        copyTo: "~/backups",
        windows: "C:\\Data\\ana\\backups",
        deny: [`eip155:56/erc20:${address}`],
        [address]: true,
        port: 7456,
      },
      places,
    );
    expect(redacted).toStrictEqual({
      chains: { rpc: { "eip155:56": { urls: ["[url:rpc]"] } } },
      relays: { "eip155:56": ["[url:relay]"] },
      remote: { publicUrl: "[url:public_address]" },
      models: { providers: { openai: { baseUrl: "[url:model_provider]" } } },
      telegram: { webhookUrl: "[url:webhook]" },
      check: [{ endpoint: urlMark }],
      copyTo: pathMark,
      windows: pathMark,
      deny: ["eip155:56/erc20:0x3043…DBcB"],
      "0x3043…DBcB": true,
      port: 7456,
    });
  });
});
