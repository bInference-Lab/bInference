import type { ChatPost } from "../updates/chat-update.schema.js";

/** The fast commands, in the order the menu and `/help` list them (spec 4, section 5). */
export const fastCommandNames = [
  "balance",
  "positions",
  "orders",
  "cancel",
  "freeze",
  "rescue",
  "paper",
  "status",
  "limits",
  "lang",
  "help",
] as const;

/** A fast command's name, as the owner types it after the slash. */
export type FastCommandName = (typeof fastCommandNames)[number];

// `/name`, or `/name@bot` as Telegram writes a command picked from a menu or a group, then the end
// of the text or a space before any arguments.
const commandPattern = /^\/([a-z]+)(?:@\w+)?(?:\s|$)/i;
const names: ReadonlySet<string> = new Set(fastCommandNames);

function isFastCommand(name: string): name is FastCommandName {
  return names.has(name);
}

/**
 * The fast command a post holds, or `undefined` for any other post. Only a message the owner typed
 * counts: an edit, or a message forwarded from elsewhere, runs nothing. The name reads in any case.
 */
export function commandOf(post: ChatPost): FastCommandName | undefined {
  const isTyped = post.kind === "message" && !post.isForwarded;
  const name = isTyped ? commandPattern.exec(post.text ?? "")?.[1]?.toLowerCase() : undefined;
  return name !== undefined && isFastCommand(name) ? name : undefined;
}
