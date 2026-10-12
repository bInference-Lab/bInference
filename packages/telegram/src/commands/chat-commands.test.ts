import { ok } from "@binference/core";
import type { OwnerChatHandlers } from "@binference/engine/surfaces";
import { type AgentView, protocolIdSchema, type ResultOf } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { ownerId, strangerId } from "../testing/update-fixtures.js";
import { modelDigest } from "./ai-command.js";
import { startCommandBot } from "./test-command-bot.js";

const main = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a1");
const scout = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a2");

const view = (agent: typeof main, name: string, mode: "paper" | "live"): AgentView => ({
  agent,
  name,
  mode,
  locale: "en",
  createdAt: 1,
  changedAt: 1,
});

const status: ResultOf<"engine/status"> = {
  state: "ready",
  version: "2026.10.0",
  protocol: 1,
  frozen: false,
  agents: [
    { id: main, mode: "live", frozen: false },
    { id: scout, mode: "paper", frozen: false },
  ],
  health: [],
};

const icons = { live: String.fromCodePoint(0x1f534), paper: String.fromCodePoint(0x1f9ea) };
const models = ["router/large", "router/backup", "router/small"] as const;

// An engine with two agents that records what each command asked of it.
function engine() {
  const asked: (readonly [string, unknown])[] = [];
  const picked = { main: models[0] as string };
  const modelList = (): ResultOf<"model/list"> => ({
    items: [
      { role: "main", model: models[0], ...(picked.main === models[0] ? { current: true } : {}) },
      { role: "main", model: models[1], ...(picked.main === models[1] ? { current: true } : {}) },
      { role: "fast", model: models[2], current: true },
    ],
  });
  const handlers: OwnerChatHandlers = {
    "engine/status": async () => Promise.resolve(ok(status)),
    "agent/list": async () =>
      Promise.resolve(ok({ items: [view(main, "main", "live"), view(scout, "scout", "paper")] })),
    "agent/goPaper": async ({ args }) => {
      asked.push(["agent/goPaper", args.agent]);
      return Promise.resolve(ok(view(scout, "scout", "paper")));
    },
    "chat/clear": async ({ args }) => {
      asked.push(["chat/clear", args.agent]);
      const session = protocolIdSchema("chatSession").parse(
        "ses_0190f1c2-3a4b-7c5d-8e6f-000000000009",
      );
      return Promise.resolve(ok({ session }));
    },
    "model/list": async ({ args }) => {
      asked.push(["model/list", args.agent]);
      return Promise.resolve(ok(modelList()));
    },
    "model/set": async ({ args }) => {
      asked.push(["model/set", [args.agent, args.role, args.model]]);
      picked.main = args.model;
      return Promise.resolve(ok(modelList()));
    },
  };
  return { handlers, asked };
}

async function botWith() {
  const fake = engine();
  const bot = await startCommandBot(fake.handlers);
  return { bot, asked: fake.asked };
}

describe("the agent and chat commands", () => {
  it("lists the agents, and with two of them asks which one the chat talks to", async () => {
    const { bot } = await botWith();
    await bot.send("/agents");
    await bot.send("/clear");
    expect(bot.texts()).toStrictEqual([
      `Your agents:\nmain · ${icons.live} Live\nscout · ${icons.paper} Paper\n/use and an agent's name picks the agent this chat talks to.`,
      `binference has 2 agents: ${main}, ${scout}. Pick the one this chat talks to with /use and its name; /agents lists them.`,
    ]);
  });

  it("picks the agent with /use, and the next commands act on it", async () => {
    const { bot, asked } = await botWith();
    await bot.send("/use Scout");
    await bot.send("/agents");
    await bot.send("/paper");
    await bot.send("/clear");
    expect(bot.texts().slice(0, 2)).toStrictEqual([
      "This chat talks to scout now. Its answers start with its name while you have more than one agent.",
      `Your agents:\nmain · ${icons.live} Live\nscout · ${icons.paper} Paper · this chat talks to it\n/use and an agent's name picks the agent this chat talks to.`,
    ]);
    expect(bot.texts().at(-1)).toBe(
      "A new chat has started. The agent forgets this conversation; its notes and files stay.",
    );
    expect(asked).toStrictEqual([
      ["agent/goPaper", scout],
      ["chat/clear", scout],
    ]);
  });

  it("says how /use works without a name, and which names there are for an unknown one", async () => {
    const { bot } = await botWith();
    await bot.send("/use");
    await bot.send("/use nobody");
    expect(bot.texts()).toStrictEqual([
      "Name the agent this chat should talk to after /use, such as /use main. Your agents: main, scout.",
      "No agent is named nobody. Your agents: main, scout.",
    ]);
  });

  it("says no scheduled turn is set while the engine serves no schedules", async () => {
    const { bot } = await botWith();
    await bot.send("/use main");
    await bot.send("/schedules");
    expect(bot.texts().at(-1)).toBe("No scheduled turn is set yet.");
  });

  it("answers every command in the chat itself, never through the agent's model", async () => {
    const { bot } = await botWith();
    for (const text of ["/agents", "/use main", "/clear", "/ai", "/schedules", "/spend"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the owner sends them one by one
      await bot.send(text);
    }
    expect(bot.chat).toStrictEqual([]);
  });
});

// An engine whose /ai reply the owner has in the chat, and a press on its buttons.
async function shownModels() {
  const { bot, asked } = await botWith();
  await bot.send("/use main");
  await bot.send("/ai");
  const message = bot.botApi.messages().at(-1);
  const press = async (data: string, from = ownerId): Promise<void> =>
    bot.receive(bot.botApi.press({ from, data, messageId: message?.messageId ?? 0 }));
  return { bot, asked, press };
}

describe("the /ai command", () => {
  it("shows the models in use and a button for each configured model", async () => {
    const { bot } = await shownModels();
    expect(bot.botApi.messages().at(-1)).toMatchObject({
      text: "Main model: router/large\nFast model: router/small\nTap a model to use it as the main model from the next message on. A model you pick stays, with no fallback; tap the configured main model to bring its fallbacks back.",
      buttons: models.map((model) => [{ text: model, data: `bnf1:m:s:${modelDigest(model)}` }]),
    });
  });

  it("sets the tapped model for the main role through model/set, and shows it in use", async () => {
    const { bot, asked, press } = await shownModels();
    await press(`bnf1:m:s:${modelDigest("router/backup")}`);
    expect(asked.filter(([op]) => op === "model/set")).toStrictEqual([
      ["model/set", [main, "main", "router/backup"]],
    ]);
    expect(bot.botApi.messages().at(-1)?.text).toMatch(/^Main model: router\/backup\n/u);
    expect(bot.botApi.answers().map((answer) => answer.text)).toStrictEqual([
      "The main model is router/backup from the next message on.",
    ]);
  });

  it("changes nothing for a model no longer configured, or a press by anyone but the owner", async () => {
    const { bot, asked, press } = await shownModels();
    await press(`bnf1:m:s:${modelDigest("router/gone")}`);
    await press(`bnf1:m:s:${modelDigest("router/backup")}`, strangerId);
    expect(asked.filter(([op]) => op === "model/set")).toStrictEqual([]);
    expect(bot.botApi.answers().map((answer) => answer.text)).toStrictEqual([
      "That model is no longer in config.json5. Send /ai for the models it has now.",
    ]);
  });
});
