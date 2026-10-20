import type { LaunchQuote, TxDraft } from "@binference/chain";
import { err, type Id, ok, type Result } from "@binference/core";
import type { LaunchTokenRequest, ProtocolErrorCode } from "@binference/protocol";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { planDocument } from "../intents/intent-documents.schema.js";
import type { QuoteFailure } from "../intents/intent-reason.js";
import { type TokenLaunchQuote, tokenLaunchQuoteDocument } from "../intents/token-launch-quote.js";
import { statesBeforeSigning } from "../intents/transition-table.js";
import { callsOutsideCeiling } from "../limits/limit-ceiling.js";
import type { PolicyPass, PolicyVerdict } from "../policy/check-policy.js";
import { minOutFloor } from "../venues/build-checks.js";
import type { LaunchUpload } from "../venues/launch-calls.js";
import type { LaunchSetting } from "../venues/launch-settings.schema.js";
import { advanceIntent } from "./advance-intent.js";
import type { Proposer } from "./create-money-path.js";
import { followLaunchPin } from "./follow-launch-pin.js";
import { pinWaitOf, toldIfEnded } from "./launch-ending.js";
import { writtenPictureFit } from "./launch-image.js";
import { launchSubjectOf } from "./launch-policy.js";
import { type LaunchRun, quotedRunOf } from "./launch-run.js";
import { type ReadPicture, readOwnPicture, uploadPicture } from "./launch-upload.js";
import { liveIntentsIn } from "./live-intents.js";
import { policyFactsOf } from "./policy-facts-of.js";
import {
  hostedLaunchOf,
  type LaunchPathOptions,
  namesOwnWallet,
  resolveLaunch,
} from "./resolve-launch.js";
import { nativeAssetOf } from "./resolve-proposal.js";
import { startProposal, storeProposed } from "./store-proposed.js";

/** The owner's launch proposal, and the credential the owner proposed with. */
export interface LaunchProposal {
  readonly request: LaunchTokenRequest;
  readonly proposer: Proposer;
  /** Absent, no upload is the proposer's and the launch reads no picture. */
  readonly credential: string | undefined;
}

async function failQuote(
  run: LaunchRun,
  snapshot: IntentSnapshot,
  reason: QuoteFailure,
): Promise<IntentSnapshot> {
  return advanceIntent(run.parts, snapshot, { trigger: { type: "quote_failed", reason } });
}

// The policy judges the launch with its fee once the launchpad quoted it (decision 0234).
async function policyVerdict(
  run: LaunchRun,
  status: IntentSnapshot["stored"]["status"],
  quote: Result<LaunchQuote, string> | undefined,
): Promise<PolicyVerdict> {
  const { resolved, options, signal } = run;
  const { request, chain, settings, facts } = resolved;
  const fee = quote?.ok === true ? quote.value.fee : undefined;
  const policyFacts = policyFactsOf({
    settings,
    wallet: facts,
    chain: chain.ref,
    chains: options.chains,
    nativeAsset: nativeAssetOf(chain),
    nowMs: options.clock.now(),
  });
  return options.policy.check(launchSubjectOf(request, fee, status), policyFacts, { signal });
}

/** What the upload stage reads: the checked intent, its launchpad's quote and the policy's pass. */
interface Quoted {
  readonly checked: IntentSnapshot;
  readonly quote: LaunchQuote;
  readonly pass: PolicyPass;
}

// The first buy's terms: its spend, the quote's output, and that less the slippage the policy
// allows for a token no registry lists.
function firstBuyOf(run: LaunchRun, quote: LaunchQuote) {
  const { firstBuy } = run.resolved.request;
  const expectedOut = quote.firstBuyOut;
  if (firstBuy === undefined || expectedOut === undefined) {
    return undefined;
  }
  const slippage = run.resolved.settings.limits.slippageOtherBps;
  return { spend: firstBuy, expectedOut, minOut: minOutFloor(expectedOut, slippage) };
}

