import type { TxDraft, TxSimulator } from "@binference/chain";
import { type IdSource, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import { planDocument } from "../intents/intent-documents.schema.js";
import type { SentPayee } from "../intents/send-quote.js";
import { type AdvanceParts, advanceIntent } from "../money-path/advance-intent.js";
import type { Proposer } from "../money-path/create-money-path.js";
import { startProposal, storeProposed } from "../money-path/store-proposed.js";
import { type ReadTokenFacts, unlistedAssetInfos } from "../money-path/token-facts.js";
import type { PolicyPass } from "../policy/check-policy.js";
import type { AgentStore, IntentStore } from "../ports.js";
import { checkTransferPolicy, type TransferPolicyParts } from "./check-transfer-policy.js";
import { advanceBySimulation, advanceByVerdict, runToCard } from "./owner-steps.js";
import { payeeOf } from "./payee-of.js";
import { planTransfer, simulateTransfer, type TransferMove } from "./plan-transfer.js";
import {
  type ResolvedTransfer,
  resolveTransfer,
  type TransferAsk,
  type TransferRequest,
  type TransferResolveOptions,
} from "./resolve-transfer.js";

/** What a send or an approval revoke is resolved, checked, simulated and stored through. */
export interface TransferPathOptions extends TransferResolveOptions, TransferPolicyParts {
  readonly stored: StoredIntents;
  /** The settled intents, which tell whether the agent ever sent to a send's address. */
  readonly intents: Pick<IntentStore, "list">;
  readonly agents: AgentStore;
  /** Runs the step unsent on its chain, live balances only: a paper send never gets this far. */
  readonly simulator: TxSimulator;
  /** Reads what a token the registry does not list answers on chain, for its card. */
  readonly readTokenFacts: ReadTokenFacts;
  /** Whether the engine is locked; a send or a revoke opens its card either way. */
  readonly isLocked: () => boolean;
  readonly ids: IdSource;
}

/** One send's or revoke's run through its steps, and what they read. */
interface TransferRun {
  readonly options: TransferPathOptions;
  readonly advance: AdvanceParts;
  readonly resolved: ResolvedTransfer;
}

// What the step moves, once its target is known; a paper send's unread name has none. A send names
// who it pays only once its policy passed (`payee`).
function moveOf(
  {
    ask,
    account,
    walletRecord,
  }: Pick<ResolvedTransfer, "account" | "walletRecord"> & {
    readonly ask: TransferAsk;
  },
  payee: SentPayee = {},
): TransferMove | undefined {
  if (ask.kind === "revokeApproval") {
    const { token, spender } = ask;
    const wallet = walletRecord === undefined ? {} : { wallet: walletRecord };
    return { kind: "revokeApproval", owner: account, token, spender, ...wallet };
  }
  if (ask.target.kind !== "account") {
    return undefined;
  }
  const transfer = { from: account, to: ask.target.account, amount: ask.amount };
  const { name } = ask.target;
  return name === undefined
    ? { kind: "send", transfer, payee }
    : { kind: "send", transfer, name, payee };
}

// Who a send pays as its card names them; a revoke pays no one.
async function payeeFor(run: TransferRun): Promise<SentPayee> {
  const { resolved, options, advance } = run;
  const { ask, settings, rescueAccount } = resolved;
  if (ask.kind !== "send" || ask.target.kind !== "account") {
    return {};
  }
  const rescue = rescueAccount === undefined ? {} : { rescueAccount };
  const payee = { settings, account: ask.target.account, ...rescue };
  return payeeOf(options.intents, payee, advance.signal);
}

// A name that points to no person ends the send at the resolve step, before the policy; any
// other send or revoke is judged by the policy.
async function judge(
  run: TransferRun,
  proposed: IntentSnapshot,
): Promise<{ readonly snapshot: IntentSnapshot; readonly pass?: PolicyPass }> {
  const { resolved, options, advance } = run;
  const { ask } = resolved;
  if (ask.kind === "send" && ask.target.kind === "refused") {
    const trigger = { type: "name_refused", reason: ask.target.reason } as const;
    return { snapshot: await advanceIntent(advance, proposed, { trigger }) };
  }
  const move = moveOf(resolved);
  const judged = {
    ...resolved,
    status: proposed.stored.status,
    ...(move?.kind === "send" ? { outflow: move.transfer.amount, target: move.transfer.to } : {}),
  };
  const verdict = await checkTransferPolicy(options, judged, advance.signal);
  return advanceByVerdict(advance, proposed, verdict);
}

// The simulation of a quoted send's or revoke's one draft: nothing is bought, so no token risk
// weighs it.
async function simulate(
  run: TransferRun,
  quoted: IntentSnapshot,
  planned: { readonly move: TransferMove; readonly draft: TxDraft },
): Promise<IntentSnapshot> {
  const { options, advance, resolved } = run;
  const assessed =
    quoted.record.state === "quoted"
      ? await advanceIntent(advance, quoted, { trigger: { type: "risk_passed" } })
      : quoted;
  if (assessed.record.state !== "assessed") {
    return assessed;
  }
  const { simulator, clock } = options;
  const parts = { simulator, chain: resolved.chain, nowMs: () => clock.now() };
  const simulation = await simulateTransfer(parts, planned, advance.signal);
  return advanceBySimulation(advance, assessed, simulation);
}

// The step's quote and plan, with the value the caps counted, then its simulation.
async function quoteAndSimulate(
  run: TransferRun,
  checked: IntentSnapshot,
  pass: PolicyPass,
): Promise<IntentSnapshot> {
  const { options, advance, resolved } = run;
  const move = moveOf(resolved, await payeeFor(run));
  const nowMs = options.clock.now();
  const context = { chains: options.chains, nowMs };
  const planned = move === undefined ? undefined : planTransfer(resolved.chain, move, context);
  if (move === undefined || planned?.ok !== true) {
    const reason = planned?.ok === false ? planned.error : "no_route";
    return advanceIntent(advance, checked, { trigger: { type: "quote_failed", reason } });
  }
  const { figures } = pass;
  const fields = {
    quote: planned.value.quote,
    plan: planDocument.encode([planned.value.draft]),
    ...(figures === undefined ? {} : { valueUsdMicros: figures.valueUsdMicros }),
  };
  const trigger = { type: "quote_built", quote: { quotedAtMs: nowMs } } as const;
  const quoted = await advanceIntent(advance, checked, { trigger, fields });
  return simulate(run, quoted, { move, draft: planned.value.draft });
}

// Resolve, policy, quote, simulation, then the card: the auto test leaves every send and every
// revoke to the owner's tap (spec 6, section 5).
async function runTransfer(run: TransferRun, proposed: IntentSnapshot): Promise<IntentSnapshot> {
  return runToCard(run.advance, {
    judge: async () => judge(run, proposed),
    simulate: async (checked, pass) => quoteAndSimulate(run, checked, pass),
    wallet: run.resolved.facts,
    isLocked: run.options.isLocked,
  });
}

/**
 * Proposes a send or an approval revoke (spec 6, section 5): it resolves the wallet and what the
 * request asks, a `.bnb` name through its resolver (decision 0308), stores the intent, ends a name
 * that points to no person `failed_check`, judges it by the policy (the send level, the address
 * book and the caps, and `paper_only` in paper mode), quotes and builds its one step, simulates it
 * and opens its card, which lasts 10 minutes and never passes the auto test. A request that cannot
 * become an intent is a protocol error code and stores nothing.
 */
export async function proposeTransfer(
  options: TransferPathOptions,
  call: { readonly request: TransferRequest; readonly proposer: Proposer },
  signal: AbortSignal,
): Promise<Result<IntentSnapshot, ProtocolErrorCode>> {
  const { request, proposer } = call;
  const started = await startProposal(options, call, signal);
  if (!started.ok) {
    return started;
  }
  const { machine, settings, proposal, step } = started.value;
  const resolving = { request, settings, isPaper: proposal.isPaper, signal };
  const resolved = await resolveTransfer(options, resolving);
  if (!resolved.ok) {
    return resolved;
  }
  const { ask } = resolved.value;
  const moved = ask.kind === "send" ? ask.amount.asset : ask.token;
  const assets = await unlistedAssetInfos(options, [moved], signal);
  if (!assets.ok) {
    return assets;
  }
  const intent = { request, proposer, step, wallet: resolved.value.wallet, assets: assets.value };
  const created = await storeProposed(options, intent, signal);
  const advance = { stored: options.stored, machine, signal };
  return ok(await runTransfer({ options, advance, resolved: resolved.value }, created));
}
