import { idSchema } from "@binference/core";
import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { createMemoryAccessStore } from "../fakes/memory-access-store.js";
import { testNowMs } from "../intents/test-intents.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { sha256Hex } from "../records/sha256-hex.js";
import { type AuthLockout, createLockoutNotices, lockoutNoticeKey } from "./lockout-notice.js";

const live = { signal: new AbortController().signal };
const untilMs = testNowMs + 5 * 60_000;
const deviceId = idSchema("dev").parse("dev_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const secret = `bnt_${"s".repeat(43)}`;

async function noticesOf(lockout: AuthLockout, access = createMemoryAccessStore()) {
  await access.addDevice(
    { id: deviceId, label: "Laptop", alg: "ed25519", publicKey: "key", createdAtMs: testNowMs },
    live,
  );
  await access.addToken(
    {
      id: idSchema("tok").parse("tok_0190f1c2-3a4b-7c5d-8e6f-000000000002"),
      label: "mcp-codex-session",
      kind: "mcp",
      scopes: ["read", "propose"],
      secretHash: sha256Hex(secret),
      createdAtMs: testNowMs,
    },
    live,
  );
  return new Promise<readonly EnginePush[]>((resolve) => {
    const notify = createLockoutNotices({ access, publish: (push) => resolve([push]) });
    notify({ ...lockout, untilMs });
  });
}

function noticeOf(values: Readonly<Record<string, string>>): readonly EnginePush[] {
  const data = { key: lockoutNoticeKey, values, times: { until: untilMs } };
  return [{ topic: "notice", kind: "notice/new", data }];
}

describe("the lockout notice", () => {
  it.each([
    [
      { kind: "address", address: "203.0.113.7" },
      { what: "address", name: "203.0.113.7" },
    ],
    [{ kind: "local" }, { what: "local", name: "" }],
    [{ kind: "mini_app" }, { what: "miniApp", name: "" }],
    [
      { kind: "device", device: deviceId },
      { what: "device", name: "Laptop" },
    ],
    [
      { kind: "token", secretHash: sha256Hex(secret) },
      { what: "token", name: "mcp-codex-session" },
    ],
    [
      { kind: "device", device: "dev_not-an-id" },
      { what: "unknown", name: "" },
    ],
    [
      { kind: "token", secretHash: sha256Hex("bnt_other") },
      { what: "unknown", name: "" },
    ],
  ] as const)("names %j by its address or label", async (lockout, values) => {
    await expect(noticesOf(lockout)).resolves.toStrictEqual(noticeOf(values));
  });

  it("still tells the owner when the store fails, naming the credential as unknown", async () => {
    const access = createMemoryAccessStore();
    const failing = {
      ...access,
      findDevice: async () => Promise.reject(new Error("The store is down.")),
    };
    const pushes = await noticesOf({ kind: "device", device: deviceId }, failing);
    expect(pushes).toStrictEqual(noticeOf({ what: "unknown", name: "" }));
  });

  it("says in English what is locked and until when, never a secret", () => {
    const english = createFormatter({ locale: "en", timeZone: "UTC" });
    const token = { what: "token", name: "mcp-codex-session", until: "21:05" };
    const address = { what: "address", name: "203.0.113.7", until: "21:05" };
    expect(english.message(lockoutNoticeKey, token)).toBe(
      "⚠️ Too many failed attempts to sign in with the client token mcp-codex-session, so binference refuses them until 21:05. None of them signed in.",
    );
    expect(english.message(lockoutNoticeKey, address)).toBe(
      "⚠️ Too many failed attempts to sign in from 203.0.113.7, so binference refuses them until 21:05. None of them signed in.",
    );
  });
});
