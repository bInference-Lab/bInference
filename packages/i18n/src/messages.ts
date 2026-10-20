import enAlert from "../messages/en/alert.json" with { type: "json" };
import enAutoAsks from "../messages/en/autoAsks.json" with { type: "json" };
import enCard from "../messages/en/card.json" with { type: "json" };
import enCli from "../messages/en/cli.json" with { type: "json" };
import enCmd from "../messages/en/cmd.json" with { type: "json" };
import enConsole from "../messages/en/console.json" with { type: "json" };
import enDaily from "../messages/en/daily.json" with { type: "json" };
import enDisclaimer from "../messages/en/disclaimer.json" with { type: "json" };
import enError from "../messages/en/error.json" with { type: "json" };
import enFill from "../messages/en/fill.json" with { type: "json" };
import enInit from "../messages/en/init.json" with { type: "json" };
import enLanguage from "../messages/en/language.json" with { type: "json" };
import enLaunch from "../messages/en/launch.json" with { type: "json" };
import enLimit from "../messages/en/limit.json" with { type: "json" };
import enNotice from "../messages/en/notice.json" with { type: "json" };
import enOrder from "../messages/en/order.json" with { type: "json" };
import enPnl from "../messages/en/pnl.json" with { type: "json" };
import enQuestion from "../messages/en/question.json" with { type: "json" };
import enReason from "../messages/en/reason.json" with { type: "json" };
import enReceipt from "../messages/en/receipt.json" with { type: "json" };
import enTelegram from "../messages/en/telegram.json" with { type: "json" };
import enTui from "../messages/en/tui.json" with { type: "json" };
import enTurn from "../messages/en/turn.json" with { type: "json" };
import enWebPush from "../messages/en/webPush.json" with { type: "json" };
import enWorkspace from "../messages/en/workspace.json" with { type: "json" };
import zhAlert from "../messages/zh/alert.json" with { type: "json" };
import zhAutoAsks from "../messages/zh/autoAsks.json" with { type: "json" };
import zhCard from "../messages/zh/card.json" with { type: "json" };
import zhCli from "../messages/zh/cli.json" with { type: "json" };
import zhCmd from "../messages/zh/cmd.json" with { type: "json" };
import zhConsole from "../messages/zh/console.json" with { type: "json" };
import zhDaily from "../messages/zh/daily.json" with { type: "json" };
import zhDisclaimer from "../messages/zh/disclaimer.json" with { type: "json" };
import zhError from "../messages/zh/error.json" with { type: "json" };
import zhFill from "../messages/zh/fill.json" with { type: "json" };
import zhInit from "../messages/zh/init.json" with { type: "json" };
import zhLanguage from "../messages/zh/language.json" with { type: "json" };
import zhLaunch from "../messages/zh/launch.json" with { type: "json" };
import zhLimit from "../messages/zh/limit.json" with { type: "json" };
import zhNotice from "../messages/zh/notice.json" with { type: "json" };
import zhOrder from "../messages/zh/order.json" with { type: "json" };
import zhPnl from "../messages/zh/pnl.json" with { type: "json" };
import zhQuestion from "../messages/zh/question.json" with { type: "json" };
import zhReason from "../messages/zh/reason.json" with { type: "json" };
import zhReceipt from "../messages/zh/receipt.json" with { type: "json" };
import zhTelegram from "../messages/zh/telegram.json" with { type: "json" };
import zhTui from "../messages/zh/tui.json" with { type: "json" };
import zhTurn from "../messages/zh/turn.json" with { type: "json" };
import zhWebPush from "../messages/zh/webPush.json" with { type: "json" };
import zhWorkspace from "../messages/zh/workspace.json" with { type: "json" };
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
    ...inArea("notice", enNotice),
    ...inArea("daily", enDaily),
    ...inArea("order", enOrder),
    ...inArea("pnl", enPnl),
    ...inArea("fill", enFill),
    ...inArea("alert", enAlert),
    ...inArea("launch", enLaunch),
    ...inArea("telegram", enTelegram),
    ...inArea("turn", enTurn),
    ...inArea("tui", enTui),
    ...inArea("question", enQuestion),
    ...inArea("cmd", enCmd),
    ...inArea("cli", enCli),
    ...inArea("init", enInit),
    ...inArea("disclaimer", enDisclaimer),
    ...inArea("language", enLanguage),
    ...inArea("limit", enLimit),
    ...inArea("console", enConsole),
    ...inArea("webPush", enWebPush),
    ...inArea("workspace", enWorkspace),
  },
  zh: {
    ...inArea("error", zhError),
    ...inArea("reason", zhReason),
    ...inArea("card", zhCard),
    ...inArea("autoAsks", zhAutoAsks),
    ...inArea("receipt", zhReceipt),
    ...inArea("notice", zhNotice),
    ...inArea("daily", zhDaily),
    ...inArea("order", zhOrder),
    ...inArea("pnl", zhPnl),
    ...inArea("fill", zhFill),
    ...inArea("alert", zhAlert),
    ...inArea("launch", zhLaunch),
    ...inArea("telegram", zhTelegram),
    ...inArea("turn", zhTurn),
    ...inArea("tui", zhTui),
    ...inArea("question", zhQuestion),
    ...inArea("cmd", zhCmd),
    ...inArea("cli", zhCli),
    ...inArea("init", zhInit),
    ...inArea("disclaimer", zhDisclaimer),
    ...inArea("language", zhLanguage),
    ...inArea("limit", zhLimit),
    ...inArea("console", zhConsole),
    ...inArea("webPush", zhWebPush),
    ...inArea("workspace", zhWorkspace),
  },
};
