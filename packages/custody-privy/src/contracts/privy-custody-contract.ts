import assert from "node:assert/strict";
import { chainRefSchema } from "@binference/chain";
import { createEvmSigningScheme, type EvmChain } from "@binference/chain-evm";
import type { ContractCheck } from "@binference/core/testing";
import { buildCeiling } from "../ceiling/build-ceiling.js";
import type { ChainCaps } from "../ceiling/ceiling.js";
import { policyRuleJson } from "../ceiling/policy-rule.js";
import { readCeiling } from "../ceiling/read-ceiling.js";
import {
  approvalForAllData,
  approveData,
  oneBnbWei,
  swapData,
  swapToData,
  sweepData,
  testAddresses,
  testCapPlan,
  testCeilingRequest,
  testChain,
  transferData,
} from "../testing/custody-fixtures.js";
import { readBackWallet, type WalletExpectation } from "../wallets/read-back.js";
import { recipientChecks } from "./ceiling-recipients-checks.js";
import {
  askPrivy,
  check,
  type CustodySetup,
  live,
  type PrivyCustodyHarness,
  signRequest,
  type TestCall,
  unsignedCall,
} from "./privy-custody-setup.js";
import { signerChecks } from "./wallet-signer-checks.js";

const { router, permit2, rescue, saved, unsaved, token, unlisted } = testAddresses;
const swap = swapData(5n);
const [tokenCap] = testCapPlan.approvals;
const otherChain: EvmChain = { ...testChain, ref: chainRefSchema.parse("eip155:97"), chainId: 97 };
const refused = { ok: false, error: "refused" };

async function signsAsTheWallet(setup: CustodySetup, call: TestCall): Promise<void> {
  const tx = unsignedCall(setup, call);
  const signed = await setup.signer.signTransaction(signRequest(setup, tx, call), live());
  assert.ok(signed.ok, `Privy refused a call inside the ceiling to ${call.to}.`);
  assert.ok(createEvmSigningScheme().verify(tx, signed.value).ok);
}

async function privyRefuses(setup: CustodySetup, call: TestCall, chain?: EvmChain): Promise<void> {
  assert.deepEqual(
    await askPrivy(setup, chain === undefined ? { call } : { call, chain }),
    refused,
  );
}

// The caps the suite's wallet was made with, read from its ceiling.
function capsOf(setup: CustodySetup): ChainCaps {
  const [held] = readCeiling(setup.expected.ceiling.rules.map(policyRuleJson))?.caps ?? [];
  assert.ok(held !== undefined);
  return held.caps;
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
      const agentKey = await setup.subject.strangerProcess.publicKey(live());
      await readsBackAs(setup, { ...setup.expected, agentKey }, "signer");
    },
  ),
  check(
    harness,
    "fails the read-back of a wallet whose policy is not the ceiling asked for",
    async (setup) => {
      const caps = capsOf(setup);
      const wider = buildCeiling({ ...testCeilingRequest(caps), saved: [saved, unsaved] });
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
  check(harness, "signs a listed function's call with the cap in native coin", async (setup) => {
    await signsAsTheWallet(setup, { to: router, valueWei: oneBnbWei, data: swap });
  }),
  check(
    harness,
    "signs a call that pays its receiver when the wallet is the receiver",
    async (setup) => {
      const data = swapToData(setup.wallet.address, 5n);
      await signsAsTheWallet(setup, { to: router, valueWei: 0n, data });
    },
  ),
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
    "signs a token send to the rescue address and an approval to a venue's spender",
    async (setup) => {
      await signsAsTheWallet(setup, { to: token, valueWei: 0n, data: transferData(rescue, 7n) });
      await signsAsTheWallet(setup, { to: token, valueWei: 0n, data: approveData(router, 7n) });
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
      await privyRefuses(setup, { to: unlisted, valueWei: 0n, data: swap });
    },
  ),
  check(harness, "refuses a call to a listed contract with more than the cap", async (setup) => {
    await privyRefuses(setup, { to: router, valueWei: oneBnbWei + 1n, data: swap });
  }),
  check(
    harness,
    "refuses a token send to an unsaved address and an approval to another spender",
    async (setup) => {
      await privyRefuses(setup, { to: token, valueWei: 0n, data: transferData(unsaved, 7n) });
      await privyRefuses(setup, { to: token, valueWei: 0n, data: approveData(unlisted, 7n) });
      await privyRefuses(setup, { to: token, valueWei: 0n, data: approveData(permit2, 7n) });
    },
  ),
  check(harness, "refuses setApprovalForAll on a token it does not list", async (setup) => {
    await privyRefuses(setup, { to: token, valueWei: 0n, data: approvalForAllData(unsaved) });
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
        call: { to: router, valueWei: 0n, data: swap },
        signerProcess: setup.subject.strangerProcess,
      };
      assert.deepEqual(await askPrivy(setup, ask), refused);
    },
  ),
];

// What the venues' declarations narrow: functions, receivers, and the 24-hour cap of a token.
const venueChecks = (harness: PrivyCustodyHarness): readonly ContractCheck[] => [
  check(harness, "refuses a function no venue declares on a listed contract", async (setup) => {
    await privyRefuses(setup, { to: router, valueWei: 0n, data: sweepData(token, unsaved) });
  }),
  check(harness, "refuses a call that pays a receiver other than the wallet", async (setup) => {
    await privyRefuses(setup, { to: router, valueWei: 0n, data: swapToData(unsaved, 5n) });
    await privyRefuses(setup, { to: router, valueWei: 0n, data: swapToData(rescue, 5n) });
  }),
  check(harness, "refuses an approval that would pass the token's 24-hour cap", async (setup) => {
    const amount = (tokenCap?.limitBase ?? 0n) + 1n;
    await privyRefuses(setup, { to: token, valueWei: 0n, data: approveData(router, amount) });
  }),
];

/**
 * The contract the Privy fake and the Privy test app both pass: a wallet made and read back, the
 * calls the ceiling allows signed as the wallet, the ones it does not refused by Privy itself, even
 * with a valid agent key, functions, receivers and approvals past a cap among them, and the recipients and the signer only the owner key changes.
 */
export function privyCustodyContract(harness: PrivyCustodyHarness): readonly ContractCheck[] {
  return [
    ...readBackChecks(harness),
    ...allowChecks(harness),
    ...refuseChecks(harness),
    ...venueChecks(harness),
    ...recipientChecks(harness),
    ...signerChecks(harness),
  ];
}
