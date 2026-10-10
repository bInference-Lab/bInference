import { generateKeyPairSync } from "node:crypto";
import { err, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import { setUp } from "../contracts/privy-custody-setup.js";
import { createFakeCustodySubject } from "../testing/fake-custody-subject.js";
import { ownerSigner } from "../testing/owner-signer.js";
import type { OwnerAuthorize } from "../wallets/rule-plans.js";
import type { PrivyId } from "./privy-records.js";

const live = { signal: new AbortController().signal };
const minuteMs = 60_000;

async function made() {
  const subject = createFakeCustodySubject();
  const setup = await setUp(subject);
  const record = await subject.api.wallet(setup.wallet.id, live);
  if (!record.ok) {
    throw new Error("Expected the wallet.");
  }
  const publicKey = await subject.strangerProcess.publicKey(live);
  const quorum = await subject.api.createKeyQuorum(
    { publicKey, displayName: "binference agent key" },
    live,
  );
  const [policy] = record.value.policyIds;
  if (policy === undefined) {
    throw new Error("Expected the wallet's policy.");
  }
  const change = {
    wallet: setup.wallet.id,
    signers: [{ signer: quorum.id, policies: [policy] }],
    expiresAtMs: subject.clock.now() + 5 * minuteMs,
  };
  return { subject, record: record.value, change, quorum: quorum.id, policy };
}

const refusing: OwnerAuthorize = async () => Promise.resolve(err("refused"));

const stranger: OwnerAuthorize = ownerSigner(
  generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey,
);

describe("a change of a wallet's signers", () => {
  it("replaces every signer once the owner key signs, and answers the wallet after it", async () => {
    const { subject, record, change, quorum, policy } = await made();
    const authorize = subject.ownerAuthorize;

    const set = await subject.api.setSigners(change, { authorize, ...live });

    expect(set).toStrictEqual(
      ok({ ...record, signers: [{ signerId: quorum, overridePolicyIds: [policy] }] }),
    );
  });

  it("signs exactly the PATCH it sends, with the app id and the expiry", async () => {
    const { subject, change, quorum, policy } = await made();
    const asked: unknown[] = [];
    const authorize: OwnerAuthorize = async (request, signal) => {
      asked.push(request);
      return subject.ownerAuthorize(request, signal);
    };

    await subject.api.setSigners(change, { authorize, ...live });

    expect(asked).toStrictEqual([
      {
        method: "PATCH",
        url: `${subject.privy.origin}/v1/wallets/${change.wallet}`,
        headers: {
          "privy-app-id": subject.privy.appId,
          "privy-request-expiry": String(change.expiresAtMs),
        },
        body: {
          additional_signers: [
            {
              signer_id: quorum,
              override_policy_ids: [policy],
            },
          ],
        },
      },
    ]);
  });

  it("changes nothing for a key that is not the owner key, or an owner that refuses", async () => {
    const { subject, record, change } = await made();

    expect(await subject.api.setSigners(change, { authorize: stranger, ...live })).toStrictEqual(
      err("refused"),
    );
    expect(await subject.api.setSigners(change, { authorize: refusing, ...live })).toStrictEqual(
      err("refused"),
    );
    expect(await subject.api.wallet(record.id, live)).toStrictEqual(ok(record));
  });

  it("is refused when signed by the wallet's added signer, which never moves signers", async () => {
    const { subject, change, policy } = await made();
    const agent = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const publicKey = agent.publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const quorum = await subject.api.createKeyQuorum({ publicKey, displayName: "agent" }, live);
    const asOwner = { authorize: subject.ownerAuthorize, ...live };
    const signers = [{ signer: quorum.id, policies: [policy] }];
    const held = await subject.api.setSigners({ ...change, signers }, asOwner);
    const asSigner = { authorize: ownerSigner(agent.privateKey), ...live };

    expect(await subject.api.setSigners(change, asSigner)).toStrictEqual(err("refused"));
    expect(await subject.api.wallet(change.wallet, live)).toStrictEqual(held);
  });

  it("is expired when its expiry passed before Privy read it, and changes nothing", async () => {
    const { subject, record, change } = await made();
    const stale = { ...change, expiresAtMs: subject.clock.now() - 1 };

    expect(
      await subject.api.setSigners(stale, { authorize: subject.ownerAuthorize, ...live }),
    ).toStrictEqual(err("expired"));
    expect(await subject.api.wallet(record.id, live)).toStrictEqual(ok(record));
  });

  it("answers not_found for a wallet Privy does not hold", async () => {
    const { subject, change } = await made();
    const unknown = { ...change, wallet: "unknownwallet00000000000" as PrivyId };

    expect(
      await subject.api.setSigners(unknown, { authorize: subject.ownerAuthorize, ...live }),
    ).toStrictEqual(err("not_found"));
  });

  it("throws Privy's refusal of a signer that is no key quorum of the app", async () => {
    const { subject, change } = await made();
    const signers = [{ signer: "unknownquorum00000000000" as PrivyId, policies: [] }];

    await expect(
      subject.api.setSigners(
        { ...change, signers },
        { authorize: subject.ownerAuthorize, ...live },
      ),
    ).rejects.toMatchObject({ code: "custody.privy_refused" });
  });
});
