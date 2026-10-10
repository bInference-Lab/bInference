import type { PrivyRequest } from "@binference/chain";
import { createSecret, ok, type Secret } from "@binference/core";
import {
  createPrivyApi,
  isPrivyId,
  type OwnerAuthorize,
  type PrivyApi,
} from "@binference/custody-privy";
import type { TempFolder } from "@binference/platform/testing";
import { parseAgentKey, parseOwnerKeyCode, signAuthorization } from "@binference/signer";
import { z } from "zod";
import {
  type InitMachine,
  initFlags,
  newInitMachine,
  rescueAddress,
  runOn,
  storedInstall,
} from "./init-fixtures.js";

const live = { signal: new AbortController().signal };

/** An install `binference init` set up, and the owner key code it gave the script. */
export interface SetUp {
  readonly machine: InitMachine;
  readonly ownerKey: string;
}

const answerSchema = z.object({ ownerKeyCode: z.string() });

/**
 * Sets up a machine with `binference init --yes --json` in a fresh folder: the answer gives the
 * owner key code, as nobody saw it on a terminal.
 */
export async function setUpWithOwnerKey(folders: TempFolder[]): Promise<SetUp> {
  const machine = await newInitMachine(folders);
  const run = await runOn(machine, ["init", "--yes", "--json", ...initFlags(machine)]);
  const answer = answerSchema.parse(JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "{}"));
  return { machine, ownerKey: answer.ownerKeyCode };
}

/** A client of the machine's fake Privy app. */
export function apiOf(machine: InitMachine): PrivyApi {
  const { privy, clock } = machine;
  return createPrivyApi({
    http: privy.http,
    clock,
    appId: privy.appId,
    appSecret: privy.appSecret,
  });
}

/** Signs Privy requests as the owner key its code holds. */
export function ownerSigns(code: string): OwnerAuthorize {
  const pair = parseOwnerKeyCode(createSecret(code));
  if (!pair.ok) {
    throw new Error("Expected the owner key code.");
  }
  return async (request: PrivyRequest) =>
    Promise.resolve(ok(signAuthorization(pair.value.privateKey, request)));
}

/**
 * Asks Privy to sign a send of 1 wei to the rescue address, which every ceiling allows, from the
 * install's first wallet, authorized by the agent key given: `signed`, or Privy's refusal.
 */
export async function signsWith(
  machine: InitMachine,
  agentKey: Secret,
): Promise<"signed" | "refused" | "unknown_wallet"> {
  const pair = parseAgentKey(agentKey);
  const { facts } = await storedInstall(machine);
  const wallet = facts.wallets[0]?.custodyWalletId ?? "";
  if (!pair.ok || !isPrivyId(wallet)) {
    throw new Error("Expected an agent key and a wallet.");
  }
  const transaction = {
    type: 2 as const,
    chain_id: 56,
    nonce: 0,
    to: rescueAddress,
    value: "0x1",
    data: "0x",
    gas_limit: "0x5208",
    max_fee_per_gas: "0x3b9aca00",
    max_priority_fee_per_gas: "0x3b9aca00",
  };
  const authorize = async (request: PrivyRequest) =>
    Promise.resolve(ok(signAuthorization(pair.value.privateKey, request)));
  const signed = await apiOf(machine).signTransaction({ wallet, transaction, authorize }, live);
  return signed.ok ? "signed" : signed.error;
}
