import { type CardDisplay, cardLineText } from "@binference/i18n";
import type { AssetInfos, PnlCardView, PortfolioView } from "@binference/protocol";
import { callOrSay, type CommandContext } from "./command-context.js";
import { stakingBlocks } from "./positions-staking.js";

/** One agent's P&L cards, with the info of the assets they name, and its portfolio. */
interface AgentCards {
  readonly cards: readonly PnlCardView[];
  readonly assets: AssetInfos;
  readonly portfolio: PortfolioView;
}

// `/positions` shows the positions closed in the last 7 days (spec 4, section 5).
const closedWindowMs = 7 * 24 * 60 * 60 * 1_000;
// Telegram's limit on one message's text.
const messageLength = 4_096;

// Every card and portfolio of every agent not archived, in each agent's order. A refused read is
// said once and shows no card.
async function everyCard(context: CommandContext): Promise<readonly AgentCards[] | undefined> {
  const listed = await callOrSay(context, "agent/list", {});
  if (listed === undefined) {
    return undefined;
  }
  const { calls, senderId, signal, nowMs } = context;
  const args = { from: Math.max(0, nowMs - closedWindowMs), to: nowMs, cards: true };
  const agents = listed.items.filter(({ archivedAt }) => archivedAt === undefined);
  const answers = await Promise.all(
    agents.map(async ({ agent }) =>
      Promise.all([
        calls.call({ op: "portfolio/pnl", args: { agent, ...args }, senderId }, { signal }),
        calls.call({ op: "portfolio/get", args: { agent }, senderId }, { signal }),
      ]),
    ),
  );
  const refused = answers.flat().find((answer) => !answer.ok);
  if (refused !== undefined && !refused.ok) {
    await context.say(context.words(`error.${refused.error}`));
    return undefined;
  }
  return answers.flatMap(([pnl, portfolio]) =>
    pnl.ok && portfolio.ok
      ? [{ cards: pnl.value.cards ?? [], assets: pnl.value.assets, portfolio: portfolio.value }]
      : [],
  );
}

function cardText(card: PnlCardView, display: CardDisplay): string {
  return card.lines.map((line) => cardLineText(line, display)).join("\n");
}

// One mode's section: its heading, then each card, then the staking and the bridges in transit, a
// blank line between them.
function sectionOf(
  context: CommandContext,
  read: readonly AgentCards[],
  mode: "paper" | "live",
): readonly string[] {
  const texts = read.flatMap(({ cards, assets }) => {
    const display = { formatter: context.formatter, assets };
    return cards
      .filter(({ paper }) => paper === (mode === "paper"))
      .map((card) => cardText(card, display));
  });
  const elsewhere = read.flatMap(({ portfolio }) => stakingBlocks(context, portfolio, mode));
  const blocks = [...texts, ...elsewhere];
  return blocks.length === 0 ? [] : [context.words("cmd.positions.section", { mode }), ...blocks];
}

// The messages: as many whole cards each as fit in one Telegram message, so no card is split.
function pagesOf(blocks: readonly string[]): readonly string[] {
  const pages: string[] = [];
  for (const block of blocks) {
    const last = pages.at(-1);
    const joined = last === undefined ? block : `${last}\n\n${block}`;
    if (last !== undefined && joined.length <= messageLength) {
      pages[pages.length - 1] = joined;
    } else {
      pages.push(block);
    }
  }
  return pages;
}

/**
 * `/positions`: each position of every agent not archived as its P&L card (spec 4, sections 3.7
 * and 5), drawn by the engine: open ones first, then those closed in the last 7 days, then each
 * mode's staking and its bridges in transit from `portfolio/get`. Live cards come under their
 * heading before the paper ones under theirs, never added together. Each message holds as many
 * whole cards as fit in 4,096 characters.
 */
export async function runPositions(context: CommandContext): Promise<void> {
  const read = await everyCard(context);
  if (read === undefined) {
    return;
  }
  const blocks = [...sectionOf(context, read, "live"), ...sectionOf(context, read, "paper")];
  if (blocks.length === 0) {
    await context.say(context.words("cmd.positions.empty"));
    return;
  }
  // Each page goes after the one before it, so the cards keep their order in the chat.
  await pagesOf(blocks).reduce(async (before: Promise<void>, page) => {
    await before;
    await context.say(page);
  }, Promise.resolve());
}
