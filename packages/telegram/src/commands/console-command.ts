import type { CommandContext } from "./command-context.js";

// Telegram opens a Mini App only from an HTTPS address, so any other never becomes a button.
function httpsUrlOf(address: string | undefined): string | undefined {
  const url = address === undefined ? undefined : URL.parse(address);
  return url?.protocol === "https:" && url.username === "" && url.password === ""
    ? url.href
    : undefined;
}

/**
 * `/console`: a button that opens the console inside Telegram, at the Mini App's HTTPS address,
 * with a new single-use launch ticket in its fragment (decision 0161), which the engine never
 * receives in a request and Telegram adds its launch data beside. Without an address it says how
 * to publish the engine's port and set `remote.publicUrl`, and sends no button.
 */
export async function runConsole(context: CommandContext): Promise<void> {
  const url = httpsUrlOf(context.miniAppUrl);
  if (url === undefined) {
    await context.say(context.words("cmd.console.noAddress"));
    return;
  }
  const address = new URL(url);
  address.hash = new URLSearchParams({ ticket: await context.issueLaunchTicket() }).toString();
  const button = { text: context.words("cmd.console.button"), webApp: address.href };
  await context.say(context.words("cmd.console.open"), { buttons: [[button]] });
}
