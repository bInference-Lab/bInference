import { join } from "node:path";
import { testNowMs } from "@binference/engine/testing";
import { writePrivateFile } from "@binference/platform";
import { afterEach, describe, expect, it } from "vitest";
import { type SkeletonComposition, skeletonCompositions } from "../compose/test-skeleton.js";
import { runCli } from "../program/run-cli.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, hostOn, noPermissions } from "./test-host.js";

const slow = { timeout: 60_000 };
const machines = createTestMachines();
const served: ServedSkeleton[] = [];
const live = { signal: new AbortController().signal };

afterEach(async () => {
  await Promise.all(served.splice(0).map(async (skeleton) => skeleton.close()));
  await machines.removeAll();
});

function selfHosted(): SkeletonComposition {
  const found = skeletonCompositions.find((item) => item.name === "self-hosted");
  if (found === undefined) {
    throw new Error("Expected the self-hosted composition.");
  }
  return found;
}

describe("the owner hears of a sign-in lockout", () => {
  it("stores one notice per locked source and credential, naming no secret", slow, async () => {
    const machine = await machines.create(testNowMs);
    const skeleton = await serveSkeleton(machine, selfHosted());
    served.push(skeleton);
    const wrong = `bnt_${"W".repeat(43)}`;
    const files = { permissions: noPermissions, ...live };
    await writePrivateFile(join(machine.folder, "auth", "cli.token"), `${wrong}\n`, files);

    // One after another, so each failure counts before the next sign-in.
    const codes = await Array.from({ length: 11 }).reduce<Promise<number[]>>(
      async (previous) => [...(await previous), await runCli(hostOn(machine, ["status"]))],
      Promise.resolve([]),
    );
    await skeleton.composed.notices.idle();

    expect(codes).toStrictEqual(Array.from({ length: 11 }, () => 1));
    const stored = await skeleton.parts.stores.notices.list({ limit: 100 }, live);
    const lockouts = stored.filter((record) => record.kind === "signInsLocked");
    expect(lockouts.map((record) => record.notice.values)).toStrictEqual([
      { what: "local", name: "" },
      { what: "unknown", name: "" },
    ]);
    expect(lockouts.map((record) => record.level)).toStrictEqual(["warning", "warning"]);
    expect(JSON.stringify(stored)).not.toContain(wrong);
  });
});
