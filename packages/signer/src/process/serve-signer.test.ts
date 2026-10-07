import { describe, expect, it } from "vitest";
import { formatAgentKey } from "../agent-key/agent-key-text.js";
import { createP256KeyPair } from "../keys/p256-key-pair.js";
import { readSignerLine } from "../requests/signer-message.schema.js";
import { fixtureNowMs, fixtureSettings } from "../testing/sign-fixtures.js";
import { maxLineBytes } from "./read-lines.js";
import { serveSigner } from "./serve-signer.js";

const agentKey = createP256KeyPair();
const keyText = formatAgentKey(agentKey).reveal();
const settingsLine = JSON.stringify(fixtureSettings);
const publicKey = (id: string): string => JSON.stringify({ id, kind: "publicKey" });

async function* chunksOf(chunks: readonly Buffer[]): AsyncGenerator<Buffer> {
  yield* chunks;
}

async function serve(chunks: readonly Buffer[]) {
  const written: string[] = [];
  const fault = await serveSigner({
    input: chunksOf(chunks),
    write: async (line) => {
      written.push(line);
    },
    now: () => fixtureNowMs,
  });
  return { fault, written };
}

// Holds each write until the test releases it; `next` hands over the release of the next write.
function createWriteGate() {
  const releases: (() => void)[] = [];
  const takers: ((release: () => void) => void)[] = [];
  const meet = (release: () => void): void => {
    const taker = takers.shift();
    if (taker === undefined) {
      releases.push(release);
    } else {
      taker(release);
    }
  };
  return {
    hold: async (): Promise<void> =>
      new Promise((release) => {
        meet(() => {
          release();
        });
      }),
    next: async (): Promise<() => void> =>
      new Promise((resolve) => {
        const release = releases.shift();
        if (release === undefined) {
          takers.push(resolve);
        } else {
          resolve(release);
        }
      }),
  };
}

async function* broken(): AsyncGenerator<Buffer> {
  yield Buffer.from(`${settingsLine}\n`);
  throw new Error("the input pipe broke");
}

const lines = (...texts: readonly string[]): Buffer[] =>
  texts.map((text) => Buffer.from(`${text}\n`));

describe("serving the signer's channel", () => {
  it("reads the settings, then the key, then answers each request in order", async () => {
    const { fault, written } = await serve(
      lines(settingsLine, keyText, publicKey("a"), "junk", publicKey("b")),
    );

    expect(fault).toBeUndefined();
    expect(written.map(readSignerLine)).toStrictEqual([
      { id: "a", ok: true, publicKey: agentKey.publicKey },
      { id: null, ok: false, refused: "unknown_request" },
      { id: "b", ok: true, publicKey: agentKey.publicKey },
    ]);
  });

  it("zeroes the chunk that brought the key", async () => {
    const chunks = lines(settingsLine, keyText);
    await serve(chunks);

    expect(chunks[1]?.every((byte) => byte === 0)).toBe(true);
  });

  it("stops on settings it cannot read before it reads the key", async () => {
    const chunks = lines('{"chains":[]}', keyText, publicKey("a"));
    const { fault, written } = await serve(chunks);

    expect(fault).toBe("signer.settings_invalid");
    expect(written).toStrictEqual(['{"fault":"signer.settings_invalid"}']);
    expect(chunks[1]?.toString("utf8")).toBe(`${keyText}\n`);
  });

  it("stops on a key it cannot read and never writes the key's text", async () => {
    const bad = `${keyText.slice(0, 40)}!`;
    const { fault, written } = await serve(lines(settingsLine, bad, publicKey("a")));

    expect(fault).toBe("signer.agent_key_invalid");
    expect(written).toStrictEqual(['{"fault":"signer.agent_key_invalid"}']);
  });

  it("ends quietly when the engine closes its input before the key", async () => {
    await expect(serve(lines(settingsLine))).resolves.toStrictEqual({
      fault: undefined,
      written: [],
    });
    await expect(serve([])).resolves.toStrictEqual({ fault: undefined, written: [] });
  });

  it("stops on a line over the limit", async () => {
    const { fault, written } = await serve(
      lines(settingsLine, keyText, "z".repeat(maxLineBytes + 1)),
    );

    expect(fault).toBe("signer.line_too_long");
    expect(written).toStrictEqual(['{"fault":"signer.line_too_long"}']);
  });

  it("passes on a failure of its input", async () => {
    await expect(
      serveSigner({ input: broken(), write: async () => undefined, now: () => fixtureNowMs }),
    ).rejects.toThrow("the input pipe broke");
  });

  it("reads the next request only after it wrote the last answer", async () => {
    const pulled: string[] = [];
    async function* input(): AsyncGenerator<Buffer> {
      for (const [index, chunk] of lines(
        settingsLine,
        keyText,
        publicKey("a"),
        publicKey("b"),
      ).entries()) {
        pulled.push(`chunk ${String(index)}`);
        yield chunk;
      }
    }
    const gate = createWriteGate();
    const serving = serveSigner({
      input: input(),
      write: async () => {
        pulled.push("answer");
        await gate.hold();
      },
      now: () => fixtureNowMs,
    });

    const releaseFirst = await gate.next();
    const beforeRelease = [...pulled];
    releaseFirst();
    (await gate.next())();
    await serving;

    expect(beforeRelease).toStrictEqual(["chunk 0", "chunk 1", "chunk 2", "answer"]);
    expect(pulled).toStrictEqual(["chunk 0", "chunk 1", "chunk 2", "answer", "chunk 3", "answer"]);
  });
});
