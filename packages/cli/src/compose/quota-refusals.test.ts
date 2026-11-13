import type { Id } from "@binference/core";
import {
  fixtureId,
  testAgent as agent,
  testAgentDraft,
  testCoin as coin,
  testToken as token,
  testWallet as wallet,
} from "@binference/engine/testing";
import { disclaimerVersion } from "@binference/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { cloudBetaQuotas } from "./cloud-test-root.js";
import {
  type Skeleton,
  type SkeletonComposition,
  skeletonCompositions as compositions,
  startSkeleton,
} from "./test-skeleton.js";

// Decision 0431: on the Cloud-shaped composition a user past a quota is refused before anything
// is stored; the self-hosted composition refuses nothing it took before.

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });

const swapRequest = {
  kind: "swap" as const,
  agent,
  wallet,
  reason: "Rotate into the token",
  from: coin,
  to: token,
  amount: { base: 1_000_000n },
};

function compositionNamed(name: string): SkeletonComposition {
  const found = compositions.find((composition) => composition.name === name);
  if (found === undefined) {
    throw new Error(`No ${name} composition.`);
  }
  return found;
}

const cloud = compositionNamed("Cloud-shaped");
const selfHosted = compositionNamed("self-hosted");

// Makes agents `from` to `to` of the fixtures as the install's own write path does, within the
// agents' quota its quota source answers now.
async function makeAgents(skeleton: Skeleton, from: number, to: number) {
  const { stores, quotas } = skeleton.parts;
  const quota = (await quotas.read(live())).agents;
  const within = { ...live(), ...(quota === undefined ? {} : { quota }) };
  const made = [];
  for (let n = from; n <= to; n += 1) {
    const draft = testAgentDraft({ id: fixtureId("agt", n), name: `agent ${String(n)}` });
    // oxlint-disable-next-line eslint/no-await-in-loop -- one agent after another
    const result = await stores.agents.create(draft, within);
    made.push(result.ok ? "made" : result.error);
  }
  return made;
}

async function proposeSeven(skeleton: Skeleton) {
  const { client } = skeleton;
  const answers: (Id<"int"> | string)[] = [];
  for (let n = 1; n <= 7; n += 1) {
    const key = `swap-${String(n)}`;
    // oxlint-disable-next-line eslint/no-await-in-loop -- one proposal after another
    const answer = await client.call("intent/propose", swapRequest, { ...live(), key }).then(
      (view) => view.intent,
      (error: unknown) => (error instanceof Error && "code" in error ? String(error.code) : "?"),
    );
    answers.push(answer);
  }
  return answers;
}

describe("quotas on bInference Cloud's composition", () => {
  let skeleton: Skeleton | undefined;

  afterEach(async () => {
    await skeleton?.close();
    skeleton = undefined;
  });

  it("refuses a fourth agent, storing nothing", async () => {
    skeleton = await startSkeleton(cloud.parts());
    expect(cloudBetaQuotas.agents).toBe(3);
    expect(await makeAgents(skeleton, 2, 4)).toStrictEqual(["made", "made", "quota"]);
    expect(await skeleton.parts.stores.agents.list(live())).toHaveLength(3);
  });

  it("refuses a second live agent and keeps the agent on paper", async () => {
    skeleton = await startSkeleton(cloud.parts());
    const other = testAgentDraft({ id: fixtureId("agt", 8), name: "other", mode: "live" });
    expect((await skeleton.parts.stores.agents.create(other, live())).ok).toBe(true);
    const accepted = { agent, disclaimer: disclaimerVersion };
    await expect(skeleton.client.call("agent/goLive", accepted, live())).rejects.toMatchObject({
      code: "quota.live_agents",
      retryable: false,
    });
    expect((await skeleton.parts.stores.agents.get(agent, live()))?.agent.mode).toBe("paper");
  });

  it("refuses a seventh proposal in a minute and answers a replay its first result", async () => {
    skeleton = await startSkeleton(cloud.parts());
    const answers = await proposeSeven(skeleton);
    expect(answers.slice(6)).toStrictEqual(["quota.proposals"]);
    const replayed = await skeleton.client.call("intent/propose", swapRequest, {
      ...live(),
      key: "swap-1",
    });
    expect(replayed.intent).toBe(answers[0]);
  });
});

describe("quotas on the self-hosted composition", () => {
  let skeleton: Skeleton | undefined;

  afterEach(async () => {
    await skeleton?.close();
    skeleton = undefined;
  });

  it("refuses no agent and no proposal it took before", async () => {
    skeleton = await startSkeleton(selfHosted.parts());
    expect(await makeAgents(skeleton, 2, 5)).toStrictEqual(["made", "made", "made", "made"]);
    const answers = await proposeSeven(skeleton);
    expect(answers.every((answer) => answer.startsWith("int_"))).toBe(true);
  });
});
