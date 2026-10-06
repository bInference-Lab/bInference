import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { sha256Hex } from "@binference/engine";
import { createMemoryAccessStore } from "@binference/engine/testing";
import { describe, expect, it } from "vitest";
import { issueStartCode, startCodeHash, startCodeIn, startCodeLifetimeMs } from "./start-code.js";

const live = { signal: new AbortController().signal };

function codeIn(link: URL): string {
  return link.searchParams.get("start") ?? "";
}

describe("start codes", () => {
  it("issues a single-use deep link and stores only the code's hash with its expiry", async () => {
    const access = createMemoryAccessStore();
    const clock = createManualClock(1_000);
    const options = { access, clock, random: createSeededRandom(9), botUsername: "binference_bot" };
    const issued = await issueStartCode(options, live);
    const link = new URL(issued.link.reveal());
    const code = codeIn(link);
    expect(`${link.origin}${link.pathname}`).toBe("https://t.me/binference_bot");
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(String(issued.link)).not.toContain(code);
    expect(issued.expiresAtMs).toBe(1_000 + startCodeLifetimeMs);
    const use = { codeHash: startCodeHash(code), atMs: 2_000 };
    expect(await access.usePairCode(use, live)).toMatchObject({ ok: true });
    expect(await access.usePairCode(use, live)).toStrictEqual({ ok: false, error: "used" });
  });

  it("hashes a start code apart from a console pairing code", () => {
    expect(startCodeHash("abc")).not.toBe(sha256Hex("abc"));
  });

  it("refuses a malformed username and a code that collides", async () => {
    const access = createMemoryAccessStore();
    const options = { access, clock: createManualClock(1), random: createSeededRandom(1) };
    await expect(issueStartCode({ ...options, botUsername: "@bot" }, live)).rejects.toMatchObject({
      code: "telegram.bad_username",
    });
    await issueStartCode({ ...options, botUsername: "binference_bot" }, live);
    const again = {
      ...options,
      random: createSeededRandom(1),
      botUsername: "binference_bot",
      lifetimeMs: 5,
    };
    await expect(issueStartCode(again, live)).rejects.toMatchObject({
      code: "telegram.start_code_taken",
    });
  });

  it("reads the code of a /start message only", () => {
    expect(startCodeIn("/start abc_DEF-123")).toBe("abc_DEF-123");
    expect(startCodeIn("/start@binference_bot abc ")).toBe("abc");
    expect(startCodeIn("/start")).toBeUndefined();
    expect(startCodeIn("/start a b")).toBeUndefined();
    expect(startCodeIn("please /start abc")).toBeUndefined();
  });
});
