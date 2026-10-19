import type { AccountRef, AssetRef, ChainRegistry } from "@binference/chain";
import { BinferenceError, type Ratio } from "@binference/core";
import { addressPartOf, createFormatter, shortAddress } from "@binference/i18n";
import type {
  ActivityItem,
  AlertCondition,
  AlertFire,
  AssetInfos,
  LaunchView,
  PriceCondition,
  WalletCondition,
} from "@binference/protocol";
import type { AddressEntryRecord } from "../agents/address-entry-record.js";
import { assetInfoOf } from "../money-path/asset-infos.js";
import { priceText } from "../orders/fill-notices.js";
import type { Notice, NoticePart } from "../pushes/notice-push.js";
import type { AlertRecord } from "./alert-record.js";

// Dollars and shares read the same in every language (`$1.20`, `40.00%`), so notices carry text.
const plain = createFormatter({ locale: "en", timeZone: "UTC" });
const minuteMs = 60_000;
const hourMs = 3_600_000;
const dayMs = 86_400_000;

/**
 * A token as an alert's notice names it: the registry's symbol; else the symbol its contract
 * answered, which its deployer chose, then its short address; else its short address.
 */
function alertTokenText(chains: ChainRegistry, assets: AssetInfos, token: AssetRef): string {
  const listed = assetInfoOf(chains, token);
  if (listed !== undefined) {
    return listed.symbol;
  }
  const address = shortAddress(addressPartOf(token));
  const told = assets[token];
  return told === undefined ? address : `${told.symbol} ${address}`;
}

/** What a notice needs beyond the fire: the registry, the agent's address book and the time. */
export interface NoticeContext {
  readonly chains: ChainRegistry;
  readonly addressBook: readonly AddressEntryRecord[];
  readonly assets: AssetInfos;
  readonly nowMs: number;
}

// A wallet as a notice names it: its label in the agent's address book, else its short address.
function walletText(context: NoticeContext, account: AccountRef): string {
  const entry = context.addressBook.find((saved) => saved.account === account);
  return entry?.label ?? shortAddress(addressPartOf(account));
}

function priceNotice(
  condition: PriceCondition,
  context: NoticeContext,
  wholePrice: Ratio,
): NoticePart {
  const values = {
    token: alertTokenText(context.chains, context.assets, condition.asset),
    direction: condition.direction,
    price: priceText({ numerator: condition.price, denominator: 1n }),
    now: priceText(wholePrice),
  };
  return { key: "notice.alertPrice", values };
}

function walletNotice(
  condition: WalletCondition,
  activity: ActivityItem,
  context: NoticeContext,
): NoticePart {
  const { side, valueUsdMicros: value, shareSoldBps: share } = activity;
  const counter = { asset: activity.counterAsset, base: activity.counterAmount };
  const amount = { asset: activity.asset, base: activity.amount };
  return {
    key: "notice.alertWallet",
    values: {
      wallet: walletText(context, condition.account),
      side,
      ...(value === undefined ? {} : { value: plain.usd(value) }),
      share: share === undefined ? "?" : plain.percent(share),
    },
    amounts: value === undefined ? { amount, value: counter } : { amount },
  };
}

// How long ago a launch was made, as a count and its unit: minutes within the hour, hours within
// two days, else days; each language words the unit.
const ageOf = (count: number, unit: string): NoticePart => ({
  key: "launch.age",
  values: { unit, count: String(Math.floor(count)) },
});

function agePart(launchedAtMs: number, nowMs: number): NoticePart {
  const age = Math.max(0, nowMs - launchedAtMs);
  if (age < hourMs) {
    return ageOf(age / minuteMs, "minute");
  }
  return age < 2 * dayMs ? ageOf(age / hourMs, "hour") : ageOf(age / dayMs, "day");
}

/**
 * The launch feed's line for one launch (spec 4, section 4.3): its token, never verified, so its
 * short address follows its symbol; its launchpad, age, curve, tax, insiders and its creator's
 * other launches in 30 days. An unread tax shows as `?`.
 */
function launchLine(launch: LaunchView, context: NoticeContext): NoticePart {
  const progress = launch.curveProgressBps;
  const curve = {
    key: "launch.curve",
    values: {
      graduated: launch.graduated ? "yes" : "no",
      progress: progress === undefined ? "?" : plain.percent(progress),
    },
  };
  return {
    key: "launch.line",
    values: {
      token: alertTokenText(context.chains, context.assets, launch.token),
      launchpad: launch.launchpad,
      tax: launch.taxBps === undefined ? "?" : plain.percent(launch.taxBps),
      insiders: String(launch.insiders.length),
      creatorLaunches: String(launch.creatorLaunches30d),
    },
    parts: { curve, age: agePart(launch.launchedAt, context.nowMs) },
  };
}

/**
 * The notice of one fire (spec 4, section 4.3): the price alert's level and the price now, the
 * wallet's trade, or the launch's line; followed by `alert.woke` when it started a turn and
 * `alert.wakeSkipped` when the hourly limit held wake-ups back since the agent's last one.
 */
export function alertNotice(
  fire: {
    readonly alert: AlertRecord;
    readonly fired: AlertFire;
    readonly agentName: string;
    readonly woke: boolean;
    readonly wakeSkipped?: number;
  },
  context: NoticeContext,
): Notice {
  const { alert, fired, agentName, woke, wakeSkipped } = fire;
  const agent = { agent: agentName };
  const after: NoticePart[] = [
    ...(woke ? [{ key: "alert.woke", values: agent }] : []),
    ...(wakeSkipped === undefined
      ? []
      : [{ key: "alert.wakeSkipped", values: { ...agent, count: String(wakeSkipped) } }]),
  ];
  const assets = Object.keys(context.assets).length === 0 ? {} : { assets: context.assets };
  const own = { agent: alert.agentId, ...assets, ...(after.length === 0 ? {} : { after }) };
  return { ...bodyOf(alert.condition, fired, context), ...own };
}

// What fired the alert, in the words of its kind.
function bodyOf(condition: AlertCondition, fired: AlertFire, context: NoticeContext): NoticePart {
  if (fired.kind === "price" && condition.kind === "price") {
    const wholePrice = { numerator: fired.priceUsdMicros, denominator: 1n };
    return priceNotice(condition, context, wholePrice);
  }
  if (fired.kind === "wallet" && condition.kind === "wallet") {
    return walletNotice(condition, fired.activity, context);
  }
  if (fired.kind !== "launch") {
    throw new BinferenceError({
      code: "engine.alert_fire_kind",
      message: `A ${fired.kind} fire reached a ${condition.kind} alert.`,
    });
  }
  return {
    key: "notice.alertLaunch",
    values: {},
    parts: { launch: launchLine(fired.launch, context) },
  };
}
