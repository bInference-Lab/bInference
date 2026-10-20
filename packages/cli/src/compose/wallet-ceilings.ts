import type { ChainRegistry, VenueDeclaration } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { type HeldCaps, readCeiling } from "@binference/custody-privy";
import type { InstallStore } from "@binference/engine/install";
import { z } from "zod";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { type CeilingDraft, ceilingRequestOf } from "../init/ceiling-request.js";
import { launchPlansOf } from "./launch-plans.js";

/** What a new wallet's ceiling is planned from: the registry, the config and the venues run. */
export interface WalletCeilingOptions {
  readonly chains: ChainRegistry;
  readonly config: Pick<BinferenceConfig, "chains" | "defaults">;
  /** The venues this install runs: a new wallet's ceiling lets it call theirs. */
  readonly venues: readonly VenueDeclaration[];
}

/**
 * A new wallet's ceiling on each enabled chain, as init builds the first one, for the venues named
 * that this install runs; a launch wallet's with the launch rules of every launchpad it runs too
 * (decision 0217). A config init would refuse is a fault here.
 */
export function ceilingChainsOf(
  options: WalletCeilingOptions,
  wallet: { readonly venues: readonly string[]; readonly isLaunch: boolean },
): Pick<CeilingDraft, "chains" | "capPlans"> {
  const named = options.venues.filter((venue) => wallet.venues.includes(venue.id));
  const request = ceilingRequestOf(options.chains, options.config, {
    venues: named,
    rescue: "",
    isLaunch: wallet.isLaunch,
  });
  if (!request.ok) {
    throw new BinferenceError({
      code: "cli.ceiling_unbuilt",
      message: "The config gives no ceiling a wallet can have.",
      details: { problem: request.refusal.code },
    });
  }
  const { chains, capPlans } = request.value;
  return { chains: wallet.isLaunch ? launchPlansOf(chains, options.venues) : chains, capPlans };
}

const storedPolicy = z.object({ rules: z.array(z.json()) });

/**
 * The 24-hour caps the live wallets' ceilings name, as the store mirrors them: those of the first
 * ceiling that names any, which every ceiling of the install shares.
 */
export async function heldCapsOf(
  install: Pick<InstallStore, "read">,
  signal: AbortSignal,
): Promise<readonly HeldCaps[]> {
  const { wallets } = await install.read({ signal });
  const held = wallets
    .filter((wallet) => wallet.archivedAtMs === undefined)
    .map((wallet) => {
      const policy = storedPolicy.safeParse(wallet.ceiling.policy);
      return policy.success ? (readCeiling(policy.data.rules)?.caps ?? []) : [];
    });
  return held.find((caps) => caps.length > 0) ?? [];
}
