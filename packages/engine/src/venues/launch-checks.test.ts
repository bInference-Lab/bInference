import {
  accountRefSchema,
  assetRefSchema,
  type DecodedLaunch,
  type TxDraft,
  writtenWordsOf,
} from "@binference/chain";
import {
  createFakeFamily,
  createFakeLauncher,
  fakeDraft,
  fakeLaunchData,
} from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { checkLaunchSteps, type LaunchBounds, readLaunchSteps } from "./launch-checks.js";

const wallet = accountRefSchema.parse("fake:1:0x0000000c");
const router = accountRefSchema.parse("fake:1:0x0000000d");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const usd = assetRefSchema.parse("fake:1/token:0x0000000a");
const token = assetRefSchema.parse("fake:1/token:0x000000e1");
const family = createFakeFamily();
const readers = { family, launcher: createFakeLauncher() };

const bounds: LaunchBounds = {
  wallet,
  contracts: [router],
  nativeAsset: coin,
  name: "Moon Cat",
  symbol: "MCAT",
  pair: coin,
  metadataUri: "ipfs://fake-1",
  words: writtenWordsOf({}),
  mustWriteWords: false,
  fee: { asset: coin, base: 2_000n },
  firstBuy: { asset: coin, base: 50n },
  options: { taxBps: 300, taxRecipient: wallet, buyback: true },
  minOutBase: 49_500n,
  token,
  family,
};

const buy = { spend: { asset: coin, base: 50n }, minOut: 49_500n, recipient: wallet };

const create: DecodedLaunch = {
  token,
  name: bounds.name,
  symbol: bounds.symbol,
  metadataUri: bounds.metadataUri,
  pair: coin,
  feeBase: 2_000n,
  firstBuy: buy,
  options: bounds.options,
};

// Reads the drafts as the host does, then checks them against the launch's bounds.
function checkDrafts(drafts: readonly TxDraft[], launchBounds: LaunchBounds = bounds) {
  const steps = readLaunchSteps(drafts, readers);
  return steps.ok ? checkLaunchSteps(steps.value, launchBounds) : steps;
}

/** One create call to check: its launch, its value, an approval before it, where it goes. */
interface Built {
  readonly launch: DecodedLaunch;
  readonly value: bigint;
  readonly approval?: string;
  readonly to?: string;
}

// The create call to the router, after an approval of the registry's token when one is given.
function checked(built: Built) {
  const { launch, value, approval, to = "0x0000000d" } = built;
  const before =
    approval === undefined
      ? []
      : [fakeDraft(wallet, { to: "0x0000000a", value: 0n, data: approval })];
  return checkDrafts([...before, fakeDraft(wallet, { to, value, data: fakeLaunchData(launch) })]);
}

const other = accountRefSchema.parse("fake:1:0x000000ff");

/** A create call the checks refuse, and the check that refuses it. */
interface Refusal extends Built {
  readonly name: string;
  readonly error: string;
}

const refusals: readonly Refusal[] = [
  {
    name: "another name",
    launch: { ...create, name: "Rug" },
    value: 2_050n,
    error: "other_launch",
  },
  {
    name: "another metadata address",
    launch: { ...create, metadataUri: "ipfs://x" },
    value: 2_050n,
    error: "other_launch",
  },
  {
    name: "an unnamed token",
    launch: { ...create, token: usd },
    value: 2_050n,
    error: "other_launch",
  },
  {
    name: "a bigger fee",
    launch: { ...create, feeBase: 9_000n },
    value: 9_050n,
    error: "other_launch",
  },
  {
    name: "another tax",
    launch: { ...create, options: { ...bounds.options, taxBps: 1_000 } },
    value: 2_050n,
    error: "other_settings",
  },
  {
    name: "another tax recipient",
    launch: { ...create, options: { ...bounds.options, taxRecipient: other } },
    value: 2_050n,
    error: "other_settings",
  },
  {
    name: "buyback turned off",
    launch: { ...create, options: { ...bounds.options, buyback: false } },
    value: 2_050n,
    error: "other_settings",
  },
  {
    name: "a setting left out",
    launch: { ...create, options: { taxBps: 300, taxRecipient: wallet } },
    value: 2_050n,
    error: "other_settings",
  },
  {
    name: "a setting the card does not show",
    launch: { ...create, options: { ...bounds.options, burnBps: 50 } },
    value: 2_050n,
    error: "other_settings",
  },
  {
    name: "a tax given as text",
    launch: { ...create, options: { ...bounds.options, taxBps: "300" } },
    value: 2_050n,
    error: "other_settings",
  },
  { name: "a bigger value", launch: create, value: 9_050n, error: "other_amount" },
  {
    name: "a first buy for another wallet",
    launch: { ...create, firstBuy: { ...buy, recipient: other } },
    value: 2_050n,
    error: "other_recipient",
  },
  {
    name: "a bigger first buy",
    launch: { ...create, firstBuy: { ...buy, spend: { asset: coin, base: 60n } } },
    value: 2_060n,
    error: "other_amount",
  },
  {
    name: "a first buy below its minimum",
    launch: { ...create, firstBuy: { ...buy, minOut: 1n } },
    value: 2_050n,
    error: "low_min_out",
  },
  {
    name: "an approval nobody asked for",
    launch: create,
    value: 2_050n,
    approval: "approve,0x0000000d,50",
    error: "other_approval",
  },
  {
    name: "a call to an undeclared contract",
    launch: create,
    value: 2_050n,
    to: "0x000000ee",
    error: "undeclared_contract",
  },
];

