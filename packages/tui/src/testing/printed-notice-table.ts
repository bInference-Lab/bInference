import { createFormatter, type MessageLocale, writeNotice } from "@binference/i18n";
import { noticeTable, noticeTableCoin, noticeTablePush } from "@binference/i18n/testing";
import { startChat } from "./chat-harness.js";

/** The fake chain's coin as the engine's `asset/get` names it. */
const tableCoinInfo = { symbol: "FAKE", name: "Fake", decimals: 18, verified: true };

/**
 * Every notice of the notice table as every surface writes it, in the locale, in UTC, one entry of
 * lines per key: what terminal chat must print.
 */
export function writtenNoticeTable(
  locale: MessageLocale,
): Readonly<Record<string, readonly string[]>> {
  const formatter = createFormatter({ locale, timeZone: "UTC" });
  return Object.fromEntries(
    Object.entries(noticeTable).map(([key, notice]) => [
      key,
      writeNotice(notice, {
        formatter,
        assetInfo: (asset) => notice.assets?.[asset] ?? tableCoinInfo,
      }).split("\n"),
    ]),
  );
}

/**
 * Pushes every notice of the notice table to terminal chat, in key order, in the locale, in UTC,
 * and answers the lines each key printed. Leaves the chat with Ctrl+C at the end.
 */
export async function printedNoticeTable(
  locale: MessageLocale,
): Promise<Readonly<Record<string, readonly string[]>>> {
  const chat = startChat(
    { "asset/get": () => ({ asset: noticeTableCoin, ...tableCoinInfo }) },
    locale,
  );
  await chat.settle();
  const printed: [string, readonly string[]][] = [];
  for (const [at, [key, notice]] of Object.entries(noticeTable).entries()) {
    const before = chat.rows().length - 1;
    chat.push("notice", "notice/new", noticeTablePush(notice, at + 1));
    // oxlint-disable-next-line eslint/no-await-in-loop -- each notice is read once it printed
    await chat.settle();
    printed.push([key, chat.rows().slice(before, -1)]);
  }
  chat.press("\u0003");
  await chat.ended;
  return Object.fromEntries(printed);
}
