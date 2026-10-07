import { createPublicKey, verify } from "node:crypto";
import { PassThrough } from "node:stream";
import { authorizationPayload } from "@binference/chain";
import { signerProcessContract } from "@binference/chain/testing";
import { createSecret, idSchema } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { formatAgentKey } from "../agent-key/agent-key-text.js";
import { createP256KeyPair } from "../keys/p256-key-pair.js";
import { maxLineBytes } from "../process/read-lines.js";
import { serveSigner } from "../process/serve-signer.js";
import { authorizeFixture, fixtureNowMs, fixtureSettings } from "../testing/sign-fixtures.js";
import { maxWaitingCalls, openSignerClient, type SignerRefusalNotice } from "./signer-client.js";

const agentKey = createP256KeyPair();
const keyText = formatAgentKey(agentKey).reveal();
const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

// A client whose signer the test plays: it reads what the client wrote and writes answers.
async function scripted() {
  const answers = new PassThrough();
  const written: string[] = [];
  const notices: SignerRefusalNotice[] = [];
  const logger = createMemoryLogger({ subsystem: "engine" });
  let failWrites = false;
  const client = await openSignerClient({
    answers,
    write: async (line) => {
      if (failWrites) {
        throw new Error("the signer's input is closed");
      }
      written.push(line);
    },
    end: async () => {
      answers.end();
    },
    settings: fixtureSettings,
    agentKey: createSecret(keyText),
    logger,
    onRefusal: (notice) => notices.push(notice),
  });
  const answer = (line: object): void => {
    answers.write(`${JSON.stringify(line)}\n`);
  };
  const requests = () => written.slice(2).map((line) => JSON.parse(line) as { id: string });
  const breakWrites = (): void => {
    failWrites = true;
  };
  return { client, answers, answer, written, requests, notices, logger, breakWrites };
}

// Lets the client's read loop and queued calls run; streams move on process ticks, which the
// fake timers leave alone.
const tick = async (): Promise<void> =>
  new Promise((resolve) => {
    process.nextTick(resolve);
  });

async function settle(): Promise<void> {
  await Array.from({ length: 20 }).reduce<Promise<void>>(async (turn) => turn.then(tick), tick());
}

const otherWallet = {
  ...authorizeFixture().wallet,
  id: idSchema("wal").parse("wal_0192f3a4-5b6c-7d8e-9f00-aabbccddeeff"),
};

// A client over a signer served in this process, on the fixtures' clock.
async function served() {
  const toSigner = new PassThrough();
  const fromSigner = new PassThrough();
  const serving = serveSigner({
    input: toSigner,
    write: async (line) => {
      fromSigner.write(`${line}\n`);
    },
    now: () => fixtureNowMs,
  });
  const client = await openSignerClient({
    answers: fromSigner,
    write: async (line) => {
      toSigner.write(`${line}\n`);
    },
    end: async () => {
      toSigner.end();
    },
    settings: fixtureSettings,
    agentKey: createSecret(keyText),
    logger: createMemoryLogger({ subsystem: "engine" }),
    onRefusal: () => undefined,
  });
  const stop = async (): Promise<void> => {
    await client.close();
    await serving;
    fromSigner.end();
    await client.ended;
  };
  return { client, stop };
}

