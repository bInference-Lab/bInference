import {
  accountRefParts,
  chainRefSchema,
  createChainRegistry,
  type TxSimulator,
} from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeIdentityRegistry,
  createFakeSigningScheme,
  type FakeIdentityRegistry,
} from "@binference/chain/testing";
import type { JsonValue } from "@binference/core";
import type { RegisterIdentityRequest } from "@binference/protocol";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { testAgent, testLimits, testNowMs, testWallet } from "../intents/test-intents.js";
import {
  startTestEngine,
  testAccount,
  type TestEngine,
  type TestEngineOptions,
} from "../operations/test-engine.js";

// The fake identity registry's id.
const testIdentityVenue = "fake-identity";
// The fake registry's address on the fake chain.
const testRegistryAddress = "0x000000e5";
/** The binference version a test registration file names. */
export const testVersion = "2026.11.3";

/** A fake identity registry on the fake chain, reporting the version it was tested with. */
export function testRegistry(): FakeIdentityRegistry {
  return createFakeIdentityRegistry({
    chain: chainRefSchema.parse("fake:1"),
    address: testRegistryAddress,
  });
}

/** The fake chain's registry with the fake identity registry's contract beside the fake router. */
export function identityChains(): ReturnType<typeof createChainRegistry> {
  const definition = createFakeChainDefinition();
  const [router] = definition.contracts;
  const registry =
    router === undefined
      ? []
      : [
          {
            ...router,
            venue: testIdentityVenue,
            name: "identity-registry",
            address: testRegistryAddress,
          },
        ];
  return createChainRegistry({
    chains: [{ ...definition, contracts: [...definition.contracts, ...registry] }],
    families: [createFakeFamily()],
    signingSchemes: [createFakeSigningScheme()],
  });
}

/** A simulator that runs every draft through the fake registry, as the chain would. */
export function registrySimulator(registry: FakeIdentityRegistry): Pick<TxSimulator, "simulate"> {
  return {
    simulate: async (drafts) => Promise.resolve(drafts.map((draft) => registry.simulate(draft))),
  };
}

/**
 * Lists the test wallet in the install, its ceiling holding the registry's call unless `held` is
 * `none`, as custody's read-back holds a call rule's JSON ABI entry.
 */
export function holdIdentityWallet(
  test: Pick<TestEngine, "stores">,
  registry: FakeIdentityRegistry,
  held: "call" | "none" = "call",
): void {
  const record = testWalletRecord({
    id: testWallet,
    agentId: testAgent,
    label: "main",
    createdAtMs: testNowMs - 1,
  });
  const abis: readonly JsonValue[] = registry.contracts.flatMap((contracts) =>
    (contracts.calls ?? []).map((call) => call.abi),
  );
  const policy = held === "call" ? [{ abi: [...abis] }] : [];
  test.stores.install.addWallet({
    ...record,
    address: accountRefParts(testAccount).address,
    ceiling: { ...record.ceiling, policy },
  });
}

/**
 * A live engine whose agent may register through the fake registry, its wallet listed with a
 * ceiling that holds the registry's call unless `held` is `none`. The agent's limits name no
 * identity venue: the owner's opt-in is the ceiling's call, not a venue (decision 0335).
 */
export async function startIdentityEngine(
  registry: FakeIdentityRegistry,
  options: TestEngineOptions = {},
  held: "call" | "none" = "call",
): Promise<TestEngine> {
  const test = await startTestEngine({
    chains: identityChains(),
    identity: { registries: [registry], version: testVersion },
    chainSimulator: registrySimulator(registry),
    ...options,
    agent: { mode: "live", limits: testLimits, ...options.agent },
  });
  holdIdentityWallet(test, registry, held);
  return test;
}

/** The test agent's registration, with the owner's description unless told otherwise. */
export function registerRequest(description?: string): RegisterIdentityRequest {
  const base = { kind: "registerIdentity", agent: testAgent, reason: "identity/register" } as const;
  return description === undefined ? base : { ...base, description };
}
