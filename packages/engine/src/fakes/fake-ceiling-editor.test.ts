import { type AccountRef, accountRefSchema } from "@binference/chain";
import { createSecret } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { ceilingEditorContract } from "../contracts/ceiling-editor-contract.js";
import { createFakeCeilingEditor, fakeOwnerKeyCode } from "./fake-ceiling-editor.js";

const accounts = [
  accountRefSchema.parse("fake:1:0x000000a1"),
  accountRefSchema.parse("fake:1:0x000000a2"),
  accountRefSchema.parse("fake:1:0x000000a3"),
] as const;

function listed(recipients: readonly AccountRef[] | undefined): readonly AccountRef[] {
  return recipients ?? [];
}

describe("the fake ceiling editor", () => {
  it.each(
    ceilingEditorContract({
      create: async () => {
        const clock = createManualClock(1_800_000_000_000);
        const editor = createFakeCeilingEditor({ clock });
        editor.put("ceiling-1", [accounts[0], accounts[1]]);
        return Promise.resolve({
          editor,
          ownerKey: createSecret(fakeOwnerKeyCode),
          otherKey: createSecret("bnok1aaaaa bbbbb ccccc ddddd eeeee"),
          ceiling: "ceiling-1",
          unknownCeiling: "ceiling-9",
          accounts,
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
});
