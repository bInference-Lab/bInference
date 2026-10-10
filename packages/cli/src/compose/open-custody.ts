import type { ChainRef, ChainRegistry, Signer, VenueDeclaration } from "@binference/chain";
import {
  BinferenceError,
  type Clock,
  err,
  type Http,
  type Id,
  type Logger,
  ok,
  type Result,
  type Secret,
} from "@binference/core";
import {
  type CeilingChain,
  checkPrivyApp,
  createPrivyApi,
  createPrivyOwnerSigner,
  isPrivyId,
  privyApiOrigin,
  type PrivyWallet,
  registryCeilingChain,
} from "@binference/custody-privy";
import type {
  CeilingCalls,
  CeilingEditor,
  InstallFacts,
  InstallStore,
  WalletMaker,
  WalletRecord,
} from "@binference/engine/install";
import type { SignerRefusalNotice, SignerSettings } from "@binference/signer";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { ceilingRequestOf } from "../init/ceiling-request.js";
import type { LockReason, UnlockedKeys } from "../unlock/unlock-keys.js";
import { gweiToWei } from "./compose-executor.js";
import { createPrivyCeilingEditor } from "./privy-ceiling-editor.js";
import { createPrivyWalletMaker } from "./privy-wallet-maker.js";
import type { StartedSigner, StartSigner } from "./start-signer.js";

/**
 * Custody once the keys opened: the `privy-owner` adapter, its ceilings, its wallet maker and its
 * signer.
 */
export interface OpenedCustody {
  readonly signer: Signer;
  readonly ceilings: CeilingEditor;
  readonly walletMaker: WalletMaker;
  /** Settles once the signer has stopped, whatever stopped it. */
  readonly stopped: Promise<void>;
  /** Stops the signer; at once when `signal` aborts. */
  stop(signal: AbortSignal): Promise<void>;
}

/** What custody opens with besides the keys. */
export interface OpenCustodyOptions {
  readonly http: Http;
  readonly clock: Clock;
  /** The engine's environment, of which the signer gets only what Node needs. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly startSigner: StartSigner;
  /** Hears each step the signer refuses. */
  readonly onRefusal: (notice: SignerRefusalNotice) => void;
  readonly config: Pick<BinferenceConfig, "chains" | "custody" | "defaults">;
  /** The venues this install runs: a new wallet's ceiling lets it call theirs. */
  readonly venues: readonly VenueDeclaration[];
  /** The install's wallets and the owner key's public half. */
  readonly install: Pick<InstallStore, "read">;
  readonly chains: ChainRegistry;
  readonly logger: Logger;
}

// Privy takes the app id and secret, or refuses them; one that does not answer is unreachable.
async function checkApp(
  options: OpenCustodyOptions,
  appSecret: Secret,
  signal: AbortSignal,
): Promise<Result<string, LockReason>> {
  const { appId } = options.config.custody.privy;
  if (appId === undefined) {
    return err("app_secret_rejected");
  }
  const { http, clock } = options;
  try {
    const checked = await checkPrivyApp({ http, clock, appId, appSecret }, { signal });
    return checked.ok ? ok(appId) : err("app_secret_rejected");
  } catch (error) {
    signal.throwIfAborted();
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    options.logger.warn("custody.unreachable", { errorCode });
    return err("custody_unreachable");
  }
}

/** The signer's settings line: the enabled chains, Privy's origin and each chain's fee cap. */
export function signerSettingsOf(config: Pick<BinferenceConfig, "chains">): SignerSettings {
  const { enabled, maxFeePerGasGwei } = config.chains;
  const networkFeeCaps = enabled.flatMap((chain) => {
    const cap = maxFeePerGasGwei[chain];
    return cap === undefined ? [] : [{ chain, feePerGasBase: gweiToWei(cap, chain) }];
  });
  return { chains: enabled, privyApi: privyApiOrigin, networkFeeCaps };
}

// The signer's key's public half, or `undefined` once it failed to start or to answer.
async function publicKeyOf(
  options: OpenCustodyOptions,
  keys: UnlockedKeys,
  signal: AbortSignal,
): Promise<{ readonly signer?: StartedSigner; readonly publicKey?: string }> {
  const settings = signerSettingsOf(options.config);
  const start = { settings, agentKey: keys.agentKey, env: options.env, signal };
  const started: { signer?: StartedSigner } = {};
  try {
    const { logger, onRefusal } = options;
    started.signer = await options.startSigner({ ...start, logger, onRefusal });
    return { signer: started.signer, publicKey: await started.signer.client.publicKey({ signal }) };
  } catch (error) {
    signal.throwIfAborted();
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    options.logger.error("signer.start_failed", { errorCode });
    return started;
  }
}

// A signer that does not start, stops, or holds another key than the wallets' signer fails.
async function startCheckedSigner(
  options: OpenCustodyOptions,
  keys: UnlockedKeys,
  signal: AbortSignal,
): Promise<Result<StartedSigner, LockReason>> {
  const { signer, publicKey } = await publicKeyOf(options, keys, signal);
  if (signer !== undefined && publicKey === keys.agentPublicKey) {
    return ok(signer);
  }
  if (publicKey !== undefined) {
    options.logger.error("signer.start_failed", { errorCode: "signer.other_key" });
  }
  await signer?.stop(AbortSignal.abort());
  return err("signer_failed");
}

