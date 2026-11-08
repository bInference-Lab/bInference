import { describe, expect, it } from "vitest";
import { readAsOwner } from "./read-parts.js";

const live = { signal: new AbortController().signal };
const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const owner = async () => Promise.resolve(42);
const unpaired = async () => Promise.resolve(undefined);
const first = { data: Buffer.from("abc").toString("base64"), next: 3 };
const last = { data: Buffer.from("de").toString("base64") };
const lastPart = async () => Promise.resolve(last);
const refused = async () => Promise.resolve(undefined);
const endless = async () => Promise.resolve(first);
const bytes = (text: string) => new Uint8Array(Buffer.from(text));

describe("reading a file the chat showed as the owner on Telegram", () => {
  it("joins the parts in order as the owner, leaving out an offset of 0", async () => {
    const asked: unknown[] = [];
    const answers = [first, last];
    const read = await readAsOwner(
      { ownerId: owner, agent, maxBytes: 100 },
      async (asker, offset) => {
        asked.push({ ...asker, ...offset });
        return Promise.resolve(answers.shift());
      },
      live,
    );
    expect(read).toStrictEqual(bytes("abcde"));
    expect(asked).toStrictEqual([
      { senderId: 42, agent },
      { senderId: 42, agent, offset: 3 },
    ]);
  });

  it("reads nothing before the owner pairs, for an id that is no agent's, or past a refused part", async () => {
    const ask = { agent, maxBytes: 100 };
    expect(await readAsOwner({ ...ask, ownerId: unpaired }, lastPart, live)).toBeUndefined();
    expect(
      await readAsOwner({ ...ask, ownerId: owner, agent: "agt_nope" }, lastPart, live),
    ).toBeUndefined();
    expect(await readAsOwner({ ...ask, ownerId: owner }, refused, live)).toBeUndefined();
  });

  it("stops at the most bytes it reads", async () => {
    const read = await readAsOwner({ ownerId: owner, agent, maxBytes: 3 }, endless, live);
    expect(read).toStrictEqual(bytes("abc"));
  });
});
