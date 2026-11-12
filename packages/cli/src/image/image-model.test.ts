import type { HttpRequest } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testModelId, testModelKey } from "../e2e/model-fixtures.js";
import { answerImageModel } from "./image-model.js";

const url = "https://api.openai.com/v1/chat/completions";
const signal = new AbortController().signal;

function turn(messages: readonly object[]): HttpRequest {
  const body = JSON.stringify({ model: testModelId, stream: true, messages });
  return { method: "POST", url, body, signal };
}

// The chunks of a streamed answer, as the server-sent events hold them.
function chunksOf(body: string | undefined): readonly unknown[] {
  return (body ?? "")
    .split("\n\n")
    .map((event) => event.replace(/^data: /u, ""))
    .filter((data) => data.startsWith("{"))
    .map((data): unknown => JSON.parse(data));
}

describe("the image smoke test's scripted model", () => {
  it("makes the tool call an owner's TOOL line names", async () => {
    const asked = 'TOOL shell {"command":"echo probe-$((1+1))","folder":"/w"}';
    const answer = await answerImageModel(turn([{ role: "user", content: asked }]));

    expect(answer.headers["content-type"]).toBe("text/event-stream");
    expect(chunksOf(answer.body)).toContainEqual(
      expect.objectContaining({
        choices: [
          expect.objectContaining({
            delta: {
              tool_calls: [
                expect.objectContaining({
                  function: {
                    name: "shell",
                    arguments: JSON.stringify({ command: "echo probe-$((1+1))", folder: "/w" }),
                  },
                }),
              ],
            },
          }),
        ],
      }),
    );
  });

  it("ends the turn once a tool answered, and says back any other message", async () => {
    const done = await answerImageModel(turn([{ role: "tool", content: "ok" }]));
    const woken = await answerImageModel(
      turn([{ role: "user", content: [{ type: "text", text: "The command ended: done-7" }] }]),
    );

    expect(done.body).toContain('"content":"Done."');
    expect(woken.body).toContain("Heard: The command ended: done-7");
  });

  it("reads past the instructions and the live facts the runtime adds", async () => {
    const answer = await answerImageModel(
      turn([
        { role: "system", content: "You are the agent." },
        { role: "user", content: 'TOOL file_read {"path":"a.txt"}' },
        { role: "user", content: "Live facts from binference, read for this call." },
      ]),
    );

    expect(answer.body).toContain('"name":"file_read"');
  });

  it("answers init's check, which does not stream, as the fake provider does", async () => {
    const body = JSON.stringify({
      model: testModelId,
      messages: [{ role: "user", content: "Hi" }],
    });
    const headers = { authorization: `Bearer ${testModelKey}` };

    const answer = await answerImageModel({ method: "POST", url, headers, body, signal });

    expect(answer.status).toBe(200);
  });
});
