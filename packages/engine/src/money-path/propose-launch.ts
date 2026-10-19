import type { LaunchQuote, TxDraft } from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type { LaunchTokenRequest, ProtocolErrorCode } from "@binference/protocol";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { planDocument } from "../intents/intent-documents.schema.js";
import type { QuoteFailure } from "../intents/intent-reason.js";
import {
  type LaunchImage,
  type TokenLaunchQuote,
  tokenLaunchQuoteDocument,
} from "../intents/token-launch-quote.js";
import type { PolicyPass, PolicyVerdict } from "../policy/check-policy.js";
import { minOutFloor } from "../venues/build-checks.js";
import { type AdvanceParts, advanceIntent } from "./advance-intent.js";
import type { Proposer } from "./create-money-path.js";
import { followLaunchPin } from "./follow-launch-pin.js";
import { launchImageOf } from "./launch-image.js";
import { launchSubjectOf } from "./launch-policy.js";
import { policyFactsOf } from "./policy-facts-of.js";
import {
  hostedLaunchOf,
  type LaunchPathOptions,
  type ResolvedLaunch,
  resolveLaunch,
} from "./resolve-launch.js";
import { nativeAssetOf } from "./resolve-proposal.js";
import { startProposal, storeProposed } from "./store-proposed.js";

/** One launch the money path runs: its ports, what moves its intent, and the resolved launch. */
interface LaunchRun {
  readonly options: LaunchPathOptions;
  readonly parts: AdvanceParts;
  readonly resolved: ResolvedLaunch;
  /** The credential the owner proposed with, whose upload the picture must be. */
  readonly credential: string | undefined;
  readonly signal: AbortSignal;
}

/** The owner's launch proposal, and the credential the owner proposed with. */
export interface LaunchProposal {
  readonly request: LaunchTokenRequest;
  readonly proposer: Proposer;
  /** Absent, no upload is the proposer's and the launch reads no picture. */
  readonly credential: string | undefined;
}

// The pin wait of decision 0234: 5 minutes after the upload.
const pinWaitMs = 300_000;

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

// The picture, read once: its bytes and what the quote keeps of it, else `undefined`. An upload
// another credential made is read as none (decision 0236).
async function readImage(
  run: LaunchRun,
): Promise<{ readonly bytes: Readonly<Uint8Array>; readonly image: LaunchImage } | undefined> {
  const { images } = run.options.launch;
  const uploaded = run.resolved.request.image;
  const isOwn = run.credential !== undefined && images?.holderOf(uploaded) === run.credential;
  const read =
    images === undefined || !isOwn
      ? undefined
      : await images.read(uploaded, { signal: run.signal });
  const image = read?.ok === true ? launchImageOf(read.value) : undefined;
  return read?.ok === true && image !== undefined ? { bytes: read.value, image } : undefined;
}

/** What the launch stores once built: its quote document and its plan's drafts. */
interface Built {
  readonly quote: TokenLaunchQuote;
  readonly drafts: readonly TxDraft[];
}

// The launchpad uploads the words and the picture and asks for the pin; the launch is built
// against the metadata address it got back (decision 0234).
async function pinAndBuild(
  run: LaunchRun,
  quoted: Quoted,
  picture: { readonly bytes: Readonly<Uint8Array>; readonly image: LaunchImage },
): Promise<Result<Built, QuoteFailure>> {
  const { options, resolved, signal } = run;
  const { request } = resolved;
  const { host } = options.launch;
  const hosted = hostedLaunchOf(resolved);
  const { image } = picture;
  const words = wordsOf(request, { contentType: image.contentType, bytes: picture.bytes });
  const pin = await host.pin(hosted, words, { signal });
  if (!pin.ok) {
    return pin;
  }
  const firstBuy = firstBuyOf(run, quoted.quote);
  const { metadataUri } = pin.value;
  const minOut = firstBuy === undefined ? {} : { minOutBase: firstBuy.minOut };
  const plan = await host.build(
    hosted,
    { quote: quoted.quote, metadataUri, ...minOut },
    { signal },
  );
  if (!plan.ok) {
    return err(plan.error);
  }
  const nowMs = options.clock.now();
  const quote: TokenLaunchQuote = {
    venue: request.venue,
    settings: resolved.launchSettings,
    token: plan.value.launch.token,
    tokenDecimals: quoted.quote.tokenDecimals,
    fee: quoted.quote.fee,
    ...(firstBuy === undefined ? {} : { firstBuy }),
    image,
    metadataUri,
    pin: pin.value.pin,
    pinWaitUntilMs: nowMs + (options.launch.pinWaitMs ?? pinWaitMs),
    quotedAtMs: nowMs,
  };
  return ok({ quote, drafts: plan.value.steps.map((step) => step.draft) });
}

// The picture is read once, uploaded with the words, pinned and built on; the launch then waits
// in `quoted` for its pin.
async function upload(run: LaunchRun, quoted: Quoted): Promise<IntentSnapshot> {
  const picture = await readImage(run);
  if (picture === undefined) {
    return failQuote(run, quoted.checked, "image_unreadable");
  }
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

function wordsOf(
  request: LaunchTokenRequest,
  image: { readonly contentType: string; readonly bytes: Readonly<Uint8Array> },
) {
  const { description, links } = request;
  return {
    image,
    ...(description === undefined ? {} : { description }),
    ...(links === undefined ? {} : { links }),
  };
}

// A paper launch is refused by the policy with nothing read; a live one is quoted first, so the
// policy judges its fee too, and then runs from the launch wallet alone (decision 0234).
async function runLaunch(run: LaunchRun, proposed: IntentSnapshot): Promise<IntentSnapshot> {
  const { resolved, options, signal } = run;
  const quote = resolved.isPaper
    ? undefined
    : await options.launch.host.quote(hostedLaunchOf(resolved), { signal });
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
  const quoted = await upload(run, { checked, quote: quote.value, pass: verdict.value });
  return quoted.record.state === "quoted" ? followLaunchPin(options, quoted, signal) : quoted;
}

/**
 * Proposes the owner's token launch (decision 0234): it is resolved and stored, refused by the
 * policy in paper mode, and else quoted by its launchpad, judged by the policy, checked to run
 * from the agent's launch wallet, its picture read from an upload the proposer made (decision
 * 0236), uploaded and pinned, and built. It answers once the
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
