import { type LaunchTerms, launchTermsSchema } from "@binference/protocol";
import { z } from "zod";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { answerOrRefusal } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

/** What `launch_draft` takes: the launch's terms, and which of the turn's photos is its picture. */
interface DraftArgs {
  readonly launch: LaunchTerms;
  /** The place of the photo among those the owner sent with this turn's messages, from 1. */
  readonly photo?: number;
}

const draftArgs: z.ZodType<DraftArgs> = z.strictObject({
  launch: launchTermsSchema,
  photo: z.int().min(1).max(16).exactOptional(),
});

const unsent = "not drafted, and nothing reached the owner:";

// The engine's refusals (decisions 0285 and 0286), each read as what to do next.
const refusals: Readonly<Record<string, string>> = {
  "image.not_found": `${unsent} the picture must be a photo the owner sent in Telegram with a message of this turn. Ask the owner to send the picture with the launch request.`,
  "image.too_large": `${unsent} the photo is over 5 MiB. Ask the owner for a smaller one.`,
  "image.format": `${unsent} the photo is not a PNG, JPEG or WebP. Ask the owner for one of these.`,
  "image.unreadable": `${unsent} binference could not read the photo, or it does not tell its size. Ask the owner to send it again, as a file.`,
  "intent.launch_picture_too_large": `${unsent} this launchpad writes the picture on chain and takes only a small one, such as a 64 by 64 WebP of about 1 KB. Ask the owner to send a smaller picture as a file.`,
  "agent.paper_only": `${unsent} this agent is in paper mode, and a token launch is live only. Tell the owner; going live is their step.`,
  "intent.launch_wallet_missing": `${unsent} this agent has no launch wallet. Tell the owner to make one with \`binference wallet create --launch\` and fund it from outside.`,
  "intent.launch_waiting": `${unsent} another launch of this agent is under way. Wait until it is signed or ends.`,
  "protocol.bad_args": `${unsent} the terms do not fit the launchpad: a setting it does not take or that is out of bounds, words too long for its card, a first buy in another asset than the pair, a photo on a launchpad that takes a picture link, or no photo on one that takes a picture. Read launchpads and draft again.`,
};

/** What the model reads once the draft went out (runtime spec, section 6.5). */
export const draftedText =
  "drafted; the owner sees every line in Telegram and starts it with Start launch, within 10 minutes. Nothing is public until then; on a launchpad that uploads, Start makes the words and picture public at once. The launch card asks again before anything is signed.";

/**
 * `launch_draft`, a control tool (runtime spec, section 6.5): drafts a token launch through
 * `launch/draft` for the owner to start in Telegram (decision 0285). Its picture is the nth photo
 * the owner sent the bot with this turn's messages (decision 0286); a launchpad that takes a
 * picture link takes it as its `pictureLink` setting and no photo. A photo the turn does not hold
 * is refused before anything reaches the engine. It never commits the turn.
 */
export function launchDraftTool({ agent, client, turn }: AgentToolParts): AgentTool {
  return defineTool({
    name: "launch_draft",
    kind: "control",
    description: agentToolTexts.launch_draft,
    args: draftArgs,
    run: async ({ launch, photo }, { signal, idempotencyKey }) => {
      const picked = photo === undefined ? undefined : turn.photos?.[photo - 1];
      if (photo !== undefined && picked === undefined) {
        return { text: refusals["image.not_found"] ?? unsent, isError: true };
      }
      return answerOrRefusal({ tool: "launch_draft", refusals }, async () => {
        const { session, turn: turnId } = turn;
        const drafted = {
          agent,
          session,
          turn: turnId,
          launch,
          ...(picked === undefined ? {} : { photo: picked }),
        };
        await client.call("launch/draft", drafted, { signal, key: idempotencyKey });
        return { text: draftedText, isError: false };
      });
    },
  });
}
