import { createIdSource, err, idSchema } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createMemoryAgentInboxStore } from "../fakes/memory-agent-inbox-store.js";
import { createMemoryAgentStore } from "../fakes/memory-agent-store.js";
import { createMemoryViewImages } from "../fakes/memory-view-images.js";
import { expectOk, testAgent, testAgentDraft } from "../intents/test-intents.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { createInboxHold } from "./inbox-hold.js";
import { createMadeImageHandlers } from "./made-images.js";
import { createRunningTurns } from "./running-turns.js";
import { testPng } from "./test-images.js";

const turn = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const runtime = testCallers.runtime;
const logo = "/workspace/media/made/2026-11-07/0d9cad7b82bf8f12.png";
const frog = "/pictures/pictures/frog.png";
const notes = "/pictures/notes.txt";

async function setUp(given: { readonly withSource?: boolean } = {}) {
  const clock = createManualClock(Date.UTC(2026, 10, 7, 12));
  const agents = createMemoryAgentStore();
  await agents.create(testAgentDraft({}), testCall({}));
  const turns = createRunningTurns();
  turns.startRuntime(idSchema("tok").parse(runtime.credential));
  const pushes: EnginePush[] = [];
  const files = new Map([
    [logo, testPng],
    [frog, testPng],
    [notes, new TextEncoder().encode("not an image")],
  ]);
  const handlers = createMadeImageHandlers({
    agentInbox: createMemoryAgentInboxStore({ agents }),
    inboxHold: createInboxHold(),
    turns,
    ids: createIdSource({ clock, random: createSeededRandom(1) }),
    clock,
    random: createSeededRandom(2),
    publish: (push) => pushes.push(push),
    intentView: async () => Promise.resolve(undefined),
    ...(given.withSource === false ? {} : { viewImages: createMemoryViewImages(files, "/state") }),
  });
  const show = async (paths: readonly string[], caller = runtime) =>
    handlers["image/show"](
      testCall({ agent: testAgent, turn, paths, caption: "Today's images." }, caller),
    );
  return { handlers, pushes, show, files };
}

describe("the images the agent shows from the machine", () => {
  it("pushes images already on the machine to the chat, and a surface reads each by its id", async () => {
    const test = await setUp();
    const shown = expectOk(await test.show([logo, frog]));
    expect(shown.images.map(({ path }) => path)).toStrictEqual([logo, frog]);
    expect(test.pushes).toMatchObject([
      {
        topic: `chat:${testAgent}`,
        kind: "chat/images",
        data: {
          agent: testAgent,
          turn,
          prompt: "Today's images.",
          images: [
            { contentType: "image/png", bytes: testPng.byteLength, path: logo },
            { contentType: "image/png", bytes: testPng.byteLength, path: frog },
          ],
        },
      },
    ]);
    const [first] = shown.images;
    const read = await test.handlers["image/read"](
      testCall({ agent: testAgent, image: String(first?.image) }),
    );
    expect(expectOk(read)).toMatchObject({ contentType: "image/png", offset: 0 });
  });

  it("refuses them all when one cannot be shown, and shows nothing", async () => {
    const test = await setUp();
    const walled = "/state/agent.sqlite";
    expect([
      await test.show([logo, walled]),
      await test.show([frog, "/pictures/gone.png"]),
      await test.show([notes]),
    ]).toStrictEqual([err("image.walled"), err("image.not_found"), err("image.format")]);
    expect(test.pushes).toStrictEqual([]);
  });

  it("answers only the runtime the engine runs now, and refuses with no source to read from", async () => {
    const test = await setUp();
    const without = await setUp({ withSource: false });
    expect([await test.show([logo], testCallers.cli), await without.show([logo])]).toStrictEqual([
      err("auth.scope"),
      err("image.unreadable"),
    ]);
  });

  it("refuses to read a shown image once its file is gone", async () => {
    const test = await setUp();
    const [shown] = expectOk(await test.show([frog])).images;
    test.files.delete(frog);
    const read = await test.handlers["image/read"](
      testCall({ agent: testAgent, image: String(shown?.image) }),
    );
    expect(read).toStrictEqual(err("image.not_found"));
  });
});
