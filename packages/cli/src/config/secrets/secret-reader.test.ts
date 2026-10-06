import { join } from "node:path";
import { err, ok } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import type { RunProgram } from "@binference/platform";
import { createMemorySecretStore } from "@binference/platform/testing";
import { describe, expect, it } from "vitest";
import type { ReadTextFile } from "../load-config.js";
import {
  createSecretReader,
  type SecretReader,
  type SecretReaderOptions,
} from "./secret-reader.js";

const token = "7012345678:AAH-token-the-tests-read";
const home = join("/", "home", "owner");
const signal = (): AbortSignal => new AbortController().signal;

const files: ReadTextFile = async (path) =>
  Promise.resolve(
    path === join(home, ".binference", "secrets", "bot") ? ok(`${token}\n`) : err("not_found"),
  );

const blank: RunProgram = async () => Promise.resolve("  \n");

// A program that never prints: it ends only when its signal aborts.
const hanging: RunProgram = async (_file, _args, programSignal) =>
  new Promise((_resolve, reject) => {
    programSignal.addEventListener("abort", () => {
      reject(new Error("killed"));
    });
  });

function reader(more: Partial<SecretReaderOptions> = {}): SecretReader {
  return createSecretReader({
    env: { TELEGRAM_BOT_TOKEN: token, EMPTY: "" },
    keychain: createMemorySecretStore({ "telegram-bot": token }),
    homeDir: home,
    clock: createManualClock(0),
    readFile: files,
    run: async () => Promise.resolve(`${token}\n`),
    ...more,
  });
}

describe("secret reader", () => {
  it.each([
    { fromEnv: "TELEGRAM_BOT_TOKEN" },
    { fromKeychain: "telegram-bot" },
    { fromFile: "~/.binference/secrets/bot" },
    { fromCommand: ["op", "read", "op://vault/bot/token"] },
  ])("reads the secret behind %o, trimmed", async (source) => {
    const secret = await reader().read("telegram.botToken", source, signal());
    expect(secret.reveal()).toBe(token);
    expect(String(secret)).not.toContain(token);
  });

  it("runs the program with its arguments as given, never through a shell", async () => {
    const calls: (readonly string[])[] = [];
    const run: RunProgram = async (file, args) => {
      calls.push([file, ...args]);
      return Promise.resolve(token);
    };
    await reader({ run }).read(
      "telegram.botToken",
      { fromCommand: ["op", "read", "a b;c"] },
      signal(),
    );
    expect(calls).toStrictEqual([["op", "read", "a b;c"]]);
  });

  it.each([
    [{ fromEnv: "MISSING" }, "not_set", "the environment variable MISSING"],
    [{ fromEnv: "EMPTY" }, "empty", "the environment variable EMPTY"],
    [
      { fromKeychain: "privy-app-secret" },
      "not_found",
      "the keychain entry binference/privy-app-secret",
    ],
    [{ fromFile: "/etc/binference/missing" }, "not_found", "/etc/binference/missing"],
  ] as const)(
    "names the key, the source and the next step when %o has no secret",
    async (source, reason, from) => {
      const reading = reader().read("custody.privy.appSecret", source, signal());
      await expect(reading).rejects.toThrow(
        /^custody\.privy\.appSecret: .+\. .+ another secret source\.$/,
      );
      await expect(reading).rejects.toMatchObject({
        code: "config.secret_unavailable",
        details: { path: "custody.privy.appSecret", from, reason },
      });
    },
  );

  it("refuses an empty secret", async () => {
    await expect(
      reader({ run: blank }).read("telegram.botToken", { fromCommand: ["op"] }, signal()),
    ).rejects.toMatchObject({ details: { reason: "empty", from: "the program op" } });
  });

  it("gives up on a program that prints nothing within 10 seconds", async () => {
    const clock = createManualClock(0);
    const reading = reader({ clock, run: hanging }).read(
      "telegram.botToken",
      { fromCommand: ["slow"] },
      signal(),
    );
    await clock.advance(10_000);
    await expect(reading).rejects.toMatchObject({
      code: "config.secret_unavailable",
      details: { reason: "timeout", from: "the program slow" },
    });
  });

  it("stops with the caller's reason when the caller aborts", async () => {
    const controller = new AbortController();
    const reading = reader({ run: hanging }).read(
      "telegram.botToken",
      { fromCommand: ["slow"] },
      controller.signal,
    );
    const reason = new Error("stopping");
    controller.abort(reason);
    await expect(reading).rejects.toBe(reason);
  });

  it("reads nothing on an aborted signal", async () => {
    const reason = new Error("stopped");
    await expect(
      reader().read(
        "telegram.botToken",
        { fromEnv: "TELEGRAM_BOT_TOKEN" },
        AbortSignal.abort(reason),
      ),
    ).rejects.toBe(reason);
  });
});
