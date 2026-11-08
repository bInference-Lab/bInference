import type { Random } from "@binference/core";
import { maxSpeechChars, type MediaView, voiceNameSchema } from "@binference/protocol";
import { z } from "zod";
import type { ToolOutcome } from "../loop/turn-records.js";
import type { SpeechSource } from "../providers/speech-making.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { storeMedia } from "./store-media.js";
import type { AgentToolParts } from "./tool-client.js";

/** What `speak` runs on (decision 0405): what speaks, the owner's voice, and ids. */
export interface SpeakingToolParts {
  readonly source: SpeechSource;
  /** `speech.voice`, the voice to speak with when the call names none. */
  readonly voice?: string;
  readonly random: Random;
}

/** The args of `speak`: the words, and the voice to speak them with. */
interface SpeakArgs {
  readonly text: string;
  readonly voice?: string;
}

const speakArgs: z.ZodType<SpeakArgs> = z.strictObject({
  text: z.string().trim().min(1).max(maxSpeechChars),
  voice: voiceNameSchema.exactOptional(),
});

// What each refusal of the machine's own voice tells the agent.
const localRefusals: Readonly<Record<string, string>> = {
  "speech.local_unavailable":
    "This machine has no voice binference speaks with: only macOS does. Tell the owner models.speech can name a model of an OpenAI-compatible provider.",
  "speech.failed":
    "The machine's voice could not speak the words. Check the voice: speech.voice must name one of the machine's voices, or leave voice out.",
};

/** The words spoken, saved in the workspace, or why not, in a line the agent reads. */
type Spoken = MediaView | string;

const codeOf = (error: ErrorOptions["cause"]): string =>
  error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "";

async function spokenLocally(
  parts: AgentToolParts,
  request: { readonly text: string; readonly voice?: string },
  signal: AbortSignal,
): Promise<Spoken> {
  try {
    const args = { agent: parts.agent, ...request };
    const said = await parts.client.call("speech/local", args, { signal });
    return said.media ?? "The machine's voice spoke nothing.";
  } catch (error) {
    return localRefusals[codeOf(error)] ?? "The machine's voice could not speak the words.";
  }
}

async function spokenByModel(
  parts: AgentToolParts,
  speaking: SpeakingToolParts & { readonly source: { readonly kind: "model" } },
  call: { readonly request: SpeakArgs; readonly signal: AbortSignal },
): Promise<Spoken> {
  const { signal } = call;
  const spoken = await speaking.source.maker.speak(call.request, signal);
  if (!spoken.ok) {
    return `Speaking failed: ${spoken.failure}. Tell the owner in a line.`;
  }
  const job = Buffer.from(speaking.random.bytes(8)).toString("hex");
  const saved = await storeMedia(parts, { job, kind: "voice", bytes: spoken.audio }, signal).catch(
    () => undefined,
  );
  return saved ?? "The speech could not be saved in your workspace.";
}

async function speak(
  parts: AgentToolParts,
  speaking: SpeakingToolParts,
  call: { readonly args: SpeakArgs; readonly signal: AbortSignal },
): Promise<ToolOutcome> {
  const { source } = speaking;
  if (source.kind === "none") {
    return { text: source.failure, isError: true };
  }
  const voice = call.args.voice ?? speaking.voice;
  const request = { text: call.args.text, ...(voice === undefined ? {} : { voice }) };
  const saved =
    source.kind === "local"
      ? await spokenLocally(parts, request, call.signal)
      : await spokenByModel(parts, { ...speaking, source }, { request, signal: call.signal });
  if (typeof saved === "string") {
    return { text: saved, isError: true };
  }
  const sent = { agent: parts.agent, turn: parts.turn.turn, media: saved.media };
  await parts.client.call("media/send", sent, { signal: call.signal });
  return {
    text: `The owner hears your words now as a voice note in the chat; it is saved at ${saved.path}. Never write the same words again as text: your answer may be empty, or one short line that adds something.`,
    isError: false,
    shown: [call.args.text],
  };
}

/**
 * `speak`, a control tool (decision 0405): speaks up to 4,000 characters with `models.speech`, a
 * model of an `openai` provider or the voice of the engine's machine, saves the audio in the
 * workspace and sends it to the owner's chat as a voice note. It names the words as shown, so the
 * turn's text never repeats them (decision 0381).
 */
export function speakTool(parts: AgentToolParts, speaking: SpeakingToolParts): AgentTool {
  return defineTool({
    name: "speak",
    kind: "control",
    description: agentToolTexts.speak,
    args: speakArgs,
    run: async (args, { signal }) => speak(parts, speaking, { args, signal }),
  });
}
