import { err, idSchema, type Result } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import {
  type LaunchTokenRequest,
  noUploadImage,
  type ProtocolErrorCode,
} from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testPng } from "../chat/test-images.js";
import type { CardRecord } from "../intents/card-record.js";
import type { IntentReason } from "../intents/intent-reason.js";
import type { IntentRecord } from "../intents/intent-record.js";
import type { IntentState } from "../intents/intent-state.js";
import { testAgent, testNowMs, testWallet } from "../intents/test-intents.js";
import { testLaunch } from "../money-path/test-launches.js";
import { testChains } from "../operations/test-engine.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { createUploadShelf, type UploadShelf } from "../uploads/upload-shelf.js";
import { createLaunchDraftDesk, type LaunchDraftDeskOptions } from "./launch-draft-desk.js";
import { createLaunchDraftShelf, type LaunchDraft } from "./launch-draft-shelf.js";

const ref = "d3Zr_x9-AbCdEfGh";
const ownerId = 7_012_345_678;
const launchId = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-0000000000aa");

const testDraft: LaunchDraft = {
  id: "c2hvd24tb25jZS1h",
  ref,
  agentId: testAgent,
  agentName: "main",
  request: { ...testLaunch, image: noUploadImage },
  settings: [],
  hasOutsideContent: false,
  expiresAtMs: testNowMs + 600_000,
};

// A proposal the engine refuses, as one while another launch is under way.
const refuseAll: LaunchDraftDeskOptions["propose"] = async () =>
  Promise.resolve<Result<never, ProtocolErrorCode>>(err("intent.launch_waiting"));

// The launch a draft's Start proposed, as the store keeps it, in `state`.
function launchIn(state: IntentState, reason?: IntentReason): IntentRecord {
  return {
    id: launchId,
    agentId: testAgent,
    walletId: testWallet,
    kind: "launchToken",
    state,
    ...(reason === undefined ? {} : { reason }),
    request: {},
    hasOutsideContent: false,
    isPaper: false,
    proposer: "telegram",
    draftRef: ref,
    createdAtMs: testNowMs,
    changedAtMs: testNowMs,
    version: 3,
  };
}

// The stored launches: `launch`, found by its draft's reference, with `cards` card versions.
function storedLaunches(launch?: IntentRecord, cards = 0): LaunchDraftDeskOptions["intents"] {
  const card = { closeReason: "confirmed" } as unknown as CardRecord;
  return {
    byDraftRef: async (draftRef) =>
      Promise.resolve(draftRef === launch?.draftRef ? launch : undefined),
    cards: async () => Promise.resolve(Array.from({ length: cards }, () => card)),
  };
}

// A desk holding one draft, proposing through `propose`, with the owner paired; a draft absent is
// one a restart forgot.
function deskOf(
  draft: LaunchDraft | undefined,
  propose: LaunchDraftDeskOptions["propose"],
  intents: LaunchDraftDeskOptions["intents"] = storedLaunches(),
) {
  const clock = createManualClock(testNowMs);
  const shelf = createLaunchDraftShelf();
  if (draft !== undefined) {
    shelf.put(draft);
  }
  const pushes: EnginePush[] = [];
  const uploads: UploadShelf = createUploadShelf({ clock, random: createSeededRandom(1) });
  const desk = createLaunchDraftDesk({
    shelf,
    host: { picturePlace: () => (draft?.picture === undefined ? "link" : "upload") },
    chains: testChains(),
    uploads,
    propose,
    intents,
    owners: { get: async () => Promise.resolve({ userId: ownerId, pairedAtMs: 1 }) },
    clock,
    publish: (push) => pushes.push(push),
  });
  return { desk, pushes, uploads };
}

describe("the launch draft desk", () => {
  it("ends the draft as failed when the proposal behind a Start throws", async () => {
    const { desk, pushes } = deskOf(testDraft, async () =>
      Promise.reject(new Error("The engine stopped.")),
    );
    const signal = AbortSignal.timeout(5_000);
    expect(await desk.start(ref, ownerId, { signal })).toStrictEqual({ status: "starting" });
    await desk.idle();
    expect(pushes.map(({ kind, data }) => [kind, data])).toStrictEqual([
      [
        "chat/launchDraftClosed",
        { agent: testAgent, draft: "c2hvd24tb25jZS1h", outcome: "failed", error: "internal.error" },
      ],
    ]);
    expect(await desk.drop(ref, ownerId, { signal })).toStrictEqual({ status: "unknown" });
  });

  it("drops the draft's photo from the upload shelf when its Start is refused", async () => {
    const picture = {
      bytes: testPng,
      image: { contentType: "image/png", bytes: testPng.byteLength, sha256: "a".repeat(64) },
    } as const;
    const images: string[] = [];
    const refuse: LaunchDraftDeskOptions["propose"] = async ({ args }) => {
      images.push((args as LaunchTokenRequest).image);
      return Promise.resolve<Result<never, ProtocolErrorCode>>(err("intent.launch_waiting"));
    };
    const { desk, uploads } = deskOf({ ...testDraft, picture } as LaunchDraft, refuse);
    await desk.start(ref, ownerId, { signal: AbortSignal.timeout(5_000) });
    await desk.idle();
    expect([images.length, images.map((image) => uploads.holderOf(image))]).toStrictEqual([
      1,
      [undefined],
    ]);
  });

  it("answers where the launch a forgotten draft started stands, and never starts another", async () => {
    const proposals: unknown[] = [];
    const propose: LaunchDraftDeskOptions["propose"] = async ({ args }) => {
      proposals.push(args);
      return Promise.resolve<Result<never, ProtocolErrorCode>>(err("intent.launch_waiting"));
    };
    const signal = AbortSignal.timeout(5_000);
    const waiting = deskOf(undefined, propose, storedLaunches(launchIn("quoted")));
    const carded = deskOf(undefined, propose, storedLaunches(launchIn("reconciled"), 1));
    const lost = storedLaunches(launchIn("failed_check", "upload_lost"));
    const ended = deskOf(undefined, propose, lost);
    expect(await waiting.desk.start(ref, ownerId, { signal })).toStrictEqual({
      status: "launched",
      intent: launchId,
    });
    expect(await carded.desk.drop(ref, ownerId, { signal })).toStrictEqual({
      status: "launched",
      intent: launchId,
    });
    expect(await ended.desk.start(ref, ownerId, { signal })).toStrictEqual({
      status: "launched",
      intent: launchId,
      endedBeforeCard: "upload_lost",
    });
    expect(proposals).toStrictEqual([]);
  });

  it("answers unknown for a forgotten draft that started nothing, and to anyone but the owner", async () => {
    const signal = AbortSignal.timeout(5_000);
    const forgotten = deskOf(undefined, refuseAll);
    const stranger = deskOf(undefined, refuseAll, storedLaunches(launchIn("quoted")));
    expect(await forgotten.desk.start(ref, ownerId, { signal })).toStrictEqual({
      status: "unknown",
    });
    expect(await stranger.desk.start(ref, 42, { signal })).toStrictEqual({ status: "unknown" });
  });
});
