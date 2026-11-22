import { z } from "zod";

const previewSchema = z.looseObject({
  text: z.string().optional(),
  link_preview_options: z.looseObject({ is_disabled: z.boolean().optional() }).optional(),
});

// The methods whose message Telegram may show a link preview under (Bot API, `LinkPreviewOptions`).
const previewMethods: ReadonlySet<string> = new Set(["sendMessage", "editMessageText"]);

/**
 * Whether Telegram shows a link preview under the message a call sends or edits: its text holds a
 * web link and the call leaves `link_preview_options.is_disabled` unset.
 */
export function showsLinkPreview(method: string, body: string): boolean {
  const read = previewSchema.safeParse(JSON.parse(body)).data;
  const hasLink = /https?:\/\//u.test(read?.text ?? "");
  return previewMethods.has(method) && hasLink && read?.link_preview_options?.is_disabled !== true;
}
