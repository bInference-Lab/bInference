import { type Locale, localeSchema } from "@binference/protocol";
import { z } from "zod";

/** How the agent's replies grow in Telegram while it works (decision 0376). */
export type ReplyStream = "progress" | "partial";

/** How the model's reasoning shows in Telegram (decision 0377). */
export type ReasoningShown = "off" | "streamed" | "kept";

/**
 * The `config/change` patches the owner's Telegram chat may send past its scopes, one setting
 * each: the owner's language (decision 0134), and how the agent's replies and the model's
 * reasoning show in that chat (decision 0377). None loosens a limit or moves money.
 */
export type OwnerChatPatch =
  | { readonly owner: { readonly locale: Locale } }
  | { readonly telegram: { readonly replies: { readonly stream: ReplyStream } } }
  | { readonly telegram: { readonly replies: { readonly reasoning: ReasoningShown } } };

/** Parses how the agent's replies grow. */
export const replyStreamSchema: z.ZodType<ReplyStream> = z.enum(["progress", "partial"]);

/** Parses how the model's reasoning shows. */
export const reasoningShownSchema: z.ZodType<ReasoningShown> = z.enum(["off", "streamed", "kept"]);

/** Parses a patch the owner's chat may send; anything else fails. */
export const ownerChatPatchSchema: z.ZodType<OwnerChatPatch> = z.union([
  z.strictObject({ owner: z.strictObject({ locale: localeSchema }) }),
  z.strictObject({
    telegram: z.strictObject({ replies: z.strictObject({ stream: replyStreamSchema }) }),
  }),
  z.strictObject({
    telegram: z.strictObject({ replies: z.strictObject({ reasoning: reasoningShownSchema }) }),
  }),
]);
