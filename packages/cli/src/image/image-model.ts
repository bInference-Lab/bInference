import { type HttpRequest, type HttpResponse, jsonValueSchema } from "@binference/core";
import { z } from "zod";
import { createFakeModelProvider } from "../e2e/model-fixtures.js";
import { textStream, toolCallStream } from "../packed/smoke-model.js";

// The image smoke test's model provider, as `image-model-server.ts` serves it on the engine
// container's loopback: check's calls, which do not stream, get the e2e fake provider's answer.
// The agent's turns stream, and the last message but the instructions says what the model does:
// an owner's message with a line `TOOL <name> <arguments as JSON>` makes that tool call, a tool's
// result ends the turn, and any other message, such as the engine waking the agent with a
// command's end, is said back, so the test reads in the transcript what the agent heard.

const partsSchema = z.array(z.looseObject({ text: z.string().optional() }));
const messageSchema = z.looseObject({
  role: z.string(),
  content: z.union([z.string(), partsSchema, z.null()]).optional(),
});
const bodySchema = z.looseObject({
  stream: z.boolean().optional(),
  messages: z.array(messageSchema).optional(),
});
const argsSchema = z.record(z.string(), jsonValueSchema);
const toolLine = /^TOOL ([a-z_]+) (\{.*\})\s*$/mu;
// How much of a message the model says back.
const heardChars = 4_000;

function textOf(content: z.output<typeof messageSchema>["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  return (content ?? []).map((part) => part.text ?? "").join("\n");
}

// The instructions and the live facts the runtime adds around the chat say nothing of the turn.
const instructionRoles = new Set(["system", "developer"]);
const liveFacts = "Live facts from binference";

function isOfTheChat(message: z.output<typeof messageSchema>): boolean {
  return !instructionRoles.has(message.role) && !textOf(message.content).startsWith(liveFacts);
}

function answerOf(messages: readonly z.output<typeof messageSchema>[]): string {
  const last = messages.findLast(isOfTheChat);
  if (last === undefined || last.role === "tool") {
    return textStream("Done.");
  }
  const text = textOf(last.content);
  const asked = toolLine.exec(text);
  if (asked === null) {
    return textStream(`Heard: ${text.slice(-heardChars)}`);
  }
  const args = argsSchema.parse(JSON.parse(asked[2] ?? "{}"));
  return toolCallStream({ name: asked[1] ?? "", args }, `call_${String(messages.length)}`);
}

const fake = createFakeModelProvider();

/** Answers one request to the image smoke test's scripted model provider. */
export async function answerImageModel(request: HttpRequest): Promise<HttpResponse> {
  const body = bodySchema.parse(JSON.parse(request.body ?? "{}"));
  if (body.stream !== true) {
    return fake.http.request(request);
  }
  const headers = { "content-type": "text/event-stream" };
  return { status: 200, headers, body: answerOf(body.messages ?? []) };
}
