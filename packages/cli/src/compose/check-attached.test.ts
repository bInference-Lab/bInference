import { accountRefSchema } from "@binference/chain";
import { BinferenceError, err, idSchema, ok } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createSeededRandom,
} from "@binference/core/testing";
import {
  buildCeiling,
  createPrivyApi,
  type PrivyApi,
  type PrivyId,
} from "@binference/custody-privy";
import {
  createFakePrivy,
  testAddresses,
  testCeilingRequest,
} from "@binference/custody-privy/testing";
import { createMemoryInstallStore, testWalletRecord } from "@binference/engine/testing";
import { createP256KeyPair } from "@binference/signer";
import { describe, expect, it } from "vitest";
import { checkAttached } from "./check-attached.js";

const live = { signal: new AbortController().signal };
const nowMs = 1_790_000_000_000;

// A wallet on the fake Privy whose one signer is `signer`, and an install that names it with this
// machine's key quorum, `agentQuorumId`.
async function installOf(agentQuorumId: (signer: string) => string) {
  const clock = createManualClock(nowMs);
  const privy = createFakePrivy({ clock, random: createSeededRandom(5) });
  const api = createPrivyApi({
    http: privy.http,
    clock,
    appId: privy.appId,
    appSecret: privy.appSecret,
  });
  const key = createP256KeyPair().publicKey;
  const quorum = await api.createKeyQuorum({ publicKey: key, displayName: "agent" }, live);
  const policy = await policyOf(api, quorum.id);
  const made = await api.createWallet({ owner: quorum.id, signer: quorum.id, policy }, live);
  const install = createMemoryInstallStore();
  const wallet = {
    ...testWalletRecord({
      id: idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000f1"),
      agentId: idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000f2"),
      label: "main",
      createdAtMs: nowMs,
    }),
    custodyWalletId: made.id,
  };
  const custody = {
    provider: "privy" as const,
    appId: privy.appId,
    ownerQuorumId: quorum.id,
    ownerKeyPublic: key,
    agentQuorumId: agentQuorumId(quorum.id),
    agentKeyPublic: key,
    attachedAtMs: nowMs,
  };
  const rescueAddress = accountRefSchema.parse(`fake:1:0x${"ab".repeat(20)}`);
  await install.setUp({ atMs: nowMs, custody, rescueAddress, wallet, isStartOver: false }, live);
  return { api, install, logger: createMemoryLogger({ subsystem: "engine" }) };
}

async function policyOf(api: PrivyApi, owner: PrivyId): Promise<PrivyId> {
  const ceiling = buildCeiling({
    ...testCeilingRequest(),
    rescue: testAddresses.rescue,
    saved: [],
  });
  if (!ceiling.ok) {
    throw new Error("Expected the test ceiling.");
  }
  return (await api.createPolicy({ ceiling: ceiling.value, owner }, live)).id;
}

describe("the check that this machine still signs for the wallets", () => {
  it("passes while every live wallet lists this machine's key quorum", async () => {
    const options = await installOf((signer) => signer);

    expect(await checkAttached(options, live.signal)).toStrictEqual(ok(undefined));
  });

  it("locks with signer_revoked once a wallet lists another signer", async () => {
    const options = await installOf(() => "removedquorum00000000000");

    expect(await checkAttached(options, live.signal)).toStrictEqual(err("signer_revoked"));
    expect(options.logger.records().map((record) => record.event)).toStrictEqual([
      "signer.revoked",
    ]);
  });

  it("locks with custody_unreachable when Privy does not answer", async () => {
    const options = await installOf((signer) => signer);
    const unreachable = {
      ...options.api,
      wallet: async () =>
        Promise.reject(
          new BinferenceError({ code: "custody.privy_unreachable", message: "No answer." }),
        ),
    };

    expect(await checkAttached({ ...options, api: unreachable }, live.signal)).toStrictEqual(
      err("custody_unreachable"),
    );
  });
});
