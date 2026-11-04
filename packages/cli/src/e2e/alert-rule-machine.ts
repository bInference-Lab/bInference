import { BinferenceError } from "@binference/core";
import { testAgent as agent, testNowMs } from "@binference/engine/testing";
import { type Locale, type ProtocolId, protocolIdSchema } from "@binference/protocol";
import type { FakeBotApi } from "@binference/telegram/testing";
import type { ComposedTelegram } from "../compose/compose-telegram.js";
import type { SkeletonComposition } from "../compose/test-skeleton.js";
import { type AlertPoster, listenForAlerts } from "./alert-poster.js";
import { confirmOf, ownerBot, ownerId } from "./runtime-machine.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { type CommandOutcome, createTestMachines, runOn, type TestMachine } from "./test-host.js";
import { tradingViewHeaders } from "./tradingview-alerts.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
const urlPattern = /https?:\/\/\S+\/hook\/(whr_[^/\s]+)\/[\w-]{43}/;
const ruleIdSchema = protocolIdSchema("webhookRule");

/**
 * The skeleton with the owner's bot on the synthetic Bot API, the webhook listener on a loopback
 * port of its own, and the machine the owner runs `binference` on, in the owner's language.
 */
export interface AlertRuleMachine {
  readonly machine: TestMachine;
  readonly skeleton: ServedSkeleton;
  readonly bot: ComposedTelegram;
  readonly botApi: FakeBotApi;
  readonly alerts: AlertPoster;
  /** The variables of each command the owner runs. */
  readonly env: Readonly<Record<string, string>>;
  /** Stops the listener and the skeleton, and removes the machine's folder. */
  stop(): Promise<void>;
}

/** A rule the owner made in the CLI: what the command printed, the rule's id and its URL. */
export interface MadeRule {
  readonly made: CommandOutcome;
  readonly rule: ProtocolId<"webhookRule">;
  readonly url: string;
}

/**
 * Serves the skeleton on a fresh machine with the owner's bot, whose notices go out from the start,
 * the agent's paper portfolio reset, and the webhook listener over the skeleton's alert store.
 */
export async function startAlertRuleMachine(
  composition: SkeletonComposition,
  locale: Locale,
): Promise<AlertRuleMachine> {
  const machines = createTestMachines();
  const machine = await machines.create(testNowMs);
  const { botApi, telegram } = await ownerBot();
  const owner = () => ({ locale, timezone: "UTC" });
  const skeleton = await serveSkeleton(machine, composition, { telegram, owner });
  const bot = skeleton.composed.telegram;
  if (bot === undefined) {
    throw new BinferenceError({ code: "test.no_bot", message: "The skeleton serves the bot." });
  }
  bot.start();
  await skeleton.client.call("portfolio/resetPaper", { agent }, live());
  const alerts = await listenForAlerts(skeleton);
  const env = { LANG: locale === "zh" ? "zh_CN.UTF-8" : "en_US.UTF-8" };
  const stop = async () => {
    await alerts.close();
    await skeleton.close();
    await machines.removeAll();
  };
  return { machine, skeleton, bot, botApi, alerts, env, stop };
}

/**
 * The owner runs `argv`, a `binference webhook create`, with no one at the terminal to answer, so
 * the rule's card stays open for Telegram; resolves once the card reached the owner's chat.
 */
export async function makeRule(
  world: AlertRuleMachine,
  argv: readonly string[],
): Promise<MadeRule> {
  const made = await runOn(world.machine, argv, world.env);
  const [url = "", rule = ""] = urlPattern.exec(made.stdout) ?? [];
  await world.bot.idle();
  return { made, rule: ruleIdSchema.parse(rule), url };
}

/** The owner taps Confirm on the one card in Telegram. */
export async function confirmInTelegram(world: AlertRuleMachine): Promise<void> {
  const { data, messageId } = confirmOf(world.botApi);
  const press = world.botApi.press({ from: ownerId, data, messageId });
  await world.bot.ingress.receive(press, live());
  await world.bot.idle();
}

/** TradingView posts `body` to the rule's URL; the listener's status. */
export async function postAlert(
  world: AlertRuleMachine,
  url: string,
  body: string,
): Promise<number> {
  return world.alerts.post(url, body, tradingViewHeaders);
}

/** The engine's webhook fill timer runs `afterMs` from now, then the bot's sends end. */
export async function fillAfter(world: AlertRuleMachine, afterMs: number): Promise<void> {
  await world.skeleton.clock.advance(afterMs);
  await world.skeleton.composed.engine.fillWebhookAlerts(live());
  await world.bot.idle();
}

/** The texts of the owner's chat now, each message as it reads after its last edit. */
export function chatTexts(world: AlertRuleMachine): readonly string[] {
  return world.botApi.messages().map(({ text }) => text);
}
