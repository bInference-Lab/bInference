import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { accountRefParts } from "../caip/account-ref.js";
import { assetRefParts } from "../caip/asset-ref.js";
import type { TxDraft } from "../transaction.js";
import { type LaunchOptionValue, launchOptionsSchema } from "../venues/launch-option.js";
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
import { writtenWordsOf } from "../venues/launch-words.js";
import type { Launcher } from "../venues/ports.js";

/** A launchpad's launcher under test, a launch it takes and one it does not. */
export interface LauncherSubject {
  readonly launcher: Launcher;
  /**
   * A launch with a first buy, against a pair the launchpad launches against, with a value of
   * every setting the launchpad declares: an `account` as its canonical account id.
   */
  readonly launch: LaunchPinRequest;
  /** Another value of every setting the launchpad declares, each unlike the launch's. */
  readonly otherOptions: Readonly<Record<string, LaunchOptionValue>>;
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
async function built(
  subject: LauncherSubject,
  launch: LaunchPinRequest = subject.launch,
): Promise<BuiltLaunch> {
  const { launcher } = subject;
  const quote = await quoted(launcher, launch);
  const pin = await launcher.pin?.(launch, { signal: live() });
  const minOut = quote.firstBuyOut === undefined ? {} : { firstBuyMinOut: quote.firstBuyOut };
  const metadata = pin === undefined ? {} : { metadataUri: pin.metadataUri };
  const { image: _image, ...terms } = launch;
  const request = { ...terms, ...metadata, fee: quote.fee, ...minOut };
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
    name: "pins an upload and says where its pin stands, or has neither",
    run: async () => {
      const { launcher, launch } = harness.create();
      const pin = await launcher.pin?.(launch, { signal: live() });
      assert.equal(pin === undefined, launcher.pinStatus === undefined);
      if (pin !== undefined) {
        assert.ok(launchPinSchema.safeParse(pin).success);
        const status = await launcher.pinStatus?.(pin.pin, { signal: live() });
        assert.ok(pinStatusSchema.safeParse(status).success);
      }
    },
  };
}

// A first buy keeps its minimum in the create call, or, from a launcher that declares it carries
// none, reads back with a minimum of 0: a decoder never names a minimum the bytes do not hold.
function checkMinOut(launcher: Launcher, minOut: bigint, request: LaunchBuildRequest): void {
  if (launcher.noFirstBuyMin === true) {
    assert.equal(minOut, 0n);
  } else {
    assert.ok(minOut >= (request.firstBuyMinOut ?? 0n));
  }
}

// The create call reads back as the launch it was built for: its token, words, pair, fee and every
// setting, and a first buy for the wallet of its spend, at no less than its minimum. A launcher that
// writes the words on chain names them as the request gives them.
function checkCreate(subject: LauncherSubject, launch: BuiltLaunch): void {
  const { request, build } = launch;
  const create = build.steps.at(-1);
  assert.ok(create !== undefined);
  const decoded = subject.launcher.decodeLaunch(create);
  assert.ok(decoded.ok);
  const { token, name, symbol, metadataUri, pair, feeBase, firstBuy, options } = decoded.value;
  assert.deepEqual(
    { token, name, symbol, metadataUri, pair, feeBase, options },
    {
      token: build.token,
      name: request.name,
      symbol: request.symbol,
      metadataUri: request.metadataUri,
      pair: request.pair,
      feeBase: request.fee.base,
      options: request.options,
    },
  );
  const written = subject.launcher.wordLimits === undefined ? undefined : writtenWordsOf(request);
  assert.deepEqual(decoded.value.words, written);
  assert.deepEqual(firstBuy?.spend, request.firstBuy);
  assert.equal(firstBuy?.recipient, request.wallet);
  checkMinOut(subject.launcher, firstBuy?.minOut ?? 0n, request);
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

function readsSettings(harness: LauncherHarness): ContractCheck {
  return {
    name: "writes other settings into its create call, and reads them back from its bytes",
    run: async () => {
      const subject = harness.create();
      const { launch, otherOptions } = subject;
      const names = subject.launcher.launchOptions.map((option) => option.name).toSorted();
      assert.deepEqual(Object.keys(launch.options).toSorted(), names);
      assert.deepEqual(Object.keys(otherOptions).toSorted(), names);
      assert.ok(names.every((name) => launch.options[name] !== otherOptions[name]));
      checkCreate(subject, await built(subject, { ...launch, options: otherOptions }));
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
      await assert.rejects(launcher.pin?.(launch, { signal }) ?? Promise.reject(reason), reason);
      await assert.rejects(
        launcher.pinStatus?.(null, { signal }) ?? Promise.reject(reason),
        reason,
      );
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
    readsSettings,
    refusesOtherDraft,
    stopsOnAbort,
  ].map((check) => check(harness));
}
