import { createFormatter } from "@binference/i18n";
import { describe, expect, inject, it, onTestFailed } from "vitest";
import { draftInChat, pressFirst, settleChatAndStop } from "./crash-chat.js";
import type { CrashContext } from "./crash-context.js";
import { launchTokensPerUnit } from "./crash-flap.js";
import { armKillWith, restartWith, storyOf, useCrashHarness } from "./crash-harness.js";
import { type StoredLaunchRun, storedLaunchOf } from "./crash-launch-reads.js";
import { crashFirstBuys } from "./crash-launch-terms.js";
import { setUpLauncher } from "./crash-launches.js";
import { landedOf, minedOf, unminedOf } from "./crash-reads.js";
import { setUpCrashInstall } from "./crash-runs.js";

// Each run starts a launch from the owner's Telegram chat (decision 0285) on the synthetic Bot API:
// the owner pairs, sends a photo asking for the launch, the agent's runtime drafts it on a
// scripted model, and the owner taps Start launch. The test kills the engine outright before the
// launch is stored, once its upload began, or while it waits for its pin, and a second engine on
// the same folder recovers; the owner confirms a card the bot shows. The relays, anvil, the test's
// Flap API and the Bot API count what went out.
const crash: CrashContext = inject("crash");
const harness = useCrashHarness(crash, { seed: 41 });
const runs = Array.from({ length: crash.runs }, (_, index) => index + 1);
const pins = ["processing", "pinned"] as const;
const cid = "bafkreicrashcatstartedfromachatthroughaforcedstopbyabinferencerun";
const english = createFormatter({ locale: "en", timeZone: "UTC" });

/**
 * Where a chat launch run kills the engine: after the owner's Start, as the launch reads its
 * launch wallet before it is stored (`start`); as Flap's API gets its upload (`upload`); as Flap's
 * API gets its first pin read (`pin`).
 */
type ChatKillPoint = "start" | "upload" | "pin";

async function crashChatOnce(point: ChatKillPoint) {
  const world = harness.worldOf();
  const { chain, services } = world;
  const install = await setUpCrashInstall(world, harness.folders);
  const { bot } = install.machine;
  services.telegram.serve(bot);
  const first = await harness.startEngine(install, { chat: true });
  const launcher = await setUpLauncher(world, install);
  const from = launcher.address;
  services.flap.serve({ cid, pins });
  const draft = await draftInChat(install);
  const wallet = from.slice(2).toLowerCase();
  const isWalletRead = (request: { readonly params: readonly unknown[] }) =>
    JSON.stringify(request.params).toLowerCase().includes(wallet);
  const reached = {
    start: async () => chain.holdNextRead(isWalletRead),
    upload: async () => services.flap.holdNextUpload(),
    pin: async () => services.flap.holdNextPinRead(),
  };
  const killed = armKillWith(first, point, async (kill) => reached[point]().then(kill));
  pressFirst(bot, draft);
  await killed;
  const sentAtKill = bot.sent().length;
  const settle = async () => settleChatAndStop(install, launcher);
  const restart = { isMinedAfterResend: false, fills: false, chat: true, settle, from };
  const second = await restartWith(harness, install, restart);
  const sends = chain.sends().filter((send) => send.from === from);
  return {
    hashes: [...new Set(sends.map(({ hash }) => hash))],
    mined: await minedOf(chain, from),
    unmined: await unminedOf(chain, from),
    landed: await landedOf(chain, sends),
    uploads: services.flap.uploads(),
    settled: second.settled,
    restartExit: await second.engine.program.exited,
    stored: await storedLaunchOf(install.machine.folder, launcher),
    // The messages the bot sent after the restart, and the draft's message as it reads now.
    afterRestart: bot.sent().slice(sentAtKill),
    draft: bot.messages().find(({ messageId }) => messageId === draft.messageId),
    answers: bot.answers().flatMap(({ text }) => (text === undefined ? [] : [text])),
    // The cards the bot sent after the restart: each names the launch's action line.
    cards: bot
      .sent()
      .slice(sentAtKill)
      .filter(({ text }) => text.includes("Launch CCAT (Crash Cat)")).length,
    story: await storyOf(install.machine.folder, [first, second.engine]),
  };
}

