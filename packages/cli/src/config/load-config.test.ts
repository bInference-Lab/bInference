import { join } from "node:path";
import { err, ok } from "@binference/core";
import { readTextFile } from "@binference/platform";
import { describe, expect, it } from "vitest";
import { formatConfigIssue } from "./format-config-issue.js";
import { type LoadConfigOptions, loadConfig } from "./load-config.js";
import type { ConfigOutcome, ValidConfig } from "./validate-config.js";

const file = "/srv/binference/config.json5";
const minimal = '{ telegram: { botToken: { fromKeychain: "telegram-bot" } } }';
const signal = (): AbortSignal => new AbortController().signal;

function options(
  text: string | undefined,
  more: Partial<LoadConfigOptions> = {},
): LoadConfigOptions {
  return {
    file,
    env: {},
    sets: [],
    system: { locale: "en", timezone: "Europe/Berlin", unlockMode: "keychain" },
    signal: signal(),
    readFile: async () => Promise.resolve(text === undefined ? err("not_found") : ok(text)),
    ...more,
  };
}

function valid(outcome: ConfigOutcome): ValidConfig {
  if (!outcome.ok) {
    throw new Error(outcome.issues.map(formatConfigIssue).join("\n"));
  }
  return outcome;
}

function lines(outcome: ConfigOutcome): readonly string[] {
  return outcome.ok ? [] : outcome.issues.map(formatConfigIssue);
}

// The example in section 7 of the config spec, read from the spec itself.
async function specExample(): Promise<string> {
  const spec = await readTextFile(
    join(import.meta.dirname, "..", "..", "..", "..", "docs", "specs", "config.md"),
    signal(),
  );
  const text = spec.ok ? spec.value : "";
  const example = /## 7\. Example\s+```json5\n([\s\S]*?)```/.exec(text)?.[1];
  expect(example).toBeDefined();
  return example ?? "";
}

