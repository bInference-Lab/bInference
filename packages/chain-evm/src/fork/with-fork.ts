import { BinferenceError } from "@binference/core";
import { toHex } from "viem";
import { inject } from "vitest";
import type { JsonValue } from "../rpc/json-value.schema.js";
import { callLoopback } from "./call-loopback.js";
import { type Fork, openFork } from "./open-fork.js";

const accountBalance = 10n * 10n ** 18n;
// A test that timed out has an aborted signal; its changes to the fork are still undone.
const revertTimeoutMs = 30_000;

async function revert(rpcUrl: string, snapshot: JsonValue): Promise<void> {
  const call = { rpcUrl, method: "evm_revert", params: [snapshot] };
  const reverted = await callLoopback(call, AbortSignal.timeout(revertTimeoutMs));
  if (reverted !== true) {
    throw new BinferenceError({
      code: "fork.not_reverted",
      message: "anvil did not revert the fork, so the next tests would see this test's changes.",
    });
  }
}

/**
 * Runs `test` on the suite's BSC fork at its pinned block, with 10 BNB on the test account and its
 * code cleared: anvil's default accounts are live EIP-7702 accounts on BSC whose code forwards
 * any BNB they receive, and on a fork that code runs too. Whatever `test` does to the fork is
 * reverted afterwards, even when it fails, so every test starts from the same state. Pass the
 * Vitest test's `signal`, so a test that times out stops its requests.
 */
export async function withFork(
  signal: AbortSignal,
  test: (fork: Fork) => Promise<void>,
): Promise<void> {
  const context = inject("fork");
  const fork = await openFork(context, signal);
  const snapshot = await fork.call("evm_snapshot", []);
  try {
    await fork.call("anvil_setCode", [fork.account, "0x"]);
    await fork.call("anvil_setBalance", [fork.account, toHex(accountBalance)]);
    await test(fork);
  } finally {
    await revert(context.rpcUrl, snapshot);
  }
}
