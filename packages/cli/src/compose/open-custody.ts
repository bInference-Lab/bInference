import type { ChainRef, ChainRegistry, Signer, VenueDeclaration } from "@binference/chain";
import {
  BinferenceError,
  type Clock,
  err,
  type Http,
  type Logger,
  ok,
  type Result,
  type Secret,
} from "@binference/core";
import {
  type CeilingChainPlan,
  type ChainCapPlan,
  checkPrivyApp,
  createPrivyApi,
  createPrivyOwnerSigner,
  privyApiOrigin,
  registryCeilingChain,
} from "@binference/custody-privy";
import type {
  CeilingCalls,
  CeilingEditor,
  InstallFacts,
  InstallStore,
  SignerRevoker,
  WalletExporter,
  WalletMaker,
} from "@binference/engine/install";
import type { SignerRefusalNotice, SignerSettings } from "@binference/signer";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { capAssetsOn, capPlanOf, initialDayCapUsd } from "../init/ceiling-request.js";
import type { LockReason, UnlockedKeys } from "../unlock/unlock-keys.js";
import { gweiToWei } from "./chain-reads.js";
import { checkAttached } from "./check-attached.js";
import { launchPlansOf } from "./launch-plans.js";
import { installOwnerKey } from "./owner-authorize.js";
import {
  createPrivyCeilingEditor,
  type PrivyCeilingEditorOptions,
} from "./privy-ceiling-editor.js";
import { createPrivySignerRevoker } from "./privy-signer-revoker.js";
import { createPrivyWalletExporter } from "./privy-wallet-exporter.js";
import { createPrivyWalletMaker } from "./privy-wallet-maker.js";
import { signedWalletsOf } from "./signed-wallets.js";
import type { StartedSigner, StartSigner } from "./start-signer.js";
import { ceilingChainsOf, heldCapsOf } from "./wallet-ceilings.js";

/**
 * Custody once the keys opened: the `privy-owner` adapter, its ceilings, its wallet maker, its
 * exporter and signer revoker, and its signer.
 */
export interface OpenedCustody {
  readonly signer: Signer;
  readonly ceilings: CeilingEditor;
  readonly walletMaker: WalletMaker;
  readonly exporter: WalletExporter;
  readonly revoker: SignerRevoker;
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
  readonly onOwnerKey: NonNullable<PrivyCeilingEditorOptions["onOwnerKey"]>;
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
function signerSettingsOf(config: Pick<BinferenceConfig, "chains">): SignerSettings {
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

// What a contract call may do on a chain a ceiling enables, for the venues named that this install
// runs, under the cap given, and on a launch wallet's what its launch rules allow. A chain the
// registry lacks is a fault here.
function callsOn(
  options: OpenCustodyOptions,
  chain: ChainRef,
  calls: Omit<CeilingCalls, "ceiling">,
): CeilingChainPlan {
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
  const [plan] = calls.isLaunch === true ? launchPlansOf([built.value], options.venues) : [];
  return plan ?? built.value;
}

// The plan of a chain's 24-hour caps, at the size given or as init sizes them; a chain the
// registry lacks is a fault.
function capPlanOn(
  options: OpenCustodyOptions,
  chain: ChainRef,
  dayUsdMicros = initialDayCapUsd(options.config),
): ChainCapPlan {
  const registered = options.chains.list().find((item) => item.ref === chain);
  if (registered === undefined) {
    throw new BinferenceError({
      code: "cli.ceiling_unbuilt",
      message: `The registry gives no ceiling caps on ${chain}.`,
      details: { chain },
    });
  }
  return capPlanOf(registered.definition, dayUsdMicros);
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

// The ceiling editor on the owner's app: calls and caps as init plans them for this install.
function ceilingEditorOf(
  options: OpenCustodyOptions,
  parts: Pick<PrivyCeilingEditorOptions, "api" | "ownerKeyPublic" | "onOwnerKey">,
) {
  return createPrivyCeilingEditor({
    ...parts,
    clock: options.clock,
    callsOn: (chain, calls) => callsOn(options, chain, calls),
    capPlanOn: (chain, dayUsdMicros) => capPlanOn(options, chain, dayUsdMicros),
    capAssetsOn: (chain) => capAssetsOn(options.chains, chain),
    heldCaps: async (read) => heldCapsOf(options.install, read),
  });
}

/**
 * Opens custody with the keys the unlock mode read (keys spec, section 5; decision 0117): Privy
 * checks the app id and secret with one read, every live wallet must still list this machine's
 * key quorum as its signer on Privy (decision 0140), the signer starts with the agent key and must
 * answer the public half the wallets name as their signer, and the `privy-owner` adapter signs for
 * the install's wallets through both. Answers why the engine stays locked instead:
 * `app_secret_rejected`, `custody_unreachable`, `signer_revoked` or `signer_failed`. Nothing signs
 * on a failure.
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
  const { install, http, clock } = options;
  const api = createPrivyApi({ http, clock, appId: app.value, appSecret: keys.appSecret });
  const attached = await checkAttached({ install, api, logger: options.logger }, signal);
  if (!attached.ok) {
    return attached;
  }
  const started = await startCheckedSigner(options, keys, signal);
  if (!started.ok) {
    return started;
  }
  const signer = started.value;
  const facts = await readInstall(install, signer, signal);
  // A wallet made after the unlock joins the wallets the adapter signs for.
  const wallets = signedWalletsOf(facts.wallets, options);
  const holder = installOwnerKey(install, options.onOwnerKey);
  return ok({
    walletMaker: createPrivyWalletMaker({
      api,
      clock,
      custody: async (read) => (await install.read({ signal: read })).custody,
      ceilingChains: (wallet) => ceilingChainsOf(options, wallet),
      heldCaps: async (read) => heldCapsOf(install, read),
      onMade: (wallet, made) => wallets.set(wallet, made),
    }),
    signer: createPrivyOwnerSigner({
      api,
      signerProcess: signer.client,
      walletOf: (wallet) => wallets.get(wallet),
    }),
    ceilings: ceilingEditorOf(options, { api, ...holder }),
    exporter: createPrivyWalletExporter({ api, clock, ...holder }),
    revoker: createPrivySignerRevoker({ api, clock, ...holder }),
    stopped: signer.stopped,
    stop: async (stop) => signer.stop(stop),
  });
}
