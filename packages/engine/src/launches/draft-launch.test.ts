import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { expectOk, testAgent } from "../intents/test-intents.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import { launchDraftOpenMs } from "./launch-draft-shelf.js";
import {
  chatPushes,
  draftArgs,
  draftArgsWithoutPhoto,
  draftOf,
  draftSession,
  draftTerms,
  draftText,
  photoMessage,
  photoName,
  photoPng,
  storeOwnerMessage,
  testDraftEngine,
} from "./test-launch-drafts.js";

const refused = (error: string) => ({ ok: false, error });

describe("launch/draft", () => {
  it("keeps the agent's draft with the owner's photo, and uploads, quotes and stores nothing", async () => {
    const { test, launcher } = await testDraftEngine();
    const drafted = expectOk(await draftOf(test));
    expect(drafted.expiresAt).toBe(test.clock.now() + launchDraftOpenMs);
    expect(chatPushes(test, "chat/launchDraft")).toStrictEqual([
      { agent: testAgent, draft: drafted.draft, expiresAt: drafted.expiresAt },
    ]);
    expect(draftText(test, drafted.draft, "en")).toStrictEqual([
      "Launch MCAT (Moon Cat) on fake-curve, paired with FAKE · first buy 0.000000000001 FAKE",
      "Description: A cat on the moon",
      "Website: https://moon.example",
      "Picture: your photo from the chat, PNG, 1 KB, SHA-256 a96735a8ad139cd1",
      "Tax on every trade: 3.00%",
      "Buyback and burn: off",
    ]);
    const listed = expectOk(
      await test.engine.handlers["intent/list"](testCall({ agent: testAgent }, testCallers.cli)),
    );
    expect([listed.items, launcher.uploads()]).toStrictEqual([[], []]);
  });

  it("shows the draft's words as outside text, in Chinese too", async () => {
    const { test } = await testDraftEngine();
    const launch = { ...draftTerms, name: "Moon‮Cat" };
    const drafted = expectOk(await draftOf(test, draftArgs({ launch })));
    const [action] = draftText(test, drafted.draft, "zh");
    expect(action).not.toContain("‮");
    expect(action).toMatch(/fake-curve/u);
  });

  it("warns of outside content when the drafting turn read any", async () => {
    const { test } = await testDraftEngine();
    const { turn } = draftArgs();
    const mark = { agent: testAgent, turn };
    expectOk(await test.engine.handlers["turn/mark"](testCall(mark, testCallers.runtime)));
    const drafted = expectOk(await draftOf(test));
    expect(draftText(test, drafted.draft, "en").at(-1)).toBe(
      "⚠️ This came after reading outside content (web, X, token data or an image)",
    );
  });

  it("refuses any caller but the runtime the engine runs now, and a turn that is not running", async () => {
    const { test } = await testDraftEngine();
    const stranger = {
      ...testCallers.runtime,
      credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000099",
    };
    const answers = await Promise.all([
      draftOf(test, draftArgs(), testCallers.mcp),
      draftOf(test, draftArgs(), testCallers.cli),
      draftOf(test, draftArgs(), stranger),
      draftOf(
        test,
        draftArgs({ turn: idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000099") }),
      ),
    ]);
    expect(answers).toStrictEqual([
      refused("auth.scope"),
      refused("auth.scope"),
      refused("auth.scope"),
      refused("protocol.bad_args"),
    ]);
    expect(chatPushes(test, "chat/launchDraft")).toStrictEqual([]);
  });

  it("refuses a photo that is not in one of the owner's own Telegram messages", async () => {
    const other = await testDraftEngine({}, { isStored: false });
    await storeOwnerMessage(other.test, { images: [photoName], surface: "console" });
    const named = await testDraftEngine();
    const missing = { message: photoMessage, image: "tg:SomeoneElsesPhoto" };
    expect(
      await Promise.all([
        draftOf(other.test),
        draftOf(named.test, draftArgs({ photo: missing })),
        draftOf(named.test, draftArgsWithoutPhoto()),
      ]),
    ).toStrictEqual([
      refused("image.not_found"),
      refused("image.not_found"),
      refused("protocol.bad_args"),
    ]);
  });

  it("refuses a photo the owner sent with an earlier turn, not this one", async () => {
    const { test } = await testDraftEngine();
    const next = {
      agent: testAgent,
      session: draftSession,
      turn: idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000286"),
      messages: [],
      outsideContent: false,
    };
    expectOk(await test.engine.handlers["turn/start"](testCall(next, testCallers.runtime)));
    expect(await draftOf(test, draftArgs({ turn: next.turn }))).toStrictEqual(
      refused("image.not_found"),
    );
  });

  it("checks a draft as a proposal: a paper agent, no launch wallet, a launch under way", async () => {
    const paper = await testDraftEngine({ options: { agent: { mode: "paper" } } });
    const walletless = await testDraftEngine({ hasLaunchWallet: false });
    expect(await draftOf(paper.test)).toStrictEqual(refused("agent.paper_only"));
    expect(await draftOf(walletless.test)).toStrictEqual(refused("intent.launch_wallet_missing"));
    const busy = await testDraftEngine({ pin: { never: true } });
    const plan = { contentType: "image/png", bytes: photoPng.byteLength } as const;
    const { ticket } = busy.uploads.ticket(plan, testCallers.cli.credential);
    const upload = expectOk(busy.uploads.receive(ticket, photoPng));
    const launch = { ...draftTerms, kind: "launchToken", agent: testAgent, image: upload } as const;
    const proposed = await busy.test.engine.handlers["intent/propose"](
      testCall(launch, testCallers.cli),
    );
    expect(proposed.ok).toBe(true);
    expect(await draftOf(busy.test)).toStrictEqual(refused("intent.launch_waiting"));
  });

  it("takes no photo on a launchpad that takes a picture link, and needs the link", async () => {
    const { test } = await testDraftEngine({ takesPictureLink: true });
    const linked = {
      ...draftTerms,
      venueOptions: { taxBps: 300, pictureLink: "https://cat.example/cat.png" },
    };
    const drafted = expectOk(await draftOf(test, draftArgsWithoutPhoto({ launch: linked })));
    expect(draftText(test, drafted.draft, "en")).toContain(
      "Picture at https://cat.example/cat.png (binference never opens it)",
    );
    expect(await draftOf(test, draftArgs({ launch: linked }))).toStrictEqual(
      refused("protocol.bad_args"),
    );
  });

  it("holds a picture the create call writes to its launchpad's room, and shows its size", async () => {
    const roomy = await testDraftEngine({ writesPicture: { mostBytes: 900 } });
    const tight = await testDraftEngine({ writesPicture: { mostBytes: 20 } });
    const drafted = expectOk(await draftOf(roomy.test));
    expect(draftText(roomy.test, drafted.draft, "en")).toContain(
      "Picture written on chain with the token: PNG, 29 bytes, 64 x 48 pixels, SHA-256 a96735a8ad139cd1",
    );
    expect(await draftOf(tight.test)).toStrictEqual(refused("intent.launch_picture_too_large"));
  });

  it("replaces the agent's open draft with a newer one, and says so", async () => {
    const { test } = await testDraftEngine();
    const first = expectOk(await draftOf(test));
    const second = expectOk(await draftOf(test));
    expect(chatPushes(test, "chat/launchDraftClosed")).toStrictEqual([
      { agent: testAgent, draft: first.draft, outcome: "replaced" },
    ]);
    expect([
      test.engine.launchDrafts.showing(first.draft),
      second.draft === first.draft,
    ]).toStrictEqual([undefined, false]);
  });
});
