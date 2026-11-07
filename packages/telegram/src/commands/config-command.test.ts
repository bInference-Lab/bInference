import { err, ok } from "@binference/core";
import type { OwnerChatHandlers } from "@binference/engine/surfaces";
import type { ArgsOf, IntentView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { cardIntent } from "../testing/card-fixtures.js";
import { ownerId } from "../testing/update-fixtures.js";
import { startCommandBot, waitingSwap } from "./test-command-bot.js";

const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-0123456789ab" as IntentView["agent"];
const wallet = "wal_0190f1c2-3a4b-7c5d-8e6f-0123456789ab" as IntentView["wallet"];
const waitingText = "The change waits on its card. Check each setting on it, then tap Confirm.";

function proposedView(patch: ArgsOf<"config/propose">["patch"]): IntentView {
  return {
    intent: cardIntent,
    agent,
    wallet,
    kind: "configChange",
    state: "awaiting_confirmation",
    request: { kind: "configChange", patch },
    paper: false,
    outsideContent: false,
    assets: {},
    createdAt: 1,
    changedAt: 1,
  };
}

// The engine's side of `/config`: what each call was asked, and a view or a proposal for it.
function configHandlers(asked: unknown[]): OwnerChatHandlers {
  return {
    "config/view": async ({ args }) => {
      asked.push(args);
      return Promise.resolve(
        args.path === "nowhere"
          ? err("protocol.bad_args")
          : ok({
              value: { level: "info" },
              rules: [
                { path: "logging.level", description: "How much it logs.", takes: "a level" },
              ],
            }),
      );
    },
    "config/propose": async ({ args }) => {
      asked.push(args);
      return Promise.resolve(ok(proposedView(args.patch)));
    },
  };
}

describe("the /config command in Telegram", () => {
  it("shows a setting with the rules of its keys", async () => {
    const asked: unknown[] = [];
    const bot = await startCommandBot(configHandlers(asked));
    await bot.send("/config logging");
    expect(asked).toStrictEqual([{ path: "logging" }]);
    expect(bot.texts()).toStrictEqual([
      'logging:\n{\n  "level": "info"\n}\n\nlogging.level takes a level. How much it logs.',
    ]);
  });

  it("proposes a value as JSON when it reads as JSON, shows the card and answers under it", async () => {
    const asked: unknown[] = [];
    const bot = await startCommandBot(configHandlers(asked), { waiting: [waitingSwap] });
    await bot.send("/config set engine.port 7460");
    await bot.send("/config set logging.level debug");
    await bot.send("/config unset logging.level");
    expect(asked).toStrictEqual([
      { patch: { engine: { port: 7460 } } },
      { patch: { logging: { level: "debug" } } },
      { patch: { logging: { level: null } } },
    ]);
    const [card] = bot.botApi.messages();
    expect(bot.botApi.sent()[1]).toStrictEqual({
      chatId: ownerId,
      text: waitingText,
      replyTo: card?.messageId,
    });
  });

  it("answers how to use it for anything else, and why a key cannot be read", async () => {
    const bot = await startCommandBot(configHandlers([]));
    await bot.send("/config set ../x 1");
    await bot.send("/config nowhere");
    const [usage, refused] = bot.texts();
    expect(usage).toMatch(/^\/config shows your settings/u);
    expect(refused).not.toBe(usage);
  });
});
