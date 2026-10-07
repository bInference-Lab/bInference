import assert from "node:assert/strict";
import { chainRefSchema } from "@binference/chain";
import { createEvmSigningScheme, type EvmChain } from "@binference/chain-evm";
import type { ContractCheck } from "@binference/core/testing";
import { buildCeiling } from "../ceiling/build-ceiling.js";
import {
  approvalForAllData,
  approveData,
  oneBnbWei,
  testAddresses,
  testCeilingRequest,
  testChain,
  transferData,
} from "../testing/custody-fixtures.js";
import { readBackWallet, type WalletExpectation } from "../wallets/read-back.js";
import {
  askPrivy,
  type CustodySetup,
  live,
  type PrivyCustodyHarness,
  setUp,
  signRequest,
  type TestCall,
  unsignedCall,
} from "./privy-custody-setup.js";

const { router, permit2, rescue, saved, unsaved, token, unlisted } = testAddresses;
const swapData: `0x${string}` = "0x12345678";
const otherChain: EvmChain = { ...testChain, ref: chainRefSchema.parse("eip155:97"), chainId: 97 };
const refused = { ok: false, error: "refused" };

async function signsAsTheWallet(setup: CustodySetup, call: TestCall): Promise<void> {
  const tx = unsignedCall(setup, call);
  const signed = await setup.signer.signTransaction(signRequest(setup, tx, call.to), live());
  assert.ok(signed.ok, `Privy refused a call inside the ceiling to ${call.to}.`);
  assert.ok(createEvmSigningScheme().verify(tx, signed.value).ok);
}

async function privyRefuses(setup: CustodySetup, call: TestCall, chain?: EvmChain): Promise<void> {
  assert.deepEqual(
    await askPrivy(setup, chain === undefined ? { call } : { call, chain }),
    refused,
  );
}

function check(
  harness: PrivyCustodyHarness,
  name: string,
  run: (setup: CustodySetup) => Promise<void>,
): ContractCheck {
  return { name, run: async () => run(await setUp(harness.create())) };
}

async function readsBackAs(
  setup: CustodySetup,
  expected: WalletExpectation,
  problem: "owner" | "signer" | "policy",
): Promise<void> {
  const found = await readBackWallet(
    setup.subject.api,
    { wallet: setup.wallet.id, expected },
    live(),
  );
  assert.deepEqual(found, { ok: false, error: problem });
}

const readBackChecks = (harness: PrivyCustodyHarness): readonly ContractCheck[] => [
  check(
    harness,
    "makes a wallet whose owner, signer and ceiling read back as asked",
    async (setup) => {
      const found = await readBackWallet(
        setup.subject.api,
        { wallet: setup.wallet.id, expected: setup.expected },
        live(),
      );
      assert.deepEqual(found, { ok: true, value: setup.wallet });
      assert.deepEqual(setup.wallet.chains, [testChain.ref]);
    },
  ),
  check(
    harness,
    "fails the read-back of a wallet whose signer is not the agent key asked for",
    async (setup) => {
      const { publicKey } = await setup.subject.strangerProcess.publicKey(live());
      await readsBackAs(setup, { ...setup.expected, agentKey: publicKey }, "signer");
    },
  ),
  check(
    harness,
    "fails the read-back of a wallet whose policy is not the ceiling asked for",
    async (setup) => {
      const wider = buildCeiling({ ...testCeilingRequest(), saved: [saved, unsaved] });
      assert.ok(wider.ok);
      await readsBackAs(setup, { ...setup.expected, ceiling: wider.value }, "policy");
    },
  ),
  check(
    harness,
    "fails the read-back of a wallet whose owner is not the owner key asked for",
    async (setup) => {
      await readsBackAs(setup, { ...setup.expected, ownerKey: setup.expected.agentKey }, "owner");
    },
  ),
];

const allowChecks = (harness: PrivyCustodyHarness): readonly ContractCheck[] => [
  check(harness, "signs a call to a listed contract with the cap in native coin", async (setup) => {
    await signsAsTheWallet(setup, { to: router, valueWei: oneBnbWei, data: swapData });
  }),
  check(
    harness,
    "signs sends above the cap to the rescue address and to a saved address",
    async (setup) => {
      await signsAsTheWallet(setup, { to: rescue, valueWei: 5n * oneBnbWei, data: "0x" });
      await signsAsTheWallet(setup, { to: saved, valueWei: 2n * oneBnbWei, data: "0x" });
    },
  ),
  check(
    harness,
    "signs a token send to the rescue address and an approval to a registry spender",
    async (setup) => {
      await signsAsTheWallet(setup, { to: token, valueWei: 0n, data: transferData(rescue, 7n) });
      await signsAsTheWallet(setup, { to: token, valueWei: 0n, data: approveData(permit2, 7n) });
    },
  ),
  check(
    harness,
    "signs a zero-value transfer to the wallet itself, which cancels at a nonce",
    async (setup) => {
      await signsAsTheWallet(setup, { to: setup.wallet.address, valueWei: 0n, data: "0x" });
    },
  ),
];

const refuseChecks = (harness: PrivyCustodyHarness): readonly ContractCheck[] => [
  check(
    harness,
    "refuses a send to an address that is not saved, even with a valid agent key",
    async (setup) => {
      await privyRefuses(setup, { to: unsaved, valueWei: 1n, data: "0x" });
    },
  ),
  check(
    harness,
    "refuses a call to a contract that is not listed, even with a valid agent key",
    async (setup) => {
      await privyRefuses(setup, { to: unlisted, valueWei: 0n, data: swapData });
    },
  ),
  check(harness, "refuses a call to a listed contract with more than the cap", async (setup) => {
    await privyRefuses(setup, { to: router, valueWei: oneBnbWei + 1n, data: swapData });
  }),
  check(
    harness,
    "refuses a token send to an unsaved address and an approval to another spender",
    async (setup) => {
      await privyRefuses(setup, { to: token, valueWei: 0n, data: transferData(unsaved, 7n) });
      await privyRefuses(setup, { to: token, valueWei: 0n, data: approveData(unlisted, 7n) });
    },
  ),
  check(harness, "refuses setApprovalForAll, even to a listed contract", async (setup) => {
    await privyRefuses(setup, { to: router, valueWei: 0n, data: approvalForAllData(unsaved) });
  }),
  check(harness, "refuses a transfer to the wallet itself that carries value", async (setup) => {
    await privyRefuses(setup, { to: setup.wallet.address, valueWei: 1n, data: "0x" });
  }),
  check(harness, "refuses a call on a chain the ceiling does not enable", async (setup) => {
    await privyRefuses(setup, { to: rescue, valueWei: 1n, data: "0x" }, otherChain);
  }),
  check(
    harness,
    "refuses a call inside the ceiling authorized by a key that is not the signer",
    async (setup) => {
      const ask = {
        call: { to: router, valueWei: 0n, data: swapData },
        signerProcess: setup.subject.strangerProcess,
      };
      assert.deepEqual(await askPrivy(setup, ask), refused);
    },
  ),
];

/**
 * The contract the Privy fake and the Privy test app both pass: a wallet made and read back, the
 * calls the ceiling allows signed as the wallet, and the ones it does not refused by Privy itself,
 * even with a valid agent key.
 */
export function privyCustodyContract(harness: PrivyCustodyHarness): readonly ContractCheck[] {
  return [...readBackChecks(harness), ...allowChecks(harness), ...refuseChecks(harness)];
}
