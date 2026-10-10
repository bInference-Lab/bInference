import { accountRefSchema, chainRefSchema } from "@binference/chain";
import { idSchema, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createCustodyCell } from "./custody-cell.js";
import type { OpenedCustody } from "./open-custody.js";

const uuid = "0190f1c2-3a4b-7c5d-8e6f-000000000001";
const wallet = idSchema("wal").parse(`wal_${uuid}`);
const chain = chainRefSchema.parse("eip155:56");
const account = accountRefSchema.parse("eip155:56:0x8894E0a0c962CB723c1976a4421c95949bE2D4E3");
const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const signed = { chain, raw: "0x02" };
const made = { account };

function opened(): OpenedCustody {
  return {
    signer: {
      account: async () => Promise.resolve(ok(account)),
      signTransaction: async () => Promise.resolve(ok(signed)),
    },
    ceilings: {
      setRecipients: async () => Promise.resolve(ok(undefined)),
      signRecipients: async () => Promise.resolve(ok([])),
      sendSigned: async () => Promise.resolve(ok(undefined)),
    },
    walletMaker: { make: async () => Promise.resolve(ok(made)) },
    stopped: new Promise(() => undefined),
    stop: async () => Promise.resolve(),
  } as never;
}

describe("the custody cell", () => {
  it("signs nothing and knows no wallet while the engine is locked", async () => {
    const cell = createCustodyCell();
    expect(cell.isOpen()).toBe(false);
    await expect(cell.signer.account(wallet, chain, live())).resolves.toStrictEqual({
      ok: false,
      error: "unknown_wallet",
    });
    await expect(cell.signer.signTransaction({} as never, live())).resolves.toStrictEqual({
      ok: false,
      error: "refused",
    });
    await expect(cell.ceilings.sendSigned({} as never, live())).rejects.toMatchObject({
      code: "wallet.custody_down",
    });
    await expect(cell.ceilings.setRecipients({} as never, live())).rejects.toMatchObject({
      code: "wallet.custody_down",
    });
    await expect(cell.ceilings.signRecipients({} as never, live())).rejects.toMatchObject({
      code: "wallet.custody_down",
    });
    await expect(cell.walletMaker.make({} as never, live())).rejects.toMatchObject({
      code: "wallet.custody_down",
    });
  });

  it("signs through the custody it holds, until that is released", async () => {
    const cell = createCustodyCell();
    const custody = opened();
    cell.hold(custody);
    expect([cell.isOpen(), cell.holds(custody)]).toStrictEqual([true, true]);
    await expect(cell.signer.account(wallet, chain, live())).resolves.toStrictEqual(ok(account));
    await expect(cell.signer.signTransaction({} as never, live())).resolves.toStrictEqual(
      ok(signed),
    );
    await expect(cell.ceilings.sendSigned({} as never, live())).resolves.toStrictEqual(
      ok(undefined),
    );
    await expect(cell.walletMaker.make({} as never, live())).resolves.toStrictEqual(ok(made));
    expect(cell.release()).toBe(custody);
    expect([cell.isOpen(), cell.holds(custody), cell.release()]).toStrictEqual([
      false,
      false,
      undefined,
    ]);
  });

  it("answers nothing on an aborted signal", async () => {
    const stopped = { signal: AbortSignal.abort(new Error("stopped")) };
    const cell = createCustodyCell();
    await expect(cell.signer.account(wallet, chain, stopped)).rejects.toThrow("stopped");
    await expect(cell.signer.signTransaction({} as never, stopped)).rejects.toThrow("stopped");
    await expect(cell.ceilings.sendSigned({} as never, stopped)).rejects.toThrow("stopped");
  });
});
