import { afterEach, describe, expect, it } from "vitest";
import {
  type FirstChat,
  type Interview,
  interviewReplies,
  runInterview,
  startFirstChat,
} from "./first-chat-machine.js";

const slow = { timeout: 30_000 };
const machines: FirstChat[] = [];

afterEach(async () => {
  await Promise.all(machines.splice(0).map(async (machine) => machine.stop()));
});

const chinese: Interview = {
  locale: "zh",
  answers: [
    "一共 0.5 BNB，单笔最多 0.05 BNB",
    "几小时，有时一天",
    "Flap 上的新发射代币和 AI 代币",
    "有真实交易量、团队在持续交付",
    "涨 50% 止盈，跌 20% 止损",
    "绝不碰税率高于 5% 的代币",
    "每次买入前先问我",
    "每天一次，最多两行",
  ],
  strategy:
    "# 策略\n\n- 预算：0.5 BNB，单笔最多 0.05 BNB。\n- 持有时间：几小时，有时一天。\n- 平仓：涨 50% 止盈，跌 20% 止损。\n",
  persona: "# 人设\n\n- 每天汇报一次，最多两行。\n",
};

describe("the first chat in Chinese", () => {
  it(
    "asks from the Chinese script, saves the strategy and the persona, and ends",
    slow,
    async () => {
      const script = interviewReplies(chinese);
      const machine = await startFirstChat("zh", script);
      machines.push(machine);
      const { prefix, ...left } = await runInterview(machine, chinese, script);
      expect(prefix).toContain(
        '<workspace-file name="FIRST-CHAT.md">\n# 初次对话\n\n了解所有者的交易方式。',
      );
      expect(left).toStrictEqual({
        strategy: chinese.strategy,
        persona: chinese.persona,
        firstChat: undefined,
        statusKeys: ["turn.firstChatDone"],
      });
    },
  );
});
