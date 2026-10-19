import { describe, expect, it } from "vitest";
import { startChat } from "./testing/chat-harness.js";
import { printedNoticeTable, writtenNoticeTable } from "./testing/printed-notice-table.js";

const warning = String.fromCodePoint(0x26a0, 0xfe0f);
const red = String.fromCodePoint(0x1f534);

describe("terminal chat's notices in Chinese", () => {
  it("prints every notice of spec 4 in Chinese, in the words every surface writes (Y12)", async () => {
    const expected = writtenNoticeTable("zh");
    const printed = await printedNoticeTable("zh");
    expect(printed).toStrictEqual(expected);
    expect(printed["notice.lowGas"]).toStrictEqual([
      `${warning} Main 仅剩 0.001 FAKE 可付网络费。请充值 BNB。`,
    ]);
    expect(printed["notice.locked"]).toStrictEqual([
      `${red} binference 已重启并处于锁定状态。请运行 \`binference unlock\`。`,
    ]);
  });

  it("speaks the owner's language in its own lines", async () => {
    const chat = startChat({}, "zh");
    await chat.settle();
    chat.press("\u0003");
    await chat.ended;
    expect(chat.rows()).toStrictEqual([
      "与 main 对话。Enter 发送，Esc 停止 Agent 的回答，/clear 开始新对话，/help 查看按键，Ctrl+C 退出。",
      "终端中无法发送图片。请在 Telegram 或控制台中发送。",
      "对话已关闭。",
      "",
    ]);
  });
});
