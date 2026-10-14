import { type AccountRef, accountRefSchema, type ChainRef } from "@binference/chain";
import { type Clock, err, type Id, jsonValueSchema, ok, type Result } from "@binference/core";
import type { WalletMaker } from "../install/ports.js";
import type { MadeWallet, WalletRefusal, WalletRequest } from "../install/wallet-request.js";
import { type FakeCeilingEditor, fakeOwnerKeyCode } from "./fake-ceiling-editor.js";
import { memoryCall } from "./memory-call.js";

/** A wallet maker in memory, whose wallets a test reads. */
export interface FakeWalletMaker extends WalletMaker {
  /** What the ceiling of a made wallet lists, sorted, by its policy id; undefined for none. */
  recipients(policyId: string): readonly AccountRef[] | undefined;
  /** How many wallets it made. */
  count(): number;
}

/** Where the fake's wallets live, and who hears of each. */
export interface FakeWalletMakerOptions {
  readonly clock: Clock;
  /** The chain each made wallet's account is on, and its family. */
  readonly chain: ChainRef;
  readonly family: string;
  /** Takes each new ceiling, so the owner key changes it like any other; none when absent. */
  readonly ceilings?: FakeCeilingEditor;
  /** Hears each wallet made, such as a fake signer that signs for it from then on. */
  readonly onMade?: (wallet: Id<"wal">, account: AccountRef) => void;
}

// Privy's `in` takes one to 100 values, so a ceiling lists that many recipients.
const maxRecipients = 100;

function refusalOf(request: WalletRequest): WalletRefusal | undefined {
  if (request.ownerKey.reveal() !== fakeOwnerKeyCode) {
    return "bad_owner_key";
  }
  const count = request.recipients.length;
  return count === 0 || count > maxRecipients ? "bad_recipients" : undefined;
}

function madeWallet(
  options: FakeWalletMakerOptions,
  request: WalletRequest,
  n: number,
): MadeWallet {
  const address = `0x${(0xd0 + n).toString(16).padStart(8, "0")}`;
  const policyId = `fake-policy-d${String(n)}`;
  const recipients = [...new Set(request.recipients)].toSorted();
  return {
    record: {
      family: options.family,
      custody: "privy",
      custodyWalletId: `fake-wallet-d${String(n)}`,
      policyId,
      signerId: "fake-agent-quorum",
      address,
      ceiling: {
        policyId,
        policy: jsonValueSchema.parse({
          venues: [...request.venues],
          recipients,
          isLaunch: request.isLaunch,
        }),
        perTxNativeBase: 10n ** 18n,
        readAtMs: options.clock.now(),
      },
    },
    account: accountRefSchema.parse(`${options.chain}:${address}`),
  };
}

/**
 * Creates the {@link FakeWalletMaker}: wallets in memory, owned by the fake owner key the fake
 * ceiling editor takes. Each wallet gets an address and a ceiling of its own.
 */
export function createFakeWalletMaker(options: FakeWalletMakerOptions): FakeWalletMaker {
  const ceilings = new Map<string, readonly AccountRef[]>();
  const make = (request: WalletRequest): Result<MadeWallet, WalletRefusal> => {
    const refusal = refusalOf(request);
    if (refusal !== undefined) {
      return err(refusal);
    }
    const made = madeWallet(options, request, ceilings.size + 1);
    const recipients = [...new Set(request.recipients)].toSorted();
    ceilings.set(made.record.policyId, recipients);
    options.ceilings?.put(made.record.policyId, recipients);
    options.onMade?.(request.wallet, made.account);
    return ok(made);
  };
  return {
    make: async (request, call) => memoryCall(call, () => make(request)),
    recipients: (policyId) => ceilings.get(policyId),
    count: () => ceilings.size,
  };
}