/** What the launch stores once built: its quote document and its plan's drafts. */
interface Built {
  readonly quote: TokenLaunchQuote;
  readonly drafts: readonly TxDraft[];
}

// Whether a setting the launchpad worked out, or the request gave, names one of the install's own
// wallets where the launchpad pays only on a claim (decision 0277).
async function namesOwnWalletIn(
  run: LaunchRun,
  settings: readonly LaunchSetting[],
): Promise<boolean> {
  const { options, resolved, signal } = run;
  return namesOwnWallet(options, { request: resolved.request, settings, signal });
}

// The launch's settings with what its build worked out, in the order the launchpad declares them.
function withBuilt(run: LaunchRun, built: readonly LaunchSetting[]): readonly LaunchSetting[] {
  const { resolved } = run;
  const order = run.options.launch.host
    .launchOptions(resolved.request.venue)
    .map(({ name }) => name);
  return [...resolved.launchSettings, ...built].toSorted(
    (one, two) => order.indexOf(one.name) - order.indexOf(two.name),
  );
}

/** What the build gets of the picture, and what the launch's quote keeps of it. */
interface PictureStep {
  readonly build: Pick<LaunchUpload, "metadataUri" | "picture">;
  readonly kept: Pick<TokenLaunchQuote, "image" | "metadataUri" | "pin">;
}

// A launchpad that writes the picture into its create call gets its bytes and uploads nothing
// (decision 0279); one that uploads gets the metadata address and the pin its upload gave
// (decision 0234); one that takes a link gets neither (decision 0276).
async function pictureStepOf(
  run: LaunchRun,
  picture: ReadPicture | undefined,
): Promise<Result<PictureStep, QuoteFailure>> {
  const { options, resolved, signal } = run;
  if (picture === undefined) {
    return ok({ build: {}, kept: {} });
  }
  const { image, bytes } = picture;
  if (options.launch.host.picturePlace(resolved.request.venue) === "create_call") {
    return ok({ build: { picture: { contentType: image.contentType, bytes } }, kept: { image } });
  }
  const sent = await uploadPicture(options, { hosted: hostedLaunchOf(resolved), picture }, signal);
  return sent.ok ? ok({ build: { metadataUri: sent.value.metadataUri }, kept: sent.value }) : sent;
}

// The launch is built against what its picture step gave, and waits for its pin only when it
// uploaded (decisions 0234, 0276 and 0279).
async function pinAndBuild(
  run: LaunchRun,
  quoted: Quoted,
  picture: ReadPicture | undefined,
): Promise<Result<Built, QuoteFailure>> {
  const { options, resolved, signal } = run;
  const { request } = resolved;
  const pictured = await pictureStepOf(run, picture);
  if (!pictured.ok) {
    return pictured;
  }
  const firstBuy = firstBuyOf(run, quoted.quote);
  const minOut = firstBuy === undefined ? {} : { minOutBase: firstBuy.minOut };
  const plan = await options.launch.host.build(
    hostedLaunchOf(resolved),
    { quote: quoted.quote, ...pictured.value.build, ...minOut },
    { signal },
  );
  if (!plan.ok) {
    return err(plan.error);
  }
  const settings = withBuilt(run, plan.value.settings ?? []);
  if (await namesOwnWalletIn(run, settings)) {
    return err("own_wallet_recipient");
  }
  const nowMs = options.clock.now();
  const unbound = plan.value.isFirstBuyUnbound === true ? { isUnbound: true as const } : {};
  const { kept } = pictured.value;
  const warnings = options.launch.host.cardWarnings(request.venue);
  const quote: TokenLaunchQuote = {
    venue: request.venue,
    settings,
    token: plan.value.launch.token,
    tokenDecimals: quoted.quote.tokenDecimals,
    fee: quoted.quote.fee,
    ...(firstBuy === undefined ? {} : { firstBuy: { ...firstBuy, ...unbound } }),
    ...kept,
    pinWaitUntilMs: nowMs + (kept.pin === undefined ? 0 : pinWaitOf(options)),
    quotedAtMs: nowMs,
    ...(warnings.length === 0 ? {} : { warnings }),
  };
  return ok({ quote, drafts: plan.value.steps.map((step) => step.draft) });
}

