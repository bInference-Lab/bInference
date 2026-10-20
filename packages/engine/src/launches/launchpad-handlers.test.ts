import { chainRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { expectOk } from "../intents/test-intents.js";
import { testLaunchEngine } from "../money-path/test-launches.js";
import { startTestEngine, testCall } from "../operations/test-engine.js";

const chain = chainRefSchema.parse("fake:1");
const declared = [
  { name: "taxBps", type: "bps", max: 1_000, default: 0 },
  { name: "buyback", type: "flag", default: false },
];

async function listed(launching: Parameters<typeof testLaunchEngine>[0]) {
  const { test } = await testLaunchEngine(launching);
  return expectOk(await test.engine.handlers["launchpad/list"](testCall({ chain })));
}

describe("launchpad/list", () => {
  it("answers a launchpad that uploads the owner's picture, with each setting it declares", async () => {
    expect(await listed({})).toStrictEqual({
      items: [
        {
          venue: "fake-curve",
          picture: { place: "upload", mostBytes: 5_242_880 },
          settings: declared,
        },
      ],
    });
  });

  it("answers a launchpad that takes a picture link the owner must give", async () => {
    const { items } = await listed({ takesPictureLink: true });
    expect(
      items.map(({ picture, settings }) => ({ picture, last: settings.at(-1) })),
    ).toStrictEqual([{ picture: { place: "link" }, last: { name: "pictureLink", type: "link" } }]);
  });

  it("answers how large a picture written into the create call may be beside no words", async () => {
    const { items } = await listed({ writesPicture: { mostBytes: 900 } });
    expect(items.map(({ picture }) => picture)).toStrictEqual([
      { place: "create_call", mostBytes: 900, mostSide: 1_024 },
    ]);
  });

  it("marks the settings a launch may leave out and the ones only the launchpad works out", async () => {
    const quoted = await listed({ worksOutRecipient: { at: "quote", value: "fake:1:0x000000e1" } });
    const built = await listed({ worksOutRecipient: { at: "build", value: "fake:1:0x000000e1" } });
    expect([quoted, built].map(({ items }) => items[0]?.settings.at(-1))).toStrictEqual([
      { name: "creatorFeeRecipient", type: "account", optional: true, outsideOnly: true },
      { name: "creatorFeeRecipient", type: "account", workedOut: true, outsideOnly: true },
    ]);
  });

  it("answers no launchpad for an engine whose venues launch no token", async () => {
    const plain = await startTestEngine();
    const answer = await plain.engine.handlers["launchpad/list"](testCall({ chain }));
    expect(expectOk(answer).items).toStrictEqual([]);
  });

  it("refuses a chain the registry does not hold", async () => {
    const { test } = await testLaunchEngine();
    const unknown = chainRefSchema.parse("fake:9");
    expect(
      await test.engine.handlers["launchpad/list"](testCall({ chain: unknown })),
    ).toStrictEqual({ ok: false, error: "protocol.bad_args" });
  });
});
