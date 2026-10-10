import { type AccountRef, accountRefParts } from "@binference/chain";
import { evmAccountRef, evmChainOf } from "@binference/chain-evm";
import { bsc } from "@binference/chains";
import { BinferenceError } from "@binference/core";
import type { InstallSetup } from "@binference/engine/install";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { agent, wallet } from "../fork/executor-rig.js";
import { forkWallet } from "../fork/fork-trading.js";
import { firstAgentDraft } from "../init/first-agent.js";
import { crashWalletKey } from "./crash-wallet.js";
import type { CrashOpened } from "./open-crash-engine.js";

function setUpFailed(step: string): BinferenceError {
  return new BinferenceError({
    code: "crash.set_up_failed",
    message: `The crash engine could not set up its ${step}.`,
  });
}

// The install as `binference init` records it, with custody ids and keys of the test's own (each
// key the base64 of its name): the run's wallet signs here, never on Privy.
function setupOf(account: AccountRef, atMs: number): InstallSetup {
  const rescue = forkWallet(crashWalletKey("rescue")).address;
  return {
    atMs,
    custody: {
      provider: "privy",
      appId: "crash-app",
      ownerQuorumId: "crash-owner-quorum",
      ownerKeyPublic: "Y3Jhc2ggb3duZXIga2V5",
      agentQuorumId: "crash-agent-quorum",
      agentKeyPublic: "Y3Jhc2ggYWdlbnQga2V5",
      attachedAtMs: atMs,
    },
    rescueAddress: evmAccountRef(evmChainOf(bsc), rescue),
    wallet: {
      id: wallet,
      agentId: agent,
      family: "evm",
      custody: "privy",
      custodyWalletId: "crash-wallet",
      policyId: "crash-policy",
      signerId: "crash-agent-quorum",
      address: accountRefParts(account).address,
      label: "main",
      createdAtMs: atMs,
      ceiling: {
        policyId: "crash-policy",
        policy: [],
        perTxNativeBase: 10n ** 18n,
        readAtMs: atMs,
      },
    },
    isStartOver: false,
  };
}

/**
 * Sets up a fresh state folder as `binference init` and `binference live` would leave it: the
 * first agent from the config's defaults, live, trading on PancakeSwap, and the install with the
 * run's wallet as that agent's one wallet.
 */
export async function setUpCrashInstall(
  opened: CrashOpened,
  account: AccountRef,
  signal: AbortSignal,
): Promise<void> {
  const { stores, config, host } = opened;
  const atMs = host.clock.now();
  const facts = { id: agent, atMs, venues: ["pancakeswap"] };
  const drafted = firstAgentDraft(config, selfHostedChains(), facts);
  if (!drafted.ok) {
    throw setUpFailed("agent");
  }
  const created = await stores.agents.create({ ...drafted.value, mode: "live" }, { signal });
  if (!created.ok) {
    throw setUpFailed("agent");
  }
  const set = await stores.install.setUp(setupOf(account, atMs), { signal });
  if (!set.ok) {
    throw setUpFailed("install");
  }
}