// The launch is uploaded with its words, pinned and built on, and waits in `quoted` for its pin.
async function uploadAndBuild(
  run: LaunchRun,
  quoted: Quoted,
  picture: ReadPicture | undefined,
): Promise<IntentSnapshot> {
  const built = await pinAndBuild(run, quoted, picture);
  if (!built.ok) {
    return failQuote(run, quoted.checked, built.error);
  }
  const { quote, drafts } = built.value;
  const { figures } = quoted.pass;
  const fields = {
    quote: tokenLaunchQuoteDocument.encode(quote),
    plan: planDocument.encode(drafts),
    ...(figures === undefined ? {} : { valueUsdMicros: figures.valueUsdMicros }),
  };
  const trigger = { type: "quote_built", quote: { quotedAtMs: quote.quotedAtMs } } as const;
  return advanceIntent(run.parts, quoted.checked, { trigger, fields });
}

// How long the end of a launch whose upload a fault or a stop cut short may take.
const loseTimeoutMs = 5_000;

// A fault or a stop once the upload began ends the launch `upload_lost` at once, with the
// owner's notice (decision 0237), on a signal of its own: the proposal's may be the one that
// stopped. If this fails too, the startup's repair or the pin follow ends it.
async function loseUpload(run: LaunchRun, checked: IntentSnapshot): Promise<void> {
  const signal = AbortSignal.timeout(loseTimeoutMs);
  const now = await run.options.stored.snapshot(checked.record.id, { signal });
  if (now?.record.state !== "checked") {
    return;
  }
  const trigger = { type: "quote_failed", reason: "upload_lost" } as const;
  toldIfEnded(run.options, await advanceIntent({ ...run.parts, signal }, now, { trigger }));
}

// The picture a launch reads, once, from the owner's upload: none for a launchpad that takes a link
// (decision 0276). One a launchpad writes into its create call must fit beside the words and tell
// its size, at most 1,024 pixels each way (decision 0279).
async function pictureOf(run: LaunchRun): Promise<Result<ReadPicture | undefined, QuoteFailure>> {
  const { options, resolved, credential, signal } = run;
  const { request } = resolved;
  const { host } = options.launch;
  const place = host.picturePlace(request.venue);
  if (place === "link") {
    return ok(undefined);
  }
  const asked = { upload: request.image, credential };
  const picture = await readOwnPicture(options, asked, signal);
  if (picture === undefined) {
    return err("image_unreadable");
  }
  if (place !== "create_call") {
    return ok(picture);
  }
  const fit = writtenPictureFit(picture.image, host.pictureBytesFor(request.venue, request) ?? 0);
  if (fit === "unsized") {
    return err("image_unreadable");
  }
  return fit === "too_large" ? err("picture_too_large") : ok(picture);
}

// Once its upload begins, the owner hears of any end before the pin wait (decision 0237).
async function upload(run: LaunchRun, quoted: Quoted): Promise<IntentSnapshot> {
  const picture = await pictureOf(run);
  if (!picture.ok) {
    return failQuote(run, quoted.checked, picture.error);
  }
  try {
    return toldIfEnded(run.options, await uploadAndBuild(run, quoted, picture.value));
  } catch (fault) {
    await loseUpload(run, quoted.checked).catch(() => undefined);
    throw fault;
  }
}

// Whether the launch wallet's ceiling, as last read back, lacks a call only a launch wallet makes
// on the launchpad, such as its create call: custody would refuse the signature after the upload
// and the card (decision 0271). A wallet the install no longer lists lacks every one.
async function isCeilingLacking(run: LaunchRun): Promise<boolean> {
  const { options, resolved, signal } = run;
  const calls = options.launch.host.launchWalletCalls(resolved.request.venue);
  const install = await options.install?.read({ signal });
  const wallet = install?.wallets.find((item) => item.id === resolved.wallet);
  return wallet === undefined ? calls.length > 0 : callsOutsideCeiling(wallet, calls).length > 0;
}

