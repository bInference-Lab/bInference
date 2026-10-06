import { describe, expect, it } from "vitest";
import { z } from "zod";
import { byeFrameSchema } from "./bye-frame.schema.js";
import { callFrameSchema } from "./call-frame.schema.js";
import { challengeFrameSchema } from "./challenge-frame.schema.js";
import { failFrameSchema } from "./fail-frame.schema.js";
import { decodeClientFrame, decodeEngineFrame } from "./frame.schema.js";
import { openFrameSchema } from "./open-frame.schema.js";
import { proveFrameSchema } from "./prove-frame.schema.js";
import { pushFrameSchema } from "./push-frame.schema.js";
import { readyFrameSchema } from "./ready-frame.schema.js";
import { replyFrameSchema } from "./reply-frame.schema.js";

const uuid = "0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const token = `bnt_${"Ab3-_".repeat(8)}xyz`;

const open = {
  t: "open",
  v: 1,
  client: { kind: "console", version: "2026.10.1", locale: "zh" },
  auth: { device: `dev_${uuid}` },
} as const;
const prove = { t: "prove", signature: "s1G-_".repeat(17).concat("x") } as const;
const call = {
  t: "call",
  id: "7",
  op: "intent/propose",
  args: { agent: `agt_${uuid}`, amount: { base: "1500000000000000000" } },
  key: `int_${uuid}`,
} as const;
const challenge = { t: "challenge", nonce: "n0nce-_".repeat(6).concat("x") } as const;
const ready = {
  t: "ready",
  v: 1,
  connection: `con_${uuid}`,
  scopes: ["read", "propose", "chat", "confirm", "loosen", "admin"],
  engine: { version: "2026.10.1", protocol: 1, state: "starting" },
  owner: { locale: "zh", timezone: "Asia/Shanghai" },
} as const;
const reply = { t: "reply", id: "7", result: { intent: `int_${uuid}`, state: "waiting" } } as const;
const fail = {
  t: "fail",
  id: "7",
  error: {
    code: "auth.scope",
    message: "The call needs the confirm scope.",
    retryable: false,
    details: { scope: "confirm", attempt: 1, isLocal: true },
  },
} as const;
const push = {
  t: "push",
  topic: `chat:agt_${uuid}`,
  seq: 1,
  kind: "chat/message",
  data: {},
} as const;
const bye = {
  t: "bye",
  code: "protocol.not_open",
  message: "The first frame must be open.",
} as const;

const schemas = {
  open: openFrameSchema,
  prove: proveFrameSchema,
  call: callFrameSchema,
  challenge: challengeFrameSchema,
  ready: readyFrameSchema,
  reply: replyFrameSchema,
  fail: failFrameSchema,
  push: pushFrameSchema,
  bye: byeFrameSchema,
} as const;

const clientFrames = [
  ["an open from a console device", open],
  ["an open with a client token", { ...open, auth: { token } }],
  ["an open from the Mini App", { ...open, auth: { telegram: { initData: "a=1" } } }],
  ["a prove", prove],
  ["a call", call],
  ["a call without a key", { t: "call", id: "8", op: "engine/status", args: {} }],
] as const;

const engineFrames = [
  ["a challenge", challenge],
  ["a ready", ready],
  ["a reply", reply],
  ["a fail", fail],
  [
    "a fail without details",
    {
      t: "fail",
      id: "8",
      error: { code: "engine.starting", message: "Starting.", retryable: true },
    },
  ],
  ["a push on a chat topic", push],
  ["a push on a fixed topic", { ...push, topic: "order", kind: "order/filled" }],
  ["a bye", bye],
] as const;

describe("client frames", () => {
  it.each(clientFrames)("decodes %s through its schema and encodes it back", (_name, frame) => {
    const schema = schemas[frame.t];
    const decoded = z.decode(schema, frame);
    expect(decoded).toStrictEqual(frame);
    expect(z.encode(schema, decoded)).toStrictEqual(frame);
  });

  it.each(clientFrames)("reads %s from its JSON text", (_name, frame) => {
    expect(decodeClientFrame(JSON.stringify(frame))).toStrictEqual({ ok: true, value: frame });
  });
});

describe("engine frames", () => {
  it.each(engineFrames)("decodes %s through its schema and encodes it back", (_name, frame) => {
    const schema = schemas[frame.t];
    const decoded = z.decode(schema, frame);
    expect(decoded).toStrictEqual(frame);
    expect(z.encode(schema, decoded)).toStrictEqual(frame);
  });

  it.each(engineFrames)("reads %s from its JSON text", (_name, frame) => {
    expect(decodeEngineFrame(JSON.stringify(frame))).toStrictEqual({ ok: true, value: frame });
  });

  it("drops a field a newer engine adds inside the version", () => {
    const decoded = decodeEngineFrame(JSON.stringify({ ...ready, region: "eu" }));
    expect(decoded).toStrictEqual({ ok: true, value: ready });
  });
});

describe("refused frames", () => {
  it.each([
    ["an unknown frame type", { t: "hello" }],
    ["an engine frame", ready],
    ["an open without a credential", { ...open, auth: undefined }],
    ["an open with two credentials", { ...open, auth: { token, device: `dev_${uuid}` } }],
    ["an open with an AI gateway key", { ...open, auth: { token: `binf_${"A".repeat(43)}` } }],
    ["a call id over 64 characters", { ...call, id: "c".repeat(65) }],
    ["an idempotency key over 64 characters", { ...call, key: "k".repeat(65) }],
    ["a call without args", { t: "call", id: "9", op: "engine/status" }],
    ["an operation without a domain", { ...call, op: "propose" }],
  ] as const)("the engine refuses %s as a bad frame", (_name, frame) => {
    expect(decodeClientFrame(JSON.stringify(frame))).toStrictEqual({
      ok: false,
      error: "protocol.bad_frame",
    });
  });

  it.each([
    ["an unknown frame type", { t: "welcome" }],
    ["a client frame", open],
    ["a push with seq 0", { ...push, seq: 0 }],
    ["a chat topic without an agent id", { ...push, topic: `chat:wal_${uuid}` }],
    ["a fail whose code has no area", { ...fail, error: { ...fail.error, code: "scope" } }],
    ["a ready with an unknown scope", { ...ready, scopes: ["root"] }],
  ] as const)("a client refuses %s as a bad frame", (_name, frame) => {
    expect(decodeEngineFrame(JSON.stringify(frame))).toStrictEqual({
      ok: false,
      error: "protocol.bad_frame",
    });
  });

  it.each(["", "{", "[1,", "open"])("both sides refuse the text %j as a bad frame", (text) => {
    const refused = { ok: false, error: "protocol.bad_frame" };
    expect(decodeClientFrame(text)).toStrictEqual(refused);
    expect(decodeEngineFrame(text)).toStrictEqual(refused);
  });

  it.each([
    ["a newer version", { ...open, v: 2 }],
    ["a newer version in a shape this version does not know", { t: "open", v: 2, hello: {} }],
    ["a version older than every served one", { ...open, v: 0 }],
  ] as const)("the engine refuses an open of %s as an unserved version", (_name, frame) => {
    expect(decodeClientFrame(JSON.stringify(frame))).toStrictEqual({
      ok: false,
      error: "protocol.version",
    });
  });
});
