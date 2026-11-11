import { describe, expect, it } from "vitest";
import {
  closedPush,
  createTestShellRequests,
  requestPush,
  testShellRequest,
} from "./test-shell-requests.js";

const live = { signal: new AbortController().signal };
const { request } = testShellRequest;
const refused = String.fromCodePoint(0x274c);

describe("the agent's shell requests in Telegram, in Chinese", () => {
  it("shows the request and its buttons in Chinese", async () => {
    const shell = await createTestShellRequests("zh");
    await shell.requests.show(requestPush(), live);
    expect(shell.botApi.messages()).toMatchObject([
      {
        text: "main 请求运行一条命令\ngit log -1 | head -n 3\n目录：/srv/project\n没有允许的命令涵盖它。\n请在 12:10:00 前回答。",
        buttons: [
          [
            { text: "允许一次", data: `bnf1:x:o:${request}` },
            { text: "始终允许", data: `bnf1:x:a:${request}` },
          ],
          [{ text: "拒绝", data: `bnf1:x:n:${request}` }],
        ],
      },
    ]);
  });

  it("says in Chinese how the request ended, and that a later press is closed", async () => {
    const shell = await createTestShellRequests("zh");
    await shell.requests.show(requestPush(), live);
    await shell.requests.show(closedPush("refused"), live);
    expect(shell.botApi.messages()[0]?.text.split("\n").at(-1)).toBe(
      `${refused} 已拒绝，没有运行任何命令。`,
    );
    await shell.press(`bnf1:x:o:${request}`);
    await shell.press(`bnf1:x:o:${request}`);
    expect(shell.botApi.answers().at(-1)?.text).toBe("此请求已不再开放。");
  });
});
