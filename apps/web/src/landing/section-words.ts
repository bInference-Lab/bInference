import type { DayEntry } from "../sections/day";
import type { Idea } from "../sections/takeover";
import type { Tool } from "../sections/tools";
import type { WordKey, Words } from "../words/words";

const dayLog: readonly { readonly time: string; readonly key: WordKey; readonly at: number }[] = [
  { time: "02:14", key: "day.night", at: 0.08 },
  { time: "06:30", key: "day.morning", at: 0.24 },
  { time: "09:02", key: "day.alert", at: 0.36 },
  { time: "13:15", key: "day.noon", at: 0.52 },
  { time: "18:40", key: "day.evening", at: 0.74 },
  { time: "23:59", key: "day.midnight", at: 0.95 },
];

/** The example day's log, each line with its time and the point of the day it lights up. */
export function dayEntries(words: Words): readonly DayEntry[] {
  return dayLog.map((entry) => ({ time: entry.time, text: words.text(entry.key), at: entry.at }));
}

const toolKeys: readonly (readonly [WordKey, WordKey, WordKey])[] = [
  ["tools.chain", "tools.chainText", "tools.chainUse"],
  ["tools.wallets", "tools.walletsText", "tools.walletsUse"],
  ["tools.venues", "tools.venuesText", "tools.venuesUse"],
  ["tools.browser", "tools.browserText", "tools.browserUse"],
  ["tools.terminal", "tools.terminalText", "tools.terminalUse"],
  ["tools.clock", "tools.clockText", "tools.clockUse"],
  ["tools.memory", "tools.memoryText", "tools.memoryUse"],
  ["tools.helpers", "tools.helpersText", "tools.helpersUse"],
];

/** The tools the agent can use, in the order the page lists them. */
export function toolList(words: Words): readonly Tool[] {
  return toolKeys.map(([name, text, use]) => ({
    name: words.text(name),
    text: words.text(text),
    use: words.text(use),
  }));
}

/** I read. I check. I ask: the three ideas of the take-over. */
export function takeoverIdeas(words: Words): readonly [Idea, Idea, Idea] {
  return [
    { title: words.text("takeover.read"), line: words.text("takeover.readLine") },
    { title: words.text("takeover.check"), line: words.text("takeover.checkLine") },
    { title: words.text("takeover.ask"), line: words.text("takeover.askLine") },
  ];
}
