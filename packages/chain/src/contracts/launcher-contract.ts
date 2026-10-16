import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { accountRefParts } from "../caip/account-ref.js";
import { assetRefParts } from "../caip/asset-ref.js";
import type { TxDraft } from "../transaction.js";
import { launchOptionsSchema } from "../venues/launch-option.js";
import {
  type LaunchBuild,
  type LaunchBuildRequest,
  type LaunchPinRequest,
  launchPinSchema,
  type LaunchQuote,
  launchQuoteSchema,
  type LaunchTerms,
  pinStatusSchema,
} from "../venues/launch-terms.js";
import type { Launcher } from "../venues/ports.js";

/** A launchpad's launcher under test, a launch it takes and one it does not. */
export interface LauncherSubject {
  readonly launcher: Launcher;
  /** A launch with a first buy, against a pair the launchpad launches against. */
  readonly launch: LaunchPinRequest;
  /** A launch against a pair the launchpad does not launch against. */
  readonly otherPair: LaunchTerms;
  /** A draft that is no create call of the launchpad. */
  readonly other: TxDraft;
}

/** Makes a fresh {@link LauncherSubject} for each check. */
export interface LauncherHarness {
  create(): LauncherSubject;
}

const live = (): AbortSignal => new AbortController().signal;

async function quoted(launcher: Launcher, terms: LaunchTerms): Promise<LaunchQuote> {
  const quote = await launcher.quoteLaunch(terms, { signal: live() });
  assert.ok(quote.ok);
  return quote.value;
}

/** A launch built from its quote and its upload. */
interface BuiltLaunch {
  readonly request: LaunchBuildRequest;
  readonly build: LaunchBuild;
}

// The launch built from its quote and its upload, with the first buy's minimum at its quoted out.
async function built(subject: LauncherSubject): Promise<BuiltLaunch> {
  const { launcher, launch } = subject;
  const quote = await quoted(launcher, launch);
  const pin = await launcher.pin(launch, { signal: live() });
  const minOut = quote.firstBuyOut === undefined ? {} : { firstBuyMinOut: quote.firstBuyOut };
  const { image: _image, description: _description, links: _links, ...terms } = launch;
  const request = { ...terms, metadataUri: pin.metadataUri, fee: quote.fee, ...minOut };
  return { request, build: await launcher.buildLaunch(request, { signal: live() }) };
}

function declaresSettings(harness: LauncherHarness): ContractCheck {
  return {
    name: "declares its settings, each name once",
    run: async () => {
      const { launcher } = harness.create();
      assert.ok(launchOptionsSchema.safeParse(launcher.launchOptions).success);
      await Promise.resolve();
    },
  };
}

function quotesFee(harness: LauncherHarness): ContractCheck {
  return {
    name: "quotes its fee in its chain's coin, and a first buy's output",
    run: async () => {
      const { launcher, launch } = harness.create();
      const quote = await quoted(launcher, launch);
      assert.ok(launchQuoteSchema.safeEncode(quote).success);
      const chain = accountRefParts(launch.wallet).chain;
      assert.equal(assetRefParts(quote.fee.asset).chain, chain);
      assert.equal(quote.firstBuyOut !== undefined, launch.firstBuy !== undefined);
    },
  };
}

function refusesOtherPair(harness: LauncherHarness): ContractCheck {
  return {
    name: "answers a pair it does not launch against as no route",
    run: async () => {
      const { launcher, otherPair } = harness.create();
      const quote = await launcher.quoteLaunch(otherPair, { signal: live() });
      assert.deepEqual(quote, { ok: false, error: "no_route" });
    },
  };
}

function pinsUpload(harness: LauncherHarness): ContractCheck {
  return {
    name: "pins an upload and says where its pin stands",
    run: async () => {
      const { launcher, launch } = harness.create();
      const pin = await launcher.pin(launch, { signal: live() });
      assert.ok(launchPinSchema.safeParse(pin).success);
      const status = await launcher.pinStatus(pin.pin, { signal: live() });
      assert.ok(pinStatusSchema.safeParse(status).success);
    },
  };
}

// The create call reads back as the launch it was built for: its token, words, pair and fee, and
// a first buy for the wallet of its spend, at no less than its minimum.
function checkCreate(subject: LauncherSubject, launch: BuiltLaunch): void {
  const { request, build } = launch;
  const create = build.steps.at(-1);
  assert.ok(create !== undefined);
  const decoded = subject.launcher.decodeLaunch(create);
  assert.ok(decoded.ok);
  const { token, name, symbol, metadataUri, pair, feeBase, firstBuy } = decoded.value;
  assert.deepEqual(
    { token, name, symbol, metadataUri, pair, feeBase },
    {
      token: build.token,
      name: request.name,
      symbol: request.symbol,
      metadataUri: request.metadataUri,
      pair: request.pair,
      feeBase: request.fee.base,
    },
  );
  assert.deepEqual(firstBuy?.spend, request.firstBuy);
  assert.equal(firstBuy?.recipient, request.wallet);
  assert.ok((firstBuy?.minOut ?? 0n) >= (request.firstBuyMinOut ?? 0n));
}

function buildsCreate(harness: LauncherHarness): ContractCheck {
  return {
    name: "builds steps from the wallet whose create call decodes to the launch",
    run: async () => {
      const subject = harness.create();
      const launch = await built(subject);
      const { request, build } = launch;
      const { chain } = accountRefParts(request.wallet);
      assert.equal(assetRefParts(build.token).chain, chain);
      assert.ok(build.steps.every((step) => step.from === request.wallet));
      checkCreate(subject, launch);
    },
  };
}

function refusesOtherDraft(harness: LauncherHarness): ContractCheck {
  return {
    name: "refuses to decode a draft that is not its create call",
    run: async () => {
      const { launcher, other } = harness.create();
      assert.deepEqual(launcher.decodeLaunch(other), { ok: false, error: "unknown_call" });
      await Promise.resolve();
    },
  };
}

function stopsOnAbort(harness: LauncherHarness): ContractCheck {
  return {
    name: "refuses to quote, pin or read a pin on an aborted signal",
    run: async () => {
      const { launcher, launch } = harness.create();
      const reason = new Error("stopped");
      const signal = AbortSignal.abort(reason);
      await assert.rejects(launcher.quoteLaunch(launch, { signal }), reason);
      await assert.rejects(launcher.pin(launch, { signal }), reason);
      await assert.rejects(launcher.pinStatus(null, { signal }), reason);
    },
  };
}

/** The contract every `Launcher` passes. */
export function launcherContract(harness: LauncherHarness): readonly ContractCheck[] {
  return [
    declaresSettings,
    quotesFee,
    refusesOtherPair,
    pinsUpload,
    buildsCreate,
    refusesOtherDraft,
    stopsOnAbort,
  ].map((check) => check(harness));
}
