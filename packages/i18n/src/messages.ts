import enAutoAsks from "../messages/en/autoAsks.json" with { type: "json" };
import enCard from "../messages/en/card.json" with { type: "json" };
import enCli from "../messages/en/cli.json" with { type: "json" };
import enError from "../messages/en/error.json" with { type: "json" };
import enReason from "../messages/en/reason.json" with { type: "json" };
import enReceipt from "../messages/en/receipt.json" with { type: "json" };
import enTelegram from "../messages/en/telegram.json" with { type: "json" };
import zhAutoAsks from "../messages/zh/autoAsks.json" with { type: "json" };
import zhCard from "../messages/zh/card.json" with { type: "json" };
import zhCli from "../messages/zh/cli.json" with { type: "json" };
import zhError from "../messages/zh/error.json" with { type: "json" };
import zhReason from "../messages/zh/reason.json" with { type: "json" };
import zhReceipt from "../messages/zh/receipt.json" with { type: "json" };
import zhTelegram from "../messages/zh/telegram.json" with { type: "json" };
import type { MessageLocale } from "./locales.js";

/** One language's messages: full keys such as `error.engine.locked`, mapped to ICU texts. */
export type Catalog = Readonly<Record<string, string>>;

// Each file is one area; its keys are written without the area, as `engine.locked`.
function inArea(area: string, entries: Catalog): Catalog {
  return Object.fromEntries(
    Object.entries(entries).map(([key, text]: readonly [string, string]) => [
      `${area}.${key}`,
      text,
    ]),
  );
}

/**
 * Every message in every language, read from `messages/<locale>/<area>.json`. A new area file
 * is added here once; a new message in an area is an edit to that area's files alone.
 */
export const messages: Readonly<Record<MessageLocale, Catalog>> = {
  en: {
    ...inArea("error", enError),
    ...inArea("reason", enReason),
    ...inArea("card", enCard),
    ...inArea("autoAsks", enAutoAsks),
    ...inArea("receipt", enReceipt),
    ...inArea("telegram", enTelegram),
    ...inArea("cli", enCli),
  },
  zh: {
    ...inArea("error", zhError),
    ...inArea("reason", zhReason),
    ...inArea("card", zhCard),
    ...inArea("autoAsks", zhAutoAsks),
    ...inArea("receipt", zhReceipt),
    ...inArea("telegram", zhTelegram),
    ...inArea("cli", zhCli),
  },
};
