import { describe, expect, it } from "vitest";
import { chatHtmlOf } from "./chat-html.js";

describe("the agent's Chinese Markdown as Telegram HTML", () => {
  it("draws Chinese text with its styles, lists and headings", () => {
    const text =
      "## 当前状态\n**模拟交易**模式下，*不会*动用真实资金。\n- 买入 `0.1 BNB`\n1. 设置止损";
    expect(chatHtmlOf(text)).toStrictEqual([
      {
        html: "<b>当前状态</b>\n<b>模拟交易</b>模式下，<i>不会</i>动用真实资金。\n• 买入 <code>0.1 BNB</code>\n1. 设置止损",
        plain: "当前状态\n模拟交易模式下，不会动用真实资金。\n• 买入 0.1 BNB\n1. 设置止损",
      },
    ]);
  });

  it("keeps an underscore between Chinese characters as text", () => {
    expect(chatHtmlOf("代币_名称_很长")).toStrictEqual([
      { html: "代币_名称_很长", plain: "代币_名称_很长" },
    ]);
  });
});
