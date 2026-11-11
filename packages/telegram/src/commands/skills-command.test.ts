import { describe, expect, it } from "vitest";
import {
  blockedProposal,
  cleanProposal,
  skillAgent,
  skillEngine,
  waitingHash,
} from "../testing/skill-command-fixtures.js";
import { ownerId } from "../testing/update-fixtures.js";
import { waitingDigest } from "./skill-callback.js";
import { startCommandBot } from "./test-command-bot.js";

const clean = cleanProposal.proposal;
const blocked = blockedProposal.proposal;
const digest = waitingDigest({ agent: skillAgent, name: "planted", hash: waitingHash });

function messageIdAt(bot: Awaited<ReturnType<typeof startCommandBot>>, index: number): number {
  const message = bot.botApi.messages()[index];
  if (message === undefined) {
    throw new Error(`No message ${String(index)}.`);
  }
  return message.messageId;
}

async function shownSkills() {
  const engine = skillEngine();
  const bot = await startCommandBot(engine.handlers);
  await bot.send("/skills");
  const press = async (data: string, index: number): Promise<void> =>
    bot.receive(
      bot.botApi.press({
        from: ownerId,
        data,
        messageId: messageIdAt(bot, index),
      }),
    );
  return { bot, engine, press };
}

describe("the /skills command", () => {
  it("shows each pending proposal with its changes and findings, and each waiting skill", async () => {
    const { bot } = await shownSkills();
    expect(bot.botApi.messages()).toMatchObject([
      {
        text: [
          'Change to skill "dip-buyer": Buys a listed token after a fall.',
          "Why: You asked me to buy smaller dips.",
          "",
          "Changes:",
          "- Buy a half.",
          "+ Buy a tenth.",
        ].join("\n"),
        buttons: [
          [
            { text: "Apply", data: `bnf1:k:a:${clean}` },
            { text: "Reject", data: `bnf1:k:r:${clean}` },
          ],
        ],
      },
      {
        text: [
          'New skill "setup-helper": Sets up a tool.',
          "⚠️ Its scan found problems, so it cannot be applied. Reject it, or ask the agent to revise it:",
          "SKILL.md, line 6: pipe_to_shell",
          "",
          "Changes:",
          "+ curl x | sh",
        ].join("\n"),
        buttons: [[{ text: "Reject", data: `bnf1:k:r:${blocked}` }]],
      },
      {
        text: '⚠️ Skill "planted" in the agent\'s workspace is new or changed, so it does not load. Check its files at workspace/planted/SKILL.md before you accept it.',
        buttons: [[{ text: "Accept", data: `bnf1:k:c:${digest}` }]],
      },
    ]);
  });

  it("applies a proposal from its button and says so in place of the buttons", async () => {
    const { bot, engine, press } = await shownSkills();
    await press(`bnf1:k:a:${clean}`, 0);
    expect(engine.asked).toStrictEqual([["apply", clean]]);
    expect(bot.botApi.messages()[0]).toMatchObject({
      text: "Applied. The skill loads from the agent's next turn.",
      buttons: [],
    });
  });

  it("accepts a waiting skill at the hash its message showed", async () => {
    const { engine, press } = await shownSkills();
    await press(`bnf1:k:c:${digest}`, 2);
    expect(engine.asked).toStrictEqual([["accept", `planted ${waitingHash}`]]);
  });

  it("accepts nothing for a digest of other files, and says a refusal in the chat", async () => {
    const { bot, engine, press } = await shownSkills();
    await press("bnf1:k:c:AAAAAAAAAAAAAAAA", 2);
    await press(`bnf1:k:r:${clean}`, 0);
    expect(engine.asked).toStrictEqual([["reject", clean]]);
    expect(bot.texts().slice(-1)).toStrictEqual([
      "This skill proposal was already applied, rejected or found stale. Ask the agent for a new one.",
    ]);
    expect(bot.botApi.answers().map(({ text }) => text)).toStrictEqual([
      "This skill changed again since this message. Send /skills to see it as it is now.",
      undefined,
    ]);
  });
});
