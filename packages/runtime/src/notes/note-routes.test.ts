import type { JsonValue } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import {
  createMemoryAgentDatabase,
  createMemoryNoteStore,
  createMemoryWriterFence,
} from "@binference/store/testing";
import { describe, expect, it } from "vitest";
import type { RouteOrigin, RouteReplyLine } from "../control/control-line.schema.js";
import { answerNoteRoute, type NoteRouteParts } from "./note-routes.js";

const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const live = (): AbortSignal => new AbortController().signal;

// "The owner likes stablecoins" and "stable", from their code points: only zh files spell them.
const likesStablecoins = String.fromCodePoint(
  0x4e3b,
  0x4eba,
  0x559c,
  0x6b22,
  0x7a33,
  0x5b9a,
  0x5e01,
);
const stablecoin = String.fromCodePoint(0x7a33, 0x5b9a, 0x5e01);
const stable = String.fromCodePoint(0x7a33, 0x5b9a);

async function notesOn(): Promise<NoteRouteParts & { readonly raise: () => Promise<number> }> {
  const database = createMemoryAgentDatabase();
  const fence = createMemoryWriterFence(database);
  const raise = async (): Promise<number> => fence.raise({ signal: live() });
  return {
    notes: createMemoryNoteStore(database),
    fence: await raise(),
    clock: createManualClock(5_000),
    raise,
  };
}

type NoteOp = "notes/search" | "notes/list" | "notes/write" | "notes/delete";

async function route(parts: NoteRouteParts, op: NoteOp, args: JsonValue): Promise<RouteReplyLine> {
  return routeFrom(parts, { op, args, origin: "owner" });
}

async function routeFrom(
  parts: NoteRouteParts,
  call: { readonly op: NoteOp; readonly args: JsonValue; readonly origin: RouteOrigin },
): Promise<RouteReplyLine> {
  return answerNoteRoute({ t: "route", id: "r1", ...call }, parts, live());
}

// What a reply says: its result, or its error's code.
function said(reply: RouteReplyLine): JsonValue {
  return "result" in reply ? reply.result : reply.error.code;
}

describe("answerNoteRoute", () => {
  it("writes a note with the origin the engine set, and finds it in either language", async () => {
    const parts = await notesOn();
    await route(parts, "notes/write", { agent, text: likesStablecoins });
    const written = await routeFrom(parts, {
      op: "notes/write",
      args: { agent, text: "Prefers small trades on PancakeSwap" },
      origin: "untrusted",
    });
    expect(written).toStrictEqual({
      t: "routeReply",
      id: "r1",
      result: {
        note: "2",
        agent,
        text: "Prefers small trades on PancakeSwap",
        origin: "untrusted",
        createdAt: 5_000,
        changedAt: 5_000,
      },
    });
    const texts = async (query: string): Promise<JsonValue> =>
      said(await route(parts, "notes/search", { agent, query }));
    await expect(texts(stablecoin)).resolves.toMatchObject({
      items: [{ note: "1", origin: "owner" }],
    });
    await expect(texts(stable)).resolves.toMatchObject({ items: [{ note: "1" }] });
    await expect(texts("pancake")).resolves.toMatchObject({
      items: [{ note: "2", origin: "untrusted" }],
    });
    await expect(texts("on")).resolves.toMatchObject({ items: [{ note: "2" }] });
  });

  it("lists notes a page at a time and removes one, once", async () => {
    const parts = await notesOn();
    await route(parts, "notes/write", { agent, text: "first" });
    await route(parts, "notes/write", { agent, text: "second" });
    await expect(route(parts, "notes/list", { agent, limit: 1 })).resolves.toMatchObject({
      result: { items: [{ note: "1" }], next: "1" },
    });
    await expect(
      route(parts, "notes/list", { agent, cursor: "1", limit: 1 }),
    ).resolves.toMatchObject({
      result: { items: [{ note: "2" }], next: "2" },
    });
    await expect(route(parts, "notes/delete", { note: "1" })).resolves.toStrictEqual({
      t: "routeReply",
      id: "r1",
      result: {},
    });
    await expect(route(parts, "notes/delete", { note: "1" })).resolves.toMatchObject({
      error: { code: "note.not_found", retryable: false },
    });
    await expect(route(parts, "notes/delete", { note: "nope" })).resolves.toMatchObject({
      error: { code: "note.not_found" },
    });
    await expect(route(parts, "notes/list", { agent })).resolves.toMatchObject({
      result: { items: [{ note: "2" }] },
    });
  });

  it("refuses args that break the operation, a cursor it never gave, and an overlong note", async () => {
    const parts = await notesOn();
    const refusals = await Promise.all([
      route(parts, "notes/search", { agent }),
      route(parts, "notes/list", { agent, cursor: "x" }),
      route(parts, "notes/write", { agent, text: "a".repeat(12_001) }),
    ]);
    expect(refusals.map(said)).toStrictEqual([
      "protocol.bad_args",
      "protocol.bad_args",
      "protocol.bad_args",
    ]);
  });

  it("writes nothing once a later start raised the fence", async () => {
    const parts = await notesOn();
    await parts.raise();
    await expect(route(parts, "notes/write", { agent, text: "late" })).resolves.toMatchObject({
      error: { code: "runtime.unavailable" },
    });
    await expect(route(parts, "notes/list", { agent })).resolves.toMatchObject({
      result: { items: [] },
    });
  });
});