// A new wallet's ceiling on each enabled chain, as init builds the first one, for the venues named
// that this install runs. A config init would refuse is a fault here.
function ceilingChainsOf(
  options: OpenCustodyOptions,
  venues: readonly string[],
): readonly CeilingChain[] {
  const named = options.venues.filter((venue) => venues.includes(venue.id));
  const request = ceilingRequestOf(options.chains, options.config, { venues: named, rescue: "" });
  if (!request.ok) {
    throw new BinferenceError({
      code: "cli.ceiling_unbuilt",
      message: "The config gives no ceiling a wallet can have.",
      details: { problem: request.refusal.code },
    });
  }
  return request.value.chains;
}

// What a contract call may do on a chain a ceiling enables, for the venues named that this install
// runs, under the cap given. A chain the registry lacks is a fault here.
function callsOn(
  options: OpenCustodyOptions,
  chain: ChainRef,
  calls: Omit<CeilingCalls, "ceiling">,
): CeilingChain {
  const registered = options.chains.list().find((item) => item.ref === chain);
  const venues = options.venues.filter((venue) => calls.venues.includes(venue.id));
  const built =
    registered === undefined
      ? undefined
      : registryCeilingChain({
          definition: registered.definition,
          venues,
          perTxNativeCapBase: calls.perTxNativeBase,
        });
  if (built?.ok !== true) {
    throw new BinferenceError({
      code: "cli.ceiling_unbuilt",
      message: `The registry gives no contract calls a ceiling on ${chain} can have.`,
      details: { chain },
    });
  }
  return built.value;
}

// The chains a wallet signs on: those config enables of its family.
function chainsOf(record: WalletRecord, options: OpenCustodyOptions): readonly ChainRef[] {
  return options.chains
    .list()
    .filter((chain) => chain.definition.family === record.family)
    .map((chain) => chain.ref)
    .filter((chain) => options.config.chains.enabled.includes(chain));
}

function walletsOf(
  records: readonly WalletRecord[],
  options: OpenCustodyOptions,
): Map<Id<"wal">, PrivyWallet> {
  return new Map(
    records
      .filter((record) => record.archivedAtMs === undefined)
      .flatMap((record) => {
        const { custodyWalletId: id, address } = record;
        return isPrivyId(id)
          ? [[record.id, { id, address, chains: chainsOf(record, options) }]]
          : [];
      }),
  );
}

// The install's wallets; a store that fails stops the signer first, so nothing is left running.
async function readInstall(
  install: OpenCustodyOptions["install"],
  signer: StartedSigner,
  signal: AbortSignal,
): Promise<InstallFacts> {
  try {
    return await install.read({ signal });
  } catch (error) {
    await signer.stop(AbortSignal.abort());
    throw error;
  }
}

/**
 * Opens custody with the keys the unlock mode read (keys spec, section 5; decision 0117): Privy
 * checks the app id and secret with one read, the signer starts with the agent key and must answer
 * the public half the wallets name as their signer, and the `privy-owner` adapter signs for the
 * install's wallets through both. Answers why the engine stays locked instead:
 * `app_secret_rejected`, `custody_unreachable` or `signer_failed`. Nothing signs on a failure.
 */
export async function openCustody(
  keys: UnlockedKeys,
  options: OpenCustodyOptions,
  signal: AbortSignal,
): Promise<Result<OpenedCustody, LockReason>> {
  const app = await checkApp(options, keys.appSecret, signal);
  if (!app.ok) {
    return app;
  }
  const started = await startCheckedSigner(options, keys, signal);
  if (!started.ok) {
    return started;
  }
  const signer = started.value;
  const { install, http, clock } = options;
  const facts = await readInstall(install, signer, signal);
  // A wallet made after the unlock joins the wallets the adapter signs for.
  const wallets = walletsOf(facts.wallets, options);
  const api = createPrivyApi({ http, clock, appId: app.value, appSecret: keys.appSecret });
  return ok({
    walletMaker: createPrivyWalletMaker({
      api,
      clock,
      custody: async (read) => (await install.read({ signal: read })).custody,
      ceilingChains: (venues) => ceilingChainsOf(options, venues),
      onMade: (wallet, made) => wallets.set(wallet, made),
    }),
    signer: createPrivyOwnerSigner({
      api,
      signerProcess: signer.client,
      walletOf: (wallet) => wallets.get(wallet),
    }),
    ceilings: createPrivyCeilingEditor({
      api,
      clock,
      ownerKeyPublic: async (read) =>
        (await install.read({ signal: read })).custody?.ownerKeyPublic,
      callsOn: (chain, calls) => callsOn(options, chain, calls),
    }),
    stopped: signer.stopped,
    stop: async (stop) => signer.stop(stop),
  });
}
