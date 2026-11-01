import { err, ok, type Result } from "@binference/core";
import { describe, expect, it } from "vitest";
import { setUp } from "../contracts/privy-custody-setup.js";
import { isPrivyId, type PrivyId } from "../privy/privy-records.js";
import { onTestChain, testAddresses } from "../testing/custody-fixtures.js";
import {
  createFakeCustodySubject,
  type FakeCustodySubject,
} from "../testing/fake-custody-subject.js";
import { setCeilingRecipients } from "./ceiling-recipients.js";
import type { OwnerAuthorize } from "./rule-plans.js";
import {
  sendSignedRecipients,
  signCeilingRecipients,
  signedRecipientsSchema,
} from "./signed-recipients.js";

const live = { signal: new AbortController().signal };
const { rescue, saved, unsaved } = testAddresses;
const unknownPolicy = "unknownpolicy00000000000" as PrivyId;

interface Made {
  readonly subject: FakeCustodySubject;
  readonly policy: PrivyId;
  readonly signed: { count: number };
  readonly authorize: OwnerAuthorize;
}

async function made(): Promise<Made> {
  const subject = createFakeCustodySubject();
  const setup = await setUp(subject);
  const wallet = await subject.api.wallet(setup.wallet.id, live);
  const policy = wallet.ok ? wallet.value.policyIds[0] : undefined;
  if (policy === undefined || !isPrivyId(policy)) {
    throw new Error("Expected the wallet's policy.");
  }
  const signed = { count: 0 };
  const authorize: OwnerAuthorize = async (request, signal) => {
    signed.count += 1;
    return subject.ownerAuthorize(request, signal);
  };
  return { subject, policy, signed, authorize };
}

const refusing: OwnerAuthorize = async () => Promise.resolve(err("refused"));

function valueOf<T>(result: Result<T, string>): T {
  if (!result.ok) {
    throw new Error(`Expected a value, got ${result.error}.`);
  }
  return result.value;
}

function soon(subject: FakeCustodySubject): number {
  return subject.clock.now() + 60_000;
}

describe("the recipients of a ceiling", () => {
  it("send no change for the recipients a ceiling lists already, in any case or order", async () => {
    const { subject, policy, signed, authorize } = await made();
    const recipients = onTestChain(saved.toLowerCase(), rescue);

    const set = await setCeilingRecipients(
      subject.api,
      { policy, recipients },
      { authorize, expiresAtMs: soon(subject), ...live },
    );

    expect([set, signed.count]).toStrictEqual([ok(undefined), 0]);
  });

  it("refuse a malformed address, more than 100 and a policy Privy does not hold", async () => {
    const { subject, policy, authorize } = await made();
    const options = { authorize, expiresAtMs: soon(subject), ...live };
    const many = Array.from({ length: 101 }, (_, n) => `0x${n.toString(16).padStart(40, "0")}`);

    expect(
      await Promise.all([
        setCeilingRecipients(subject.api, { policy, recipients: onTestChain("0x12") }, options),
        setCeilingRecipients(subject.api, { policy, recipients: onTestChain(...many) }, options),
        setCeilingRecipients(
          subject.api,
          { policy: unknownPolicy, recipients: onTestChain(rescue) },
          options,
        ),
      ]),
    ).toStrictEqual([err("malformed_address"), err("too_many_addresses"), err("not_found")]);
  });

  it("stop at an owner who refuses to sign, and change nothing", async () => {
    const { subject, policy } = await made();
    const options = { authorize: refusing, expiresAtMs: soon(subject), ...live };

    expect(
      await Promise.all([
        setCeilingRecipients(subject.api, { policy, recipients: onTestChain(unsaved) }, options),
        signCeilingRecipients(
          subject.api,
          { policy, from: onTestChain(rescue), to: onTestChain(unsaved) },
          options,
        ),
      ]),
    ).toStrictEqual([err("refused"), err("refused")]);
  });

  it("keep a change signed ahead as data that parses back the same", async () => {
    const { subject, policy, authorize } = await made();
    const signed = await signCeilingRecipients(
      subject.api,
      { policy, from: onTestChain(rescue, saved), to: onTestChain(rescue) },
      { authorize, expiresAtMs: soon(subject), ...live },
    );

    const value = valueOf(signed);
    expect(signedRecipientsSchema.parse(JSON.parse(JSON.stringify(value)))).toStrictEqual(value);
  });

  it("answer not found for a change signed ahead on a policy Privy no longer holds", async () => {
    const { subject } = await made();
    const unknown = {
      policy: unknownPolicy,
      from: onTestChain(rescue),
      to: onTestChain(saved),
      expiresAtMs: soon(subject),
      changes: [],
    };

    expect(await sendSignedRecipients(subject.api, unknown, live)).toStrictEqual(err("not_found"));
  });

  it("list only the addresses given for a chain in its send rules, and refuse a chain left with none", async () => {
    const { subject, policy, authorize } = await made();
    const options = { authorize, expiresAtMs: soon(subject), ...live };
    const elsewhere = [{ chainId: "8453", addresses: [unsaved] }];

    const set = await setCeilingRecipients(
      subject.api,
      { policy, recipients: [...onTestChain(rescue), ...elsewhere] },
      options,
    );
    const empty = await setCeilingRecipients(
      subject.api,
      { policy, recipients: elsewhere },
      options,
    );
    const sends = JSON.stringify(valueOf(await subject.api.policy(policy, live)).rules);

    expect([set, empty]).toStrictEqual([ok(undefined), err("not_found")]);
    expect([sends.includes(rescue), sends.includes(unsaved)]).toStrictEqual([true, false]);
  });

  it("read a change signed before chains were named as one list for every chain", () => {
    const kept = {
      policy: unknownPolicy,
      from: [rescue, saved],
      to: [rescue],
      expiresAtMs: 1,
      changes: [],
    };

    expect(signedRecipientsSchema.parse(kept)).toStrictEqual({
      ...kept,
      from: [{ chainId: "*", addresses: [rescue, saved] }],
      to: [{ chainId: "*", addresses: [rescue] }],
    });
  });
});
