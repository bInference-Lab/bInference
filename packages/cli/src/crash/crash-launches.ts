import { setTimeout as wait } from "node:timers/promises";
import { type AccountRef, accountRefParts } from "@binference/chain";
import type { ProtocolClient } from "@binference/client";
import { BinferenceError, type Id } from "@binference/core";
import { isTerminalState } from "@binference/engine";
import type { IntentView, ProtocolId } from "@binference/protocol";
import { type Address, getAddress, toHex } from "viem";
import { z } from "zod";
import { connectClient } from "../e2e/test-host.js";
import { onePixelPng } from "../fork/flap-launch-parts.js";
import { createSystemHttp } from "../runtime/system-http.js";
import { type CrashLaunchPair, crashFirstBuys, crashLaunchTerms } from "./crash-launch-terms.js";
import { fundCrashUsdt } from "./crash-market.js";
import { type CrashInstall, type CrashWorld, goneLive } from "./crash-runs.js";

/** An install's agent with its launch wallet, made and funded for a run's launch. */
export interface CrashLauncher {
  readonly agent: ProtocolId<"agent">;
  readonly wallet: ProtocolId<"wallet">;
  readonly address: Address;
}

const call = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(60_000) });

function addressOf(account: AccountRef): Address {
  return getAddress(accountRefParts(account).address);
}

/**
 * Goes live as `binference live` does and makes the agent's launch wallet as `binference wallet
 * create --launch` does, with the owner key; funds it from outside with 1 BNB, and the USDT a
 * token first buy spends.
 */
export async function setUpLauncher(
  world: CrashWorld,
  install: CrashInstall,
): Promise<CrashLauncher> {
  const client = await connectClient(install.machine);
  try {
    const agent = await goneLive(client, call());
    const args = {
      agent: agent.id,
      label: "Launches",
      ownerKey: install.machine.ownerKey.code,
      launch: true,
    } as const;
    const made = await client.call("wallet/create", args, call());
    const address = addressOf(made.address);
    await world.chain.call("anvil_setBalance", [address, toHex(10n ** 18n)]);
    const anvil = async (method: string, params: Parameters<CrashWorld["chain"]["call"]>[1]) =>
      world.chain.call(method, params);
    await fundCrashUsdt(anvil, address, crashFirstBuys.usdt);
    return { agent: agent.id, wallet: made.wallet, address };
  } finally {
    client.close();
  }
}

const uploadAnswerSchema = z.object({ upload: z.string() });

// The owner's picture, uploaded as the console uploads it: `upload/start`, then its bytes to the
// ticket's path on the engine's HTTP listener, held for the client's credential.
async function uploadPicture(client: ProtocolClient, install: CrashInstall): Promise<string> {
  const plan = { contentType: "image/png", bytes: onePixelPng.byteLength } as const;
  const { url } = await client.call("upload/start", plan, call());
  const http = createSystemHttp({ version: "crash" });
  try {
    const posted = await http.request({
      method: "POST",
      url: `http://127.0.0.1:${String(install.port)}${url}`,
      bodyBytes: onePixelPng,
      signal: AbortSignal.timeout(10_000),
    });
    return uploadAnswerSchema.parse(JSON.parse(posted.body)).upload;
  } finally {
    await http.close();
  }
}

// The agent's launch intent, the newest; `undefined` while it has none.
async function launchOf(
  client: ProtocolClient,
  agent: ProtocolId<"agent">,
): Promise<IntentView | undefined> {
  const page = await client.call("intent/list", { agent, limit: 5 }, call());
  const listed = page.items.find((item) => item.kind === "launchToken");
  return listed === undefined
    ? undefined
    : client.call("intent/get", { intent: listed.intent }, call());
}

// Waits until the launch ends, or its card opens when `isCardAnEnd`, as the engine moves it on.
async function untilSettled(
  client: ProtocolClient,
  launcher: CrashLauncher,
  until: { readonly deadline: number; readonly isCardAnEnd: boolean },
): Promise<IntentView | undefined> {
  const view = await launchOf(client, launcher.agent);
  const isCard = until.isCardAnEnd && view?.state === "awaiting_confirmation";
  const isEnded = view !== undefined && isTerminalState(view.state);
  if (isCard || isEnded || Date.now() > until.deadline) {
    return view;
  }
  await wait(250);
  return untilSettled(client, launcher, until);
}

/** Taps Confirm on the launch's open card; answers whether it had one to tap. */
async function confirmed(client: ProtocolClient, view: IntentView | undefined): Promise<boolean> {
  const card = view?.card;
  if (view?.state !== "awaiting_confirmation" || card === undefined) {
    return false;
  }
  const tap = { intent: view.intent, card: card.card, cardVersion: card.version };
  // A kill right after the signature can cut the confirmation's answer off.
  await client.call("intent/confirm", tap, call()).catch(() => undefined);
  return true;
}

/**
 * The owner's launch as the CLI makes it: the picture uploaded, the launch proposed, which answers
 * once it waits for its pin, then its card waited for as the engine's pin timer opens it, and
 * Confirm tapped on it unless `tap` is false. A kill may cut any step off.
 */
export async function launchAndTap(
  install: CrashInstall,
  launch: {
    readonly launcher: CrashLauncher;
    readonly pair: CrashLaunchPair;
    readonly tap: boolean;
  },
): Promise<void> {
  const client = await connectClient(install.machine);
  try {
    const image = await uploadPicture(client, install);
    const terms = crashLaunchTerms(launch.pair);
    const request = { ...terms, kind: "launchToken", agent: launch.launcher.agent, image } as const;
    await client.call("intent/propose", request, call());
    const until = { deadline: Date.now() + 60_000, isCardAnEnd: true };
    const view = await untilSettled(client, launch.launcher, until);
    if (launch.tap && !(await confirmed(client, view))) {
      throw new BinferenceError({
        code: "crash.no_card",
        message: `The launch opened no card: ${view?.state ?? "none"}.`,
        details: { reason: view?.outcome?.reason ?? "none" },
      });
    }
  } finally {
    client.close();
  }
}

/** Where a run's launch stands once the restarted engine settled it. */
export interface SettledLaunch {
  readonly intent: Id<"int"> | undefined;
  readonly state: string;
  /** Whether the owner tapped a card the restarted engine opened. */
  readonly isTappedAfter: boolean;
}

/**
 * Waits on the running engine until the agent's launch ended, tapping Confirm on a card it opens
 * as the owner would, then stops the engine through `engine/stop`; answers where it ended.
 */
export async function settleLaunchAndStop(
  install: CrashInstall,
  launcher: CrashLauncher,
): Promise<SettledLaunch> {
  const client = await connectClient(install.machine);
  const deadline = Date.now() + 120_000;
  try {
    const first = await untilSettled(client, launcher, { deadline, isCardAnEnd: true });
    const isTappedAfter = await confirmed(client, first);
    const view = isTappedAfter
      ? await untilSettled(client, launcher, { deadline, isCardAnEnd: false })
      : first;
    const settled = { intent: view?.intent, state: view?.state ?? "none", isTappedAfter };
    await client.call("engine/stop", {}, { signal: AbortSignal.timeout(10_000) }).catch(() => ({}));
    return settled;
  } finally {
    client.close();
  }
}

/** Waits on the running engine until the agent's launch has its card open, or a minute passed. */
export async function cardOpenOf(install: CrashInstall, launcher: CrashLauncher): Promise<void> {
  const client = await connectClient(install.machine);
  try {
    await untilSettled(client, launcher, { deadline: Date.now() + 60_000, isCardAnEnd: true });
  } finally {
    client.close();
  }
}
