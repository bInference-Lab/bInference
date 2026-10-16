import { ok } from "@binference/core";
import type { OwnedWallet } from "@binference/custody-privy";
import { describe, expect, it } from "vitest";
import type { InitContext } from "../init/init-context.js";
import { rescueAddressOf } from "../init/rescue-step.js";
import { createScriptedPrompter } from "../term/scripted-prompter.js";
import { takeRebuildRescue } from "./rebuild-rescue.js";

const rescue = "0x30435f9D276c6BC54F56161Fb3dFB7bDC2a8DBcB";
const saved = "0xeA6F82DbD6C87DE5E542eFbd1f9964879828e4e7";
const other = "0x4C7f6780Ec91C6AC1D99dA89A90db7895a17dAcE";

function owned(recipients: readonly string[]): OwnedWallet {
  return {
    ceiling: { chainIds: ["56"], contracts: [], perTxNativeCapBase: 0n, recipients },
  } as unknown as OwnedWallet;
}

// A launch wallet at `address`, whose ceiling lists the recipients given.
function launchAt(address: string, recipients: readonly string[]): OwnedWallet {
  return {
    wallet: { address },
    ceiling: {
      chainIds: ["56"],
      contracts: [],
      perTxNativeCapBase: 0n,
      recipients,
      isLaunch: true,
    },
  } as unknown as OwnedWallet;
}

function contextOf(options: { readonly rescue?: string; readonly answers?: readonly string[] }) {
  const prompter = createScriptedPrompter({ rescue: options.answers ?? [] });
  const context = {
    flags: options.rescue === undefined ? {} : { rescue: options.rescue },
    isInteractive: options.answers !== undefined,
    prompter,
    words: (key: string) => key,
  } as unknown as InitContext;
  return { context, prompter };
}

const refusal = { code: "init.rebuild_rescue", key: "refused.rebuildRescue" };

describe("the rescue address of a rebuild", () => {
  it("is read when every ceiling shares one address, whatever its case", async () => {
    const { context } = contextOf({});
    const wallets = [owned([rescue, saved]), owned([rescue.toLowerCase(), other])];

    expect(await takeRebuildRescue(context, wallets)).toStrictEqual(ok(rescueAddressOf(rescue)));
  });

  it("is the one a person picks among the addresses every ceiling shares", async () => {
    const { context, prompter } = contextOf({ answers: [other, saved] });
    const wallets = [owned([rescue, saved]), owned([saved, rescue])];

    expect(await takeRebuildRescue(context, wallets)).toStrictEqual(ok(rescueAddressOf(saved)));
    expect(prompter.transcript.lines).toStrictEqual(["rebuild.rescueNotListed"]);
  });

  it("takes --rescue only when every ceiling lists it", async () => {
    const wallets = [owned([rescue, saved]), owned([saved, rescue])];

    expect(await takeRebuildRescue(contextOf({ rescue: saved }).context, wallets)).toStrictEqual(
      ok(rescueAddressOf(saved)),
    );
    expect(await takeRebuildRescue(contextOf({ rescue: other }).context, wallets)).toMatchObject({
      ok: false,
      refusal,
    });
  });

  it("is refused when the ceilings share no address, or nobody can pick one", async () => {
    const apart = [owned([rescue]), owned([saved])];
    const shared = [owned([rescue, saved])];

    expect(await takeRebuildRescue(contextOf({ answers: [] }).context, apart)).toMatchObject({
      ok: false,
      refusal,
    });
    expect(await takeRebuildRescue(contextOf({}).context, shared)).toMatchObject({
      ok: false,
      refusal,
    });
  });

  it("never takes a launch wallet it found, though every ceiling lists it", async () => {
    const wallets = [owned([rescue, saved]), launchAt(saved, [rescue, saved])];

    expect(await takeRebuildRescue(contextOf({}).context, wallets)).toStrictEqual(
      ok(rescueAddressOf(rescue)),
    );
    expect(await takeRebuildRescue(contextOf({ rescue: saved }).context, wallets)).toMatchObject({
      ok: false,
      refusal,
    });
  });
});
