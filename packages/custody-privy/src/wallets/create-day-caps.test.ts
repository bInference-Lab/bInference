import { describe, expect, it } from "vitest";
import { testCapPlan } from "../testing/custody-fixtures.js";
import { createFakeCustodySubject } from "../testing/fake-custody-subject.js";
import { createDayCaps } from "./create-day-caps.js";

const live = { signal: new AbortController().signal };

describe("createDayCaps", () => {
  it("makes each chain's aggregations on Privy, owned by the owner key's quorum", async () => {
    const subject = createFakeCustodySubject(4);
    const owner = await subject.api.createKeyQuorum(
      { publicKey: subject.ownerKey, displayName: "owner" },
      live,
    );
    const made = await createDayCaps(subject.api, { plans: [testCapPlan], owner: owner.id }, live);

    expect(made).toMatchObject({
      ok: true,
      value: [
        {
          native: { limitBase: testCapPlan.nativeLimitBase },
          approvals: [{ limitBase: 1_000n }],
        },
      ],
    });
  });

  it("makes none when the plans need more than Privy's 10", async () => {
    const subject = createFakeCustodySubject(4);
    const owner = await subject.api.createKeyQuorum(
      { publicKey: subject.ownerKey, displayName: "owner" },
      live,
    );
    const tokens = Array.from({ length: 10 }, (_, n) => ({
      token: `0x${(n + 1).toString(16).padStart(40, "0")}`,
      limitBase: 1n,
    }));
    const plans = [{ ...testCapPlan, approvals: tokens }];

    expect(await createDayCaps(subject.api, { plans, owner: owner.id }, live)).toStrictEqual({
      ok: false,
      error: "too_many_caps",
    });
  });
});