describe("load config", () => {
  it("loads the example of the config spec, with defaults under it", async () => {
    const loaded = valid(await loadConfig(options(await specExample())));
    expect(loaded.config.owner).toStrictEqual({ locale: "zh", timezone: "Asia/Shanghai" });
    expect(loaded.config.telegram.botToken).toStrictEqual({ fromKeychain: "telegram-bot" });
    expect(loaded.config.models.providers["binference"]?.apiKey).toStrictEqual({
      fromKeychain: "binference-key",
    });
    expect(loaded.config.defaults.limits.perTradeUsd).toBe(50_000_000n);
    expect(loaded.config.defaults.limits.rollingDayUsd).toBe(250_000_000n);
    expect(loaded.config.defaults.limits.liquidityFloorUsd).toBe(10_000_000_000n);
    expect(loaded.config.network.proxy).toStrictEqual({ fromEnv: "HTTPS_PROXY" });
    expect(loaded.config.engine.port).toBe(7456);
    expect(loaded.config.engine.unlock.mode).toBe("keychain");
    expect(loaded.config.chains.enabled).toStrictEqual(["eip155:56"]);
  });

  it("lets the environment replace the file, and a flag replace both", async () => {
    const text =
      '{ engine: { port: 7000, webhookPort: 7001 }, telegram: { botToken: { fromEnv: "T" } } }';
    const loaded = valid(
      await loadConfig(
        options(text, {
          env: { BINFERENCE_ENGINE__PORT: "7460", BINFERENCE_ENGINE__WEBHOOK_PORT: "7461" },
          sets: ["engine.port=7470"],
        }),
      ),
    );
    expect(loaded.config.engine.port).toBe(7470);
    expect(loaded.config.engine.webhookPort).toBe(7461);
    expect(loaded.origins.get("engine.port")).toStrictEqual({
      layer: "flag",
      name: "engine.port",
    });
    expect(loaded.origins.get("engine.webhookPort")).toStrictEqual({
      layer: "env",
      name: "BINFERENCE_ENGINE__WEBHOOK_PORT",
    });
    expect(loaded.origins.get("owner.locale")).toStrictEqual({ layer: "default", name: "" });
  });

  it("reads lists, objects and secret sources from variables as JSON", async () => {
    const loaded = valid(
      await loadConfig(
        options("{}", {
          env: {
            BINFERENCE_CHAINS__ENABLED: '["eip155:56"]',
            BINFERENCE_TELEGRAM__BOT_TOKEN: '{"fromEnv":"TELEGRAM_BOT_TOKEN"}',
            BINFERENCE_MODELS__PROVIDERS__BINFERENCE__KIND: "binference",
            BINFERENCE_HOME: "/srv/binference",
          },
        }),
      ),
    );
    expect(loaded.config.telegram.botToken).toStrictEqual({ fromEnv: "TELEGRAM_BOT_TOKEN" });
    expect(loaded.config.models.providers["binference"]?.kind).toBe("binference");
  });

  it("replaces a secret source whole, never merging two forms", async () => {
    const loaded = valid(
      await loadConfig(options(minimal, { sets: ['telegram.botToken={"fromEnv":"TOKEN"}'] })),
    );
    expect(loaded.config.telegram.botToken).toStrictEqual({ fromEnv: "TOKEN" });
  });

  it("accepts comments, trailing commas, a byte order mark and Windows line endings", async () => {
    const text = '﻿// mine\r\n{\r\n  telegram: { botToken: { fromKeychain: "bot" }, },\r\n}\r\n';
    expect(valid(await loadConfig(options(text))).config.telegram.mode).toBe("polling");
  });

  it("names a variable and a flag that set no key, with their fixes", async () => {
    const outcome = await loadConfig(
      options(minimal, {
        env: { BINFERENCE_ENGIN__PORT: "1" },
        sets: ["engine.prot=1", "nothing"],
      }),
    );
    expect(lines(outcome)).toStrictEqual([
      "engin.port (BINFERENCE_ENGIN__PORT): is not a config key. Unset BINFERENCE_ENGIN__PORT, or check its spelling.",
      "engine.prot: is not a config key. Leave out the --set engine.prot= flag, or check its spelling.",
      "--set flag #2: is not written as --set key=value. Write each flag as --set key=value.",
    ]);
  });

  it("asks for binference init when the file does not exist", async () => {
    expect(lines(await loadConfig(options(undefined)))).toStrictEqual([
      `${file}: does not exist. Run binference init to write it, or point --config at your file.`,
    ]);
  });

  it("names the line and column of a syntax error, and none of the text", async () => {
    const outcome = await loadConfig(options('{\n  telegram: { botToken: "7012345678:AAH" \n'));
    expect(outcome).toMatchObject({ ok: false, issues: [{ problem: { kind: "unreadable" } }] });
    expect(lines(outcome)[0]).toMatch(
      /^.+: is not valid JSON5 at line 3, column \d+\. Fix config\.json5/,
    );
    expect(JSON.stringify(outcome)).not.toContain("AAH");
  });

  it("refuses a file that is not one object", async () => {
    expect(lines(await loadConfig(options("[1, 2]")))).toStrictEqual([
      `${file}: must be an object (got a list). Set it in config.json5 or remove it.`,
    ]);
  });

  it("refuses a file from a newer binference", async () => {
    expect(lines(await loadConfig(options(`{ version: 9, ${minimal.slice(1)}`)))).toStrictEqual([
      "version: is version 9, from a newer binference; this one reads up to version 1. Update " +
        "binference, or restore a backup of config.json5.",
    ]);
  });

  it("requires the bot token, the unlock command and the webhook secret when they are needed", async () => {
    const text =
      '{ engine: { unlock: { mode: "command" } }, telegram: { mode: "webhook", botToken: { fromEnv: "T" } } }';
    expect(lines(await loadConfig(options("{}")))).toStrictEqual([
      "telegram.botToken: is required. Add it to config.json5.",
    ]);
    expect(lines(await loadConfig(options(text)))).toStrictEqual([
      "engine.unlock.command: is required. Add it to config.json5.",
      "telegram.webhookSecret: is required. Add it to config.json5.",
    ]);
  });
});
