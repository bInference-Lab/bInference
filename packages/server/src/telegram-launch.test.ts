import { createSecret } from "@binference/core";
import { describe, expect, it } from "vitest";
import { checkTelegramLaunch, telegramLaunchHash } from "./telegram-launch.js";

const botToken = createSecret("7012345678:AAE_fakeTokenForTestsOnly_0123456789ab");
const user = '{"id":279058397,"first_name":"Ada","username":"ada_l","language_code":"en"}';
const authDateMs = 1_760_000_000_000;
const maxAgeMs = 5 * 60_000;
const maxAheadMs = 60_000;

// Known answers: each hash computed apart from this code, from Telegram's documented rule, for
// the fields below and the test bot token.
const plain = {
  fields: [
    ["query_id", "AAHdF6IQAAAAAN0XohDhrOrc"],
    ["user", user],
    ["auth_date", "1760000000"],
  ],
  hash: "8a779c84045cefb080208ad3c56ab151842d603a3e82fcba3a0e7eb9fb5cd2b5",
} as const;
const withSignature = {
  fields: [
    ...plain.fields,
    [
      "signature",
      "6fbdaFHsvd0lC9TGP7Pkq8CRrX3ODY-ODjkY3mEuFNw4IFvM1WbmdaJpIyX1H-Oadqmg7dnbV0ICT3Q-bUfqBQ",
    ],
    ["chat_instance", "-3788475317572404878"],
    ["chat_type", "private"],
  ],
  hash: "ec341b48473b5d0b0b45504258a4addcbbc97753951a0b68c0b2070b88145007",
} as const;

// Fields as a query string, each part encoded as a browser encodes it.
function queryOf(fields: readonly (readonly [string, string])[]): string {
  return fields.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
}

function initDataOf(fields: readonly (readonly [string, string])[], hash: string): string {
  return queryOf([...fields, ["hash", hash]]);
}

function check(initData: string, nowMs = authDateMs + 60_000) {
  return checkTelegramLaunch({ initData, botToken, nowMs, maxAgeMs, maxAheadMs });
}

describe("checkTelegramLaunch", () => {
  it.each([
    ["the plain fields", plain],
    ["the fields with Telegram's signature field", withSignature],
  ])("computes the known hash of %s", (_name, vector) => {
    expect(telegramLaunchHash(new Map(vector.fields), botToken)).toBe(vector.hash);
  });

  it("accepts a launch Telegram signed and reads its user and time", () => {
    expect(check(initDataOf(withSignature.fields, withSignature.hash))).toStrictEqual({
      ok: true,
      value: { hash: withSignature.hash, userId: 279_058_397, authDateMs },
    });
  });

  it("accepts the fields in any order, as the hash covers them sorted", () => {
    const reversed = [...plain.fields].toReversed();
    expect(check(initDataOf(reversed, plain.hash)).ok).toBe(true);
  });

  it.each([
    [
      "a changed user",
      [plain.fields[0], ["user", user.replace("279058397", "279058398")], plain.fields[2]],
    ],
    ["a changed time", [plain.fields[0], plain.fields[1], ["auth_date", "1760000001"]]],
    ["an added field", [...plain.fields, ["start_param", "x"]]],
    ["a dropped field", [plain.fields[1], plain.fields[2]]],
  ] as const)("refuses %s as forged", (_name, fields) => {
    expect(check(initDataOf(fields, plain.hash))).toStrictEqual({ ok: false, error: "forged" });
  });

  it("refuses a launch signed with another bot's token", () => {
    const other = createSecret("7012345679:AAE_anotherFakeTokenForTests_0123456789");
    const hash = telegramLaunchHash(new Map(plain.fields), other);
    expect(check(initDataOf(plain.fields, hash))).toStrictEqual({ ok: false, error: "forged" });
  });

  it.each([
    ["no hash", queryOf(plain.fields)],
    ["an uppercase hash", initDataOf(plain.fields, plain.hash.toUpperCase())],
    ["a short hash", initDataOf(plain.fields, plain.hash.slice(2))],
  ])("refuses %s as forged", (_name, initData) => {
    expect(check(initData)).toStrictEqual({ ok: false, error: "forged" });
  });

  it("refuses a field that comes twice, even when one copy carries the signed value", () => {
    const initData = `${initDataOf(plain.fields, plain.hash)}&user=${encodeURIComponent(user)}`;
    expect(check(initData)).toStrictEqual({ ok: false, error: "malformed" });
  });

  it.each([
    ["without a user", [plain.fields[0], plain.fields[2]]],
    ["with a user that is not JSON", [plain.fields[0], ["user", "ada"], plain.fields[2]]],
    ["with a user id as text", [plain.fields[0], ["user", '{"id":"279058397"}'], plain.fields[2]]],
    ["without a time", [plain.fields[0], plain.fields[1]]],
    [
      "with a time that is not whole seconds",
      [plain.fields[0], plain.fields[1], ["auth_date", "1.7e9"]],
    ],
  ] as const)("refuses a signed launch %s as malformed", (_name, fields) => {
    const hash = telegramLaunchHash(new Map(fields), botToken);
    expect(check(initDataOf(fields, hash))).toStrictEqual({ ok: false, error: "malformed" });
  });

  it("accepts a launch up to 5 minutes old, and refuses it past that", () => {
    const initData = initDataOf(plain.fields, plain.hash);
    expect([
      check(initData, authDateMs).ok,
      check(initData, authDateMs + maxAgeMs).ok,
      check(initData, authDateMs + maxAgeMs + 1),
    ]).toStrictEqual([true, true, { ok: false, error: "stale" }]);
  });

  it("accepts a launch up to 1 minute ahead of the clock, and refuses it past that", () => {
    const initData = initDataOf(plain.fields, plain.hash);
    expect([
      check(initData, authDateMs - maxAheadMs).ok,
      check(initData, authDateMs - maxAheadMs - 1),
      check(initData, authDateMs - maxAgeMs),
    ]).toStrictEqual([true, { ok: false, error: "stale" }, { ok: false, error: "stale" }]);
  });
});
