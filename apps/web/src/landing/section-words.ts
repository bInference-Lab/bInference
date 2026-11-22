import type { BoundaryWords } from "../sections/boundary";
import type { DayEntry } from "../sections/day";
import type { DemoRun } from "../sections/demo-script";
import type { PlaygroundWords } from "../sections/playground";
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

/** The playground's words. */
export function playgroundWords(words: Words): PlaygroundWords {
  return {
    title: words.split("play.title"),
    sub: words.text("play.sub"),
    idle: words.text("play.idle"),
    waiting: words.text("play.waiting"),
    cancelled: words.rich("play.cancelled"),
    confirm: words.text("card.confirm"),
    cancel: words.text("card.cancel"),
    label: words.text("status.play"),
    listening: words.text("status.listening"),
    waitingTap: words.text("status.card"),
    done: words.text("status.done"),
    standing: words.text("status.standing"),
    frozen: words.text("status.frozen"),
  };
}

function step(
  words: Words,
  text: WordKey,
  use: WordKey,
): { readonly text: string; readonly use: string } {
  return { text: words.text(text), use: words.text(use) };
}

/** The three requests the reader can try, scripted with example numbers. */
export function demoRuns(words: Words): readonly DemoRun[] {
  return [
    {
      id: "buy",
      ask: words.text("play.buy"),
      hint: words.text("play.buyHint"),
      steps: [
        step(words, "play.buyRead", "play.buyReadUse"),
        step(words, "play.buyRisk", "play.buyRiskUse"),
        step(words, "play.buyTest", "play.buyTestUse"),
        step(words, "play.buyRoute", "play.buyRouteUse"),
      ],
      card: {
        head: words.text("play.buyHead"),
        action: words.text("play.buyAction"),
        lines: [words.text("play.buyGets"), words.text("play.buyFees")],
        done: words.rich("play.buyDone"),
      },
    },
    {
      id: "stop",
      ask: words.text("play.stop"),
      hint: words.text("play.stopHint"),
      steps: [
        step(words, "play.stopRead", "play.stopReadUse"),
        step(words, "play.stopLevel", "play.stopLevelUse"),
        step(words, "play.stopCode", "play.stopCodeUse"),
      ],
      card: {
        head: words.text("play.stopHead"),
        action: words.text("play.stopAction"),
        lines: [words.text("play.stopTrigger"), words.text("play.stopSlippage")],
        done: words.rich("play.stopDone"),
      },
    },
    {
      id: "freeze",
      ask: words.text("play.freeze"),
      hint: words.text("play.freezeHint"),
      steps: [
        step(words, "play.freezeAgents", "play.freezeUse"),
        step(words, "play.freezeOrders", "play.freezeUse"),
        step(words, "play.freezeTrade", "play.freezeUse"),
      ],
      frozen: words.rich("play.freezeDone"),
    },
  ];
}

/** The trust boundary's words. */
export function boundaryWords(words: Words): BoundaryWords {
  return {
    title: words.split("boundary.title"),
    sub: words.text("boundary.sub"),
    label: words.text("boundary.label"),
    zone: words.text("boundary.zone"),
    sources: [
      words.text("boundary.telegram"),
      words.text("boundary.console"),
      words.text("boundary.terminal"),
      words.text("boundary.model"),
    ],
    engine: words.text("boundary.engine"),
    engineNote: words.text("boundary.engineNote"),
    signer: words.text("boundary.signer"),
    signerNote: words.text("boundary.signerNote"),
    chain: words.text("boundary.chain"),
    waiting: words.text("boundary.waiting"),
    confirmed: words.text("boundary.confirmed"),
    tap: words.text("boundary.tap"),
    again: words.text("boundary.again"),
    note: words.text("boundary.note"),
  };
}

/** I read. I check. I ask: the three ideas of the take-over. */
export function takeoverIdeas(words: Words): readonly [Idea, Idea, Idea] {
  return [
    { title: words.text("takeover.read"), line: words.text("takeover.readLine") },
    { title: words.text("takeover.check"), line: words.text("takeover.checkLine") },
    { title: words.text("takeover.ask"), line: words.text("takeover.askLine") },
  ];
}