const notStored: Omit<StoredLaunchRun, "path"> = {
  launches: 0,
  state: undefined,
  cards: [],
  notices: [],
  feed: 0,
  executions: 0,
  held: [],
};

describe("an engine killed after the owner's Start, before the launch is stored", () => {
  it.each(runs)("starts nothing, and the draft says it is gone, run %i", async () => {
    const outcome = await crashChatOnce("start");
    onTestFailed(() => {
      process.stderr.write(`${outcome.story}\n`);
    });
    const { path, ...stored } = outcome.stored;
    expect([stored, path]).toStrictEqual([notStored, []]);
    expect([outcome.hashes, outcome.mined, outcome.uploads]).toStrictEqual([[], 0, 0]);
    expect(outcome.afterRestart).toStrictEqual([]);
    // The press Telegram hands the restarted bot again finds no draft, and proposes nothing.
    expect([outcome.draft?.text, outcome.answers]).toStrictEqual([
      english.message("telegram.draft.gone"),
      [english.message("telegram.draft.answer.gone")],
    ]);
    expect(outcome.restartExit).toBe(0);
  });
});

describe("an engine killed once a launch from the chat began its upload", () => {
  it.each(runs)(
    "ends it upload_lost, tells the owner once and uploads nothing more, run %i",
    async () => {
      const outcome = await crashChatOnce("upload");
      onTestFailed(() => {
        process.stderr.write(`${outcome.story}\n`);
      });
      const { path, ...stored } = outcome.stored;
      expect(stored).toStrictEqual({
        ...notStored,
        launches: 1,
        state: "failed_check",
        notices: ["notice.launchStopped"],
      });
      expect(path).toStrictEqual(["proposed", "checked", "failed_check"]);
      expect([outcome.hashes, outcome.mined, outcome.uploads]).toStrictEqual([[], 0, 1]);
      const told = outcome.afterRestart.map(({ text }) => text);
      expect(told).toStrictEqual([expect.stringContaining("The launch of CCAT on flap stopped")]);
      // The press Telegram hands the restarted bot again finds the launch it started, which ended.
      const reason = english.message("reason.upload_lost");
      expect([outcome.draft?.text, outcome.answers]).toStrictEqual([
        english.message("telegram.draft.ended", { reason }),
        [english.message("telegram.draft.answer.ended")],
      ]);
      expect(outcome.restartExit).toBe(0);
    },
  );
});

describe("an engine killed while a launch from the chat waits for its pin", () => {
  it.each(runs)("shows its card once after the restart and lands it once, run %i", async () => {
    const outcome = await crashChatOnce("pin");
    onTestFailed(() => {
      process.stderr.write(`${outcome.story}\n`);
    });
    const { path, ...stored } = outcome.stored;
    expect(stored).toStrictEqual({
      launches: 1,
      state: "reconciled",
      cards: ["confirmed"],
      notices: [],
      feed: 1,
      executions: 1,
      held: [crashFirstBuys.coin * launchTokensPerUnit],
    });
    expect([new Set(path).size, path.at(-1)]).toStrictEqual([path.length, "reconciled"]);
    expect([outcome.hashes.length, outcome.mined, outcome.unmined]).toStrictEqual([1, 1, 0]);
    expect(outcome.landed).toStrictEqual(outcome.hashes);
    expect([outcome.uploads, outcome.cards, outcome.settled.isTappedAfter]).toStrictEqual([
      1,
      1,
      true,
    ]);
    // The press Telegram hands the restarted bot again finds the launch it started, and never
    // invites a second draft.
    expect([outcome.draft?.text, outcome.answers]).toStrictEqual([
      english.message("telegram.draft.launched"),
      [english.message("telegram.draft.answer.launched")],
    ]);
    expect(outcome.restartExit).toBe(0);
  });
});
