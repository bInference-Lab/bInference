import { err, ok, type Result } from "@binference/core";
import { z } from "zod";

// The inline keyboards of the synthetic Bot API, checked as Telegram checks them.

/** One inline button of a message: its label, and its callback data or Mini App URL. */
export interface FakeButton {
  readonly text: string;
  /** The callback data a press of the button carries. */
  readonly data?: string;
  /** The HTTPS URL of the Mini App the button opens. */
  readonly webApp?: string;
}

/** A message's inline keyboard, row by row. */
export type Keyboard = readonly (readonly FakeButton[])[];

/** A call's `reply_markup`, as the Bot API takes it. */
export interface Markup {
  readonly inline_keyboard: readonly (readonly {
    readonly text: string;
    readonly callback_data?: string | undefined;
    readonly web_app?: { readonly url: string } | undefined;
  }[])[];
}

const maxDataBytes = 64;
const encoder = new TextEncoder();

const buttonSchema = z.looseObject({
  text: z.string().min(1),
  callback_data: z.string().optional(),
  web_app: z.looseObject({ url: z.string() }).optional(),
});
/** Parses a call's `reply_markup`. */
export const markupSchema: z.ZodType<Markup | undefined> = z
  .looseObject({ inline_keyboard: z.array(z.array(buttonSchema)) })
  .optional();

// A button carries callback data or opens a Mini App, never both; Telegram opens a Mini App only
// from an HTTPS URL, and only in a private chat, whose id is the user's own positive id.
function buttonProblem(button: FakeButton, chatId: number): string | undefined {
  if (button.webApp === undefined) {
    const bytes = encoder.encode(button.data ?? "x").length;
    return bytes >= 1 && bytes <= maxDataBytes ? undefined : "Bad Request: BUTTON_DATA_INVALID";
  }
  if (button.data !== undefined || chatId <= 0) {
    return "Bad Request: BUTTON_TYPE_INVALID";
  }
  return URL.parse(button.webApp)?.protocol === "https:"
    ? undefined
    : `Bad Request: inline keyboard button Web App URL '${button.webApp}' is invalid: Only HTTPS links are allowed`;
}

/** The keyboard of a call's markup, or the error Telegram answers for a bad button. */
export function keyboardOf(markup: Markup | undefined, chatId: number): Result<Keyboard, string> {
  const rows = (markup?.inline_keyboard ?? []).map((row) =>
    row.map((button) => ({
      text: button.text,
      ...(button.callback_data === undefined ? {} : { data: button.callback_data }),
      ...(button.web_app === undefined ? {} : { webApp: button.web_app.url }),
    })),
  );
  const problem = rows
    .flat()
    .map((button) => buttonProblem(button, chatId))
    .find(Boolean);
  return problem === undefined ? ok(rows) : err(problem);
}
