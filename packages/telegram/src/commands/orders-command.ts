import { orderLineText } from "@binference/i18n";
import { callOrSay, type CommandContext } from "./command-context.js";

/** `/orders`: the active auto orders with their triggers and fills (spec 4, section 5). */
export async function runOrders(context: CommandContext): Promise<void> {
  const page = await callOrSay(context, "order/list", { state: "active" });
  if (page === undefined) {
    return;
  }
  const display = { formatter: context.formatter, assets: page.assets ?? {} };
  const lines = page.items.map((order) => orderLineText(order, display));
  await context.say(lines.length === 0 ? context.words("cmd.orders.none") : lines.join("\n"));
}
