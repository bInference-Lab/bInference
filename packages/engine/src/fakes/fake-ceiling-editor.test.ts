import { type AccountRef, accountRefSchema, assetRefSchema } from "@binference/chain";
import { createSecret } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { ceilingEditorContract } from "../contracts/ceiling-editor-contract.js";
import { testChains } from "../operations/test-engine.js";
import { createFakeCeilingEditor, fakeOwnerKeyCode } from "./fake-ceiling-editor.js";

const accounts = [
  accountRefSchema.parse("fake:1:0x000000a1"),
  accountRefSchema.parse("fake:1:0x000000a2"),
  accountRefSchema.parse("fake:1:0x000000a3"),
] as const;

// The one 24-hour cap the subject's ceiling names: 10 coins, $1,000 at the floor.
const dayCap = {
  asset: assetRefSchema.parse("fake:1/slip44:1"),
  limit: 10n * 10n ** 18n,
  windowSeconds: 86_400,
  floorUsdMicros: 1_000_000_000n,
};

function listed(recipients: readonly AccountRef[] | undefined): readonly AccountRef[] {
  return recipients ?? [];
}

describe("the fake ceiling editor", () => {
  it.each(
    ceilingEditorContract({
      create: async () => {
        const clock = createManualClock(1_800_000_000_000);
        const editor = createFakeCeilingEditor({ clock, chains: testChains() });
        const calls = { contracts: [], perTxNativeBase: 10n ** 18n, dayCaps: [dayCap] };
        editor.put("ceiling-1", [accounts[0], accounts[1]], calls);
        return Promise.resolve({
          editor,
          ownerKey: createSecret(fakeOwnerKeyCode),
          otherKey: createSecret("bnok1aaaaa bbbbb ccccc ddddd eeeee"),
          ceiling: "ceiling-1",
          unknownCeiling: "ceiling-9",
          accounts,
          venues: { known: "fake-swap", unknown: "no-such-venue" },
          recipients: async () => Promise.resolve(listed(editor.recipients("ceiling-1"))),
          now: () => clock.now(),
        });
      },
    }),
  )("follows the ceiling editor contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("refuses an empty list of recipients, as a ceiling lists one or more", async () => {
    const editor = createFakeCeilingEditor({ clock: createManualClock(1) });
    editor.put("ceiling-1", [accounts[0]]);
    const request = {
      ownerKey: createSecret(fakeOwnerKeyCode),
      ceilings: [{ ceiling: "ceiling-1", recipients: [] }],
    };

    expect(
      await editor.setRecipients(request, { signal: new AbortController().signal }),
    ).toStrictEqual({
      ok: false,
      error: "bad_recipients",
    });
  });

  it("names a venue's contract after it without a registry", async () => {
    const editor = createFakeCeilingEditor({ clock: createManualClock(1) });
    editor.put("ceiling-1", [accounts[0]]);
    const calls = { ceiling: "ceiling-1", venues: ["swap"], perTxNativeBase: 3n };
    const request = { ownerKey: createSecret(fakeOwnerKeyCode), ceilings: [calls] };
    const call = { signal: new AbortController().signal };

    expect(await editor.setCalls(request, call)).toStrictEqual({ ok: true, value: undefined });
    expect(await editor.read("ceiling-1", call)).toMatchObject({
      ok: true,
      value: { contracts: ["fake:1:swap"], perTxNativeBase: 3n },
    });
  });
});