describe("the build checks of a token launch", () => {
  it("pass a create call that pays the fee and buys for the wallet", () => {
    expect(checked({ launch: create, value: 2_050n })).toStrictEqual({ ok: true, value: create });
  });

  it("pass an exact approval of a token first buy before its create call", () => {
    const usdBuy = { asset: usd, base: 7n };
    const launch = { ...create, pair: usd, firstBuy: { ...buy, spend: usdBuy } };
    const drafts = [
      fakeDraft(wallet, { to: "0x0000000a", value: 0n, data: "approve,0x0000000d,7" }),
      fakeDraft(wallet, { to: "0x0000000d", value: 2_000n, data: fakeLaunchData(launch) }),
    ];
    const tokenBounds = { ...bounds, pair: usd, firstBuy: usdBuy };
    expect(checkDrafts(drafts, tokenBounds)).toMatchObject({ ok: true });
  });

  it.each(refusals)("refuse a create call with $name", (row) => {
    expect(checked(row)).toStrictEqual({ ok: false, error: row.error });
  });

  it("refuse a step from another wallet, and two create calls", () => {
    const data = fakeLaunchData(create);
    const call = { to: "0x0000000d", value: 2_050n, data };
    expect(checkDrafts([fakeDraft(other, call)])).toMatchObject({ error: "other_sender" });
    expect(checkDrafts([fakeDraft(wallet, call), fakeDraft(wallet, call)])).toMatchObject({
      error: "step_order",
    });
  });
  it("pass a first buy with no minimum when the launcher declares it carries none", () => {
    const unbound = { ...create, firstBuy: { ...buy, minOut: 0n } };
    const drafts = [
      fakeDraft(wallet, { to: "0x0000000d", value: 2_050n, data: fakeLaunchData(unbound) }),
    ];
    expect(checkDrafts(drafts, { ...bounds, noFirstBuyMin: true })).toStrictEqual({
      ok: true,
      value: unbound,
    });
    expect(checkDrafts(drafts)).toStrictEqual({ ok: false, error: "low_min_out" });
  });

  it("refuse a draft the launchpad's decoder cannot read", () => {
    const swap = fakeDraft(wallet, { to: "0x0000000d", value: 0n, data: "swap" });
    expect(readLaunchSteps([swap], readers)).toStrictEqual({ ok: false, error: "unreadable_step" });
  });
});

describe("the build checks of a launch whose words go on chain", () => {
  const written = {
    description: "A cat",
    links: { website: "https://cat.example", x: "", telegram: "" },
  };
  const onChain: LaunchBounds = { ...bounds, words: written, mustWriteWords: true };
  const check = (launch: DecodedLaunch) =>
    checkDrafts(
      [fakeDraft(wallet, { to: "0x0000000d", value: 2_050n, data: fakeLaunchData(launch) })],
      onChain,
    );

  it("passes a create call that writes the card's description and links", () => {
    expect(check({ ...create, words: written })).toMatchObject({ ok: true });
  });

  it("refuses a create call that writes another description", () => {
    const words = { ...written, description: "A dog" };
    expect(check({ ...create, words })).toStrictEqual({ ok: false, error: "other_launch" });
  });

  it("refuses a create call that moves a link to another site", () => {
    const links = { website: "", x: "https://cat.example", telegram: "" };
    expect(check({ ...create, words: { ...written, links } })).toStrictEqual({
      ok: false,
      error: "other_launch",
    });
  });

  it("refuses a create call that names no words from a launchpad that writes them", () => {
    expect(check(create)).toStrictEqual({ ok: false, error: "other_launch" });
  });
});
