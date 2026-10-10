import { accountRefSchema } from "@binference/chain";
import { err, idSchema, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fakeOwnerKeyCode } from "../fakes/fake-ceiling-editor.js";
import { createFakeSignerRevoker, type FakeSignerRevoker } from "../fakes/fake-signer-revoker.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { testAgent, testNowMs } from "../intents/test-intents.js";
import { signerRevokedKey } from "./signer-revoked-notice.js";
import { startTestEngine, type TestEngine, testCall } from "./test-engine.js";

const live = testWalletRecord({
  id: idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000d1"),
  agentId: testAgent,
  label: "main",
  createdAtMs: testNowMs - 2_000,
});
const archived = testWalletRecord({
  id: idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000d2"),
  agentId: testAgent,
  label: "old",
  createdAtMs: testNowMs - 3_000,
  archivedAtMs: testNowMs - 2_500,
});
const ownQuorum = "own-agent-quorum";

interface Started {
  readonly test: TestEngine;
  readonly revoker: FakeSignerRevoker;
}

// An install set up with this machine's key quorum, a live wallet listing two other signers and
// an archived one listing the old signer alone.
async function started(
  liveSigners: readonly string[] = ["old-signer", ownQuorum],
  withRevoker = true,
): Promise<Started> {
  const revoker = createFakeSignerRevoker(
    new Map([
      [live.custodyWalletId, liveSigners],
      [archived.custodyWalletId, ["old-signer"]],
    ]),
  );
  const test = await startTestEngine(withRevoker ? { revoker } : {});
  const custody = {
    provider: "privy" as const,
    appId: "app",
    ownerQuorumId: "owner-quorum",
    ownerKeyPublic: "b3duZXI=",
    agentQuorumId: ownQuorum,
    agentKeyPublic: "YWdlbnQ=",
    attachedAtMs: testNowMs - 2_000,
  };
  const rescueAddress = accountRefSchema.parse(`fake:1:0x${"ab".repeat(20)}`);
  const setup = { atMs: testNowMs, custody, rescueAddress, wallet: live, isStartOver: false };
  await test.stores.install.setUp(setup, { signal: new AbortController().signal });
  test.stores.install.addWallet(archived);
  return { test, revoker };
}

async function revoke(test: TestEngine, signer: string, ownerKey = fakeOwnerKeyCode) {
  return test.engine.handlers["signer/revoke"](testCall({ signer, ownerKey }));
}

describe("revoking a machine's agent key with the owner key", () => {
  it("removes it from every live wallet, never an archived one, and announces it", async () => {
    const { test, revoker } = await started();
    const before = test.pushes.length;

    expect(await revoke(test, "old-signer")).toStrictEqual(ok({}));

    expect(revoker.signersOf(live.custodyWalletId)).toStrictEqual([ownQuorum]);
    expect(revoker.signersOf(archived.custodyWalletId)).toStrictEqual(["old-signer"]);
    expect(test.pushes.slice(before)).toMatchObject([
      {
        topic: "notice",
        data: { key: signerRevokedKey, values: { signer: "old-signer", surface: "cli" } },
      },
    ]);
  });

  it("refuses this engine's own key, which would leave it signing nothing", async () => {
    const { test, revoker } = await started();
    const before = test.pushes.length;

    expect(await revoke(test, ownQuorum)).toStrictEqual(err("signer.own_key"));

    expect(revoker.signersOf(live.custodyWalletId)).toStrictEqual(["old-signer", ownQuorum]);
    expect(test.pushes).toHaveLength(before);
  });

  it("maps a wrong key, a signer none lists and the last signer to their codes", async () => {
    const { test, revoker } = await started();

    expect(await revoke(test, "old-signer", "bnok1x")).toStrictEqual(err("wallet.bad_owner_key"));
    expect(await revoke(test, "nobody")).toStrictEqual(err("signer.not_found"));
    expect(await revoke(test, "old-signer")).toStrictEqual(ok({}));
    expect(await revoke(test, "old-signer")).toStrictEqual(err("signer.not_found"));
    expect(revoker.signersOf(live.custodyWalletId)).toStrictEqual([ownQuorum]);
  });

  it("refuses the last signer a live wallet has, and changes nothing", async () => {
    const { test, revoker } = await started(["lonely-signer"]);

    expect(await revoke(test, "lonely-signer")).toStrictEqual(err("signer.last_signer"));
    expect(revoker.signersOf(live.custodyWalletId)).toStrictEqual(["lonely-signer"]);
  });

  it("is custody down where custody removes no signer", async () => {
    const { test } = await started(undefined, false);

    expect(await revoke(test, "old-signer")).toStrictEqual(err("wallet.custody_down"));
  });
});