// A paper launch is refused by the policy with nothing read; a live one is quoted first, so the
// policy judges its fee too, and then runs from the launch wallet alone (decision 0234).
async function runLaunch(given: LaunchRun, proposed: IntentSnapshot): Promise<IntentSnapshot> {
  const { run, quote } = await quotedRunOf(given);
  const { resolved, options, signal } = run;
  const verdict = await policyVerdict(run, proposed.stored.status, quote);
  if (!verdict.ok) {
    const refused = { type: "policy_refused", reason: verdict.error } as const;
    return advanceIntent(run.parts, proposed, { trigger: refused });
  }
  const checked = await advanceIntent(run.parts, proposed, { trigger: { type: "policy_passed" } });
  if (checked.record.state !== "checked") {
    return checked;
  }
  if (!resolved.isLaunchWallet || quote === undefined) {
    return failQuote(run, checked, "needs_launch_wallet");
  }
  if (!quote.ok) {
    return failQuote(run, checked, quote.error);
  }
  if (await isCeilingLacking(run)) {
    return failQuote(run, checked, "ceiling_lacks_call");
  }
  if (await namesOwnWalletIn(run, run.resolved.launchSettings)) {
    return failQuote(run, checked, "own_wallet_recipient");
  }
  const quoted = await upload(run, { checked, quote: quote.value, pass: verdict.value });
  if (quoted.record.state !== "quoted") {
    return quoted;
  }
  // A first follow that fails leaves the launch where it got to, and the timer follows it on.
  return followLaunchPin(options, quoted, { signal }).catch(async () => {
    const now = await options.stored.snapshot(quoted.record.id, { signal }).catch(() => undefined);
    return now ?? quoted;
  });
}

/**
 * Whether a launch of the agent is under way, from its proposal until it is signed or ends: one
 * launch of an agent runs at a time, so each proposal's upload waits for the last to settle
 * (decision 0240).
 */
export async function hasLaunchUnderWay(
  options: LaunchPathOptions,
  agentId: Id<"agt">,
  signal: AbortSignal,
): Promise<boolean> {
  const query = { states: statesBeforeSigning, agentId };
  const live = await liveIntentsIn(options.stored, query, signal);
  return live.some((record) => record.kind === "launchToken");
}

/**
 * Proposes the owner's token launch (decision 0234): it is resolved and stored, refused by the
 * policy in paper mode, and else quoted by its launchpad, judged by the policy, checked to run
 * from the agent's launch wallet, its picture read from an upload the proposer made (decision
 * 0236), uploaded and pinned, and built. While another launch of the agent is under way, before
 * it is signed or ends, it is `intent.launch_waiting` and nothing is stored (decision 0240). It answers once the
 * launch waits in `quoted` for its pin, or has passed it to its card, or ended.
 */
export async function proposeLaunch(
  options: LaunchPathOptions,
  call: LaunchProposal,
  signal: AbortSignal,
): Promise<Result<IntentSnapshot, ProtocolErrorCode>> {
  const { request, proposer, credential } = call;
  const started = await startProposal(options, call, signal);
  if (!started.ok) {
    return started;
  }
  const { machine, settings, proposal, step } = started.value;
  if (await hasLaunchUnderWay(options, settings.agent.id, signal)) {
    return err("intent.launch_waiting");
  }
  const resolving = { request, settings, isPaper: proposal.isPaper, signal };
  const resolved = await resolveLaunch(options, resolving);
  if (!resolved.ok) {
    return resolved;
  }
  const intent = { request, proposer, step, wallet: resolved.value.wallet, assets: {} };
  const created = await storeProposed(options, intent, signal);
  const parts = { stored: options.stored, machine, signal };
  const run = { options, parts, resolved: resolved.value, credential, signal };
  return ok(await runLaunch(run, created));
}
