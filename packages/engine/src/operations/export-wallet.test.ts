import { err, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fakeOwnerKeyCode } from "../fakes/fake-ceiling-editor.js";
import { createFakeWalletExporter, fakeRecipient } from "../fakes/fake-wallet-exporter.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { expectOk, testAgent, testNowMs } from "../intents/test-intents.js";
import { startTestEngine, type TestEngine, testCall } from "./test-engine.js";

const key = `0x${"cd".repeat(32)}`;
const wallet = testWalletRecord({
  id: idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000e1"),
  agentId: testAgent,
  label: "old",
  createdAtMs: testNowMs - 2_000,
  archivedAtMs: testNowMs - 1_000,
});

async function started(withExporter = true): Promise<TestEngine> {
  const keys = new Map([[wallet.custodyWalletId, key]]);
  const test = await startTestEngine(
    withExporter ? { exporter: createFakeWalletExporter({ keys }) } : {},
  );
  test.stores.install.addWallet(wallet);
  return test;
}

interface ExportChange {
  readonly ownerKey?: string;
  readonly recipient?: string;
}

async function exported(test: TestEngine, change: ExportChange = {}) {
  const recipient = await fakeRecipient(1);
  const args = {
    wallet: wallet.id,
    recipientPublicKey: change.recipient ?? recipient.publicKey,
    ownerKey: change.ownerKey ?? fakeOwnerKeyCode,
  };
  return { recipient, answer: await test.engine.handlers["wallet/exportSealed"](testCall(args)) };
}

describe("exporting a wallet's key sealed to the CLI's recipient key", () => {
  it("answers the key as custody sealed it, an archived wallet's too, and keeps nothing", async () => {
    const test = await started();
    const before = test.pushes.length;

    const { recipient, answer } = await exported(test);

    expect(await recipient.open(expectOk(answer))).toBe(key);
    expect(test.pushes).toHaveLength(before);
  });

  it("refuses another key, a recipient key that is none and a wallet it does not hold", async () => {
    const test = await started();
    const other = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000e9");
    const unknown = await test.engine.handlers["wallet/exportSealed"](
      testCall({ wallet: other, recipientPublicKey: "AAAA", ownerKey: fakeOwnerKeyCode }),
    );

    expect((await exported(test, { ownerKey: "bnok1x" })).answer).toStrictEqual(
      err("wallet.bad_owner_key"),
    );
    expect((await exported(test, { recipient: "AAAA" })).answer).toStrictEqual(
      err("protocol.bad_args"),
    );
    expect(unknown).toStrictEqual(err("wallet.not_found"));
  });

  it("is custody down where custody gives no export", async () => {
    const test = await started(false);

    expect((await exported(test)).answer).toStrictEqual(err("wallet.custody_down"));
  });
});
