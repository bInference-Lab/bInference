import assert from "node:assert/strict";
import { type Id, idSchema } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { AccountRef } from "../caip/account-ref.js";
import { assetRefSchema } from "../caip/asset-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";
import type { Signer, SigningScheme } from "../ports.js";
import type { DaySumsRefusal, SignerLock } from "../sign-outcome.js";
import type { SignRequest } from "../sign-request.js";
import type { UnsignedTx } from "../transaction.js";

/** A signer under test, one wallet it holds, and transactions to ask it for. */
export interface SignerSubject {
  readonly signer: Signer;
  /** The scheme of the wallet's family, which checks what the signer signed. */
  readonly scheme: SigningScheme;
  readonly wallet: Id<"wal">;
  /** The wallet's account on the transactions' chain. */
  readonly account: AccountRef;
  /** A chain where the wallet has no account. */
  readonly otherChain: ChainRef;
  /** A wallet the signer does not hold. */
  readonly unknownWallet: Id<"wal">;
  /** A transaction from the wallet's account, inside its ceiling. */
  readonly tx: UnsignedTx;
  /** A transaction from another account. */
  readonly foreignTx: UnsignedTx;
}

/** The answers of a signer service a test arranges for its subject's wallet. */
export interface SignerServiceControls {
  /** Makes later signatures answer `over_sums` with these sums. */
  fillSums(sums: DaySumsRefusal): void;
  /** Makes later signatures answer `locked` with this reason. */
  lock(reason: SignerLock): void;
}

/**
 * Makes a fresh {@link SignerSubject} for each check. An adapter of a signer service also makes
 * one whose service a test controls, and passes the service's own checks too.
 */
export interface SignerHarness {
  create(): SignerSubject;
  readonly service?: () => SignerSubject & { readonly controls: SignerServiceControls };
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

const uuid = "0190f1c2-3b4c-7d5e-8f60-718293a4b5c6";
const intent = idSchema("int").parse(`int_${uuid}`);
const confirmation = idSchema("cnf").parse(`cnf_${uuid}`);

const termsHash = "0".repeat(64);
// A confirmation that lasts until 2100: the checks ask the signer, never the clock.
const expiresAtMs = 4_102_444_800_000;

function requestFor(wallet: Id<"wal">, tx: UnsignedTx): SignRequest {
  return {
    wallet,
    intent,
    step: { index: 0, chain: tx.chain, action: { kind: "call", nativeValue: 0n } },
    authorization: { kind: "confirmation", id: confirmation, intent, termsHash, expiresAtMs },
    termsHash,
    allowed: { contracts: [], spenders: [], recipients: [] },
    tx,
  };
}

const accountChecks = (harness: SignerHarness): readonly ContractCheck[] => [
  {
    name: "answers the wallet's account on its chain",
    run: async () => {
      const { signer, wallet, account, tx } = harness.create();
      assert.deepEqual(await signer.account(wallet, tx.chain, live()), {
        ok: true,
        value: account,
      });
    },
  },
  {
    name: "answers unknown_wallet for a wallet it does not hold or a chain the wallet is not on",
    run: async () => {
      const { signer, wallet, unknownWallet, otherChain, tx } = harness.create();
      const unknown = { ok: false, error: "unknown_wallet" };
      assert.deepEqual(await signer.account(unknownWallet, tx.chain, live()), unknown);
      assert.deepEqual(await signer.account(wallet, otherChain, live()), unknown);
      const signed = await signer.signTransaction(requestFor(unknownWallet, tx), live());
      assert.deepEqual(signed, unknown);
    },
  },
];

const signChecks = (harness: SignerHarness): readonly ContractCheck[] => [
  {
    name: "signs a transaction from the wallet so that its family's scheme accepts it",
    run: async () => {
      const { signer, scheme, wallet, tx } = harness.create();
      const signed = await signer.signTransaction(requestFor(wallet, tx), live());
      assert.ok(signed.ok);
      assert.ok(scheme.verify(tx, signed.value).ok);
    },
  },
  {
    name: "refuses a transaction whose sender is another account",
    run: async () => {
      const { signer, wallet, foreignTx } = harness.create();
      assert.deepEqual(await signer.signTransaction(requestFor(wallet, foreignTx), live()), {
        ok: false,
        error: "refused",
      });
    },
  },
  {
    name: "answers and signs nothing on an aborted signal",
    run: async () => {
      const { signer, wallet, tx } = harness.create();
      const reason = new Error("stopped");
      const aborted = { signal: AbortSignal.abort(reason) };
      await assert.rejects(signer.account(wallet, tx.chain, aborted), reason);
      await assert.rejects(signer.signTransaction(requestFor(wallet, tx), aborted), reason);
    },
  },
];

// What a full day looks like to a signer service: the native sum of the subject's chain.
function fullDay(tx: UnsignedTx): DaySumsRefusal {
  return {
    chain: tx.chain,
    asset: assetRefSchema.parse(`${tx.chain}/slip44:1`),
    capBase: 10n ** 19n,
    usedBase: 95n * 10n ** 17n,
    askedBase: 10n ** 18n,
    roomAtMs: expiresAtMs,
  };
}

const serviceChecks = (
  service: NonNullable<SignerHarness["service"]>,
): readonly ContractCheck[] => [
  {
    name: "answers over_sums with the sum a transaction would pass, and signs nothing",
    run: async () => {
      const { signer, wallet, tx, controls } = service();
      const sums = fullDay(tx);
      controls.fillSums(sums);
      assert.deepEqual(await signer.signTransaction(requestFor(wallet, tx), live()), {
        ok: false,
        error: "over_sums",
        sums,
      });
    },
  },
  {
    name: "answers locked with why it signs nothing",
    run: async () => {
      const { signer, wallet, tx, controls } = service();
      controls.lock("breaker");
      assert.deepEqual(await signer.signTransaction(requestFor(wallet, tx), live()), {
        ok: false,
        error: "locked",
        lock: "breaker",
      });
    },
  },
];

/**
 * The contract every `Signer` adapter passes, and the answers of a signer service every adapter
 * of one passes too.
 */
export function signerContract(harness: SignerHarness): readonly ContractCheck[] {
  const { service } = harness;
  return [
    ...accountChecks(harness),
    ...signChecks(harness),
    ...(service === undefined ? [] : serviceChecks(service)),
  ];
}
