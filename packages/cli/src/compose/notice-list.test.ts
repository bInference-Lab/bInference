import type { ProtocolClient } from "@binference/client";
import { testAgent } from "@binference/engine/testing";
import { type NoticePushView, noticePushViewSchema, type PushFrame } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Skeleton,
  skeletonCompositions as compositions,
  startSkeleton,
} from "./test-skeleton.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
const unsettled = (): void => undefined;

// Resolves with the first notice pushed once the client is subscribed.
async function firstNotice(client: ProtocolClient) {
  let settle: (push: PushFrame) => void = unsettled;
  const pushed = new Promise<PushFrame>((resolve) => {
    settle = resolve;
  });
  let ready = unsettled;
  const subscribed = new Promise<void>((resolve) => {
    ready = resolve;
  });
  client.subscribe("notice", {
    onPush: (push) => settle(push),
    refetch: async () => Promise.resolve(ready()),
  });
  await subscribed;
  return { pushed };
}

describe.each(compositions)("the notices a client missed on the $name composition", ({ parts }) => {
  let skeleton: Skeleton | undefined;

  afterEach(async () => {
    await skeleton?.close();
    skeleton = undefined;
  });

  it("lists the stored notice its push named, with no delivery when no bot runs", async () => {
    skeleton = await startSkeleton(parts());
    const { client, composed } = skeleton;
    const { pushed } = await firstNotice(client);
    await client.call("safety/freeze", { agent: testAgent }, live());
    const push: NoticePushView = noticePushViewSchema.parse((await pushed).data);
    await composed.notices.idle();
    const listed = await client.call("notice/list", {}, live());
    expect(listed.items).toStrictEqual([{ ...push, delivered: {} }]);
    expect(push).toMatchObject({ key: "notice.frozen", agent: testAgent });
    const after = await client.call("notice/list", { cursor: push.id }, live());
    expect(after.items).toStrictEqual([]);
  });
});
