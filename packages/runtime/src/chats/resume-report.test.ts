import { protocolIdSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { startChatRig } from "../testing/chat-rig.js";
import { textReply } from "../testing/scripted-transport.js";

const offFrom = Date.parse("2027-01-15T06:00:00Z");
const order = (n: number) =>
  protocolIdSchema("autoOrder").parse(`ord_0190f1c2-3a4b-7c5d-8e6f-00000000000${String(n)}`);
const report = {
  cause: "start",
  offFrom,
  offMs: 2 * 3_600_000,
  checked: 2,
  filled: 1,
  skipped: 1,
  orders: [
    { order: order(1), kind: "takeProfit", outcome: "filled" },
    {
      order: order(2),
      kind: "stopLoss",
      outcome: "skipped",
      reason: "trigger_not_met",
    },
  ],
} as const;

describe("a resume report in the agent's chat", () => {
  it("starts no turn, and joins the next one as a line before the owner's message", async () => {
    const rig = await startChatRig({ replies: [textReply("Back.")] });
    const resumed = rig.engine.resumed(rig.agent, report);
    await rig.received();
    await rig.runner.rested();
    const started = rig.engine.pushes.filter(({ kind }) => kind === "chat/turnStarted");

    const posted = await rig.post("what happened?");
    await rig.runner.rested();

    expect(started).toStrictEqual([]);
    expect(posted.session).toBe(resumed.session);
    const [request] = rig.transport.requests;
    expect(request?.messages).toStrictEqual([
      {
        role: "owner",
        text:
          "The engine was off for 120 min from 2027-01-15T06:00:00.000Z, then re-checked your " +
          "auto orders: 2 of your orders checked, 1 filled, 1 skipped. " +
          "ord_0190f1c2-3a4b-7c5d-8e6f-000000000001 (takeProfit) filled; " +
          "ord_0190f1c2-3a4b-7c5d-8e6f-000000000002 (stopLoss) skipped: trigger_not_met.",
      },
      { role: "owner", text: "what happened?" },
    ]);
    expect(rig.engine.untaken()).toStrictEqual([]);
  });

  it("keeps one report waiting, the newest, so 25 of them never hold back the owner's message", async () => {
    const rig = await startChatRig({ replies: [textReply("Back.")] });
    for (const minutes of Array.from({ length: 25 }, (_, index) => index + 1)) {
      rig.engine.resumed(rig.agent, { ...report, offMs: minutes * 60_000 });
      // oxlint-disable-next-line eslint/no-await-in-loop -- each report lands before the next
      await rig.received();
    }
    await rig.post("still there?");
    await rig.runner.rested();

    const [request] = rig.transport.requests;
    expect(request?.messages).toHaveLength(2);
    expect(request?.messages[0]?.text).toContain("off for 25 min");
    expect(request?.messages[1]).toStrictEqual({ role: "owner", text: "still there?" });
  });
});