describe("signer client", () => {
  const running: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(running.splice(0).map(async (stop) => stop()));
  });

  it.each(
    signerProcessContract({
      create: async () => {
        const { client, stop } = await served();
        running.push(stop);
        return { signerProcess: client, input: authorizeFixture() };
      },
    }),
  )("follows the SignerProcess contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("talks to a signer: settings, then the key, then publicKey and authorize", async () => {
    const { client, stop } = await served();
    const input = authorizeFixture();

    await expect(client.publicKey(live())).resolves.toBe(agentKey.publicKey);
    const signed = await client.authorize(input, live());
    await stop();

    const { value } = signed as { readonly value: string };

    expect(signed.ok).toBe(true);
    expect(
      verify(
        "sha256",
        authorizationPayload(input.request),
        createPublicKey(agentKey.privateKey),
        Buffer.from(value, "base64"),
      ),
    ).toBe(true);
  });

  it("writes the settings line and the key's line before any request", async () => {
    const { written } = await scripted();

    expect(written).toStrictEqual([JSON.stringify(fixtureSettings), keyText]);
  });

  it("logs a refusal by its reason and ids only, and raises it as a notice", async () => {
    const { client, answer, requests, notices, logger } = await scripted();
    const input = authorizeFixture();
    const result = client.authorize(input, live());
    await settle();
    answer({ id: requests()[0]?.id, ok: false, refused: "malformed" });

    await expect(result).resolves.toStrictEqual({ ok: false, error: "malformed" });
    expect(notices).toStrictEqual([
      { wallet: input.wallet.id, intent: input.intent, refused: "malformed" },
    ]);
    expect(logger.records()).toStrictEqual([
      {
        level: "warn",
        subsystem: "engine",
        event: "signer.refused",
        fields: { intentId: input.intent, errorCode: "signer.malformed" },
      },
    ]);
    expect(JSON.stringify(logger.records())).not.toContain(keyText.slice(0, 16));
  });

  it("logs a hard rule refusal by the rule's number", async () => {
    const { client, answer, requests, notices, logger } = await scripted();
    const input = authorizeFixture();
    const result = client.authorize(input, live());
    await settle();
    answer({ id: requests()[0]?.id, ok: false, refused: "rule_3" });

    await expect(result).resolves.toStrictEqual({ ok: false, error: "rule_3" });
    expect(notices).toStrictEqual([
      { wallet: input.wallet.id, intent: input.intent, refused: "rule_3" },
    ]);
    expect(logger.records().map((record) => record.fields)).toStrictEqual([
      { intentId: input.intent, errorCode: "signer.rule_3" },
    ]);
  });

  it("sends one request per wallet at a time, and wallets side by side", async () => {
    const { client, answer, requests } = await scripted();
    const input = authorizeFixture();
    const first = client.authorize(input, live());
    const second = client.authorize(input, live());
    const other = client.authorize({ ...input, wallet: otherWallet }, live());
    await settle();
    const beforeAnswer = requests().map((request) => request.id);
    answer({ id: beforeAnswer[0], ok: true, signature: "MEQC" });
    await settle();
    const afterAnswer = requests().map((request) => request.id);
    answer({ id: afterAnswer[2], ok: true, signature: "MEUC" });
    answer({ id: beforeAnswer[1], ok: true, signature: "MEYC" });

    expect(beforeAnswer).toStrictEqual(["r1", "r2"]);
    expect(afterAnswer).toStrictEqual(["r1", "r2", "r3"]);
    await expect(Promise.all([first, second, other])).resolves.toStrictEqual([
      { ok: true, value: "MEQC" },
      { ok: true, value: "MEUC" },
      { ok: true, value: "MEYC" },
    ]);
  });

  it("rejects every waiting call once the signer stops, and every later call", async () => {
    const { client, answers } = await scripted();
    const waiting = client.publicKey(live());
    await settle();
    answers.end();

    await expect(waiting).rejects.toMatchObject({ code: "signer.stopped" });
    await expect(client.authorize(authorizeFixture(), live())).rejects.toMatchObject({
      code: "signer.stopped",
    });
  });

  it("rejects with the fault the signer stopped on", async () => {
    const { client, answer } = await scripted();
    const waiting = client.publicKey(live());
    await settle();
    answer({ fault: "signer.agent_key_invalid" });

    await expect(waiting).rejects.toMatchObject({
      code: "signer.stopped",
      details: { fault: "signer.agent_key_invalid" },
    });
  });

  it("stops at a line it cannot read and logs it without its text", async () => {
    const { client, answers, logger } = await scripted();
    const waiting = client.publicKey(live());
    await settle();
    answers.write("not an answer\n");

    await expect(waiting).rejects.toMatchObject({ code: "signer.stopped" });
    expect(logger.records()).toStrictEqual([
      {
        level: "error",
        subsystem: "engine",
        event: "signer.bad_line",
        fields: { errorCode: "signer.bad_answer" },
      },
    ]);
  });

  it("stops at an answer line over the limit and logs its code", async () => {
    const { client, answers, logger } = await scripted();
    const waiting = client.publicKey(live());
    await settle();
    answers.write(`${"x".repeat(maxLineBytes + 1)}\n`);

    await expect(waiting).rejects.toMatchObject({ code: "signer.stopped" });
    expect(logger.records()).toStrictEqual([
      {
        level: "error",
        subsystem: "engine",
        event: "signer.bad_line",
        fields: { errorCode: "signer.line_too_long" },
      },
    ]);
  });

  it("stops when the signer's output breaks", async () => {
    const { client, answers, logger } = await scripted();
    const waiting = client.publicKey(live());
    await settle();
    answers.destroy(new Error("the pipe broke"));

    await expect(waiting).rejects.toMatchObject({ code: "signer.stopped" });
    expect(logger.records().map((record) => record.fields)).toStrictEqual([
      { errorCode: "signer.stopped" },
    ]);
  });

  it("rejects an aborted call with the signal's reason and drops its late answer", async () => {
    const { client, answer, requests } = await scripted();
    const controller = new AbortController();
    const waiting = client.publicKey({ signal: controller.signal });
    await settle();
    controller.abort(new Error("deadline"));

    await expect(waiting).rejects.toThrow("deadline");
    answer({ id: requests()[0]?.id, ok: true, publicKey: "AAAA" });
    await expect(
      client.publicKey({ signal: AbortSignal.abort(new Error("gone")) }),
    ).rejects.toThrow("gone");
  });

  it("sends nothing for a call whose signal aborted before its turn", async () => {
    const { client, requests } = await scripted();
    const aborted = { signal: AbortSignal.abort(new Error("gone")) };

    await expect(client.authorize(authorizeFixture(), aborted)).rejects.toThrow("gone");
    await expect(client.publicKey(aborted)).rejects.toThrow("gone");
    await settle();
    expect(requests()).toStrictEqual([]);
  });

  it("rejects a call aborted with a reason that is no error with an AbortError", async () => {
    const { client } = await scripted();
    const controller = new AbortController();
    const waiting = client.publicKey({ signal: controller.signal });
    controller.abort("deadline");

    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  });

  it("drops an answer that names no request and keeps waiting", async () => {
    const { client, answer, requests } = await scripted();
    const waiting = client.publicKey(live());
    await settle();
    answer({ id: null, ok: false, refused: "unknown_request" });
    answer({ id: requests()[0]?.id, ok: true, publicKey: "AAAA" });

    await expect(waiting).resolves.toBe("AAAA");
  });

  it("refuses a call while the most calls already wait, and takes one again once they end", async () => {
    const { client, answers } = await scripted();
    const controller = new AbortController();
    const waiting = Array.from({ length: maxWaitingCalls }, async () =>
      client.publicKey({ signal: controller.signal }),
    );
    await settle();

    await expect(client.publicKey(live())).rejects.toMatchObject({ code: "signer.busy" });
    controller.abort(new Error("done"));
    await expect(Promise.allSettled(waiting)).resolves.toHaveLength(maxWaitingCalls);
    const next = client.publicKey(live());
    await settle();
    answers.end();
    await expect(next).rejects.toMatchObject({ code: "signer.stopped" });
  });

  it("refuses an authorize once the most calls wait behind one wallet", async () => {
    const { client } = await scripted();
    const controller = new AbortController();
    const queued = Array.from({ length: maxWaitingCalls }, async () =>
      client.authorize(authorizeFixture(), { signal: controller.signal }),
    );
    await settle();

    await expect(client.authorize(authorizeFixture(), live())).rejects.toMatchObject({
      code: "signer.busy",
    });
    controller.abort(new Error("done"));
    await expect(Promise.allSettled(queued)).resolves.toHaveLength(maxWaitingCalls);
  });

  it("refuses an answer of the wrong kind", async () => {
    const { client, answer, requests } = await scripted();
    const keyCall = client.publicKey(live());
    const signCall = client.authorize(authorizeFixture(), live());
    await settle();
    const [keyRequest, signRequest] = requests();
    answer({ id: keyRequest?.id, ok: true, signature: "MEQC" });
    answer({ id: signRequest?.id, ok: true, publicKey: "AAAA" });

    await expect(keyCall).rejects.toMatchObject({ code: "signer.bad_answer" });
    await expect(signCall).rejects.toMatchObject({ code: "signer.bad_answer" });
  });

  it("treats a write that fails as a stopped signer", async () => {
    const { client, breakWrites } = await scripted();
    breakWrites();

    await expect(client.publicKey(live())).rejects.toMatchObject({ code: "signer.stopped" });
  });
});
