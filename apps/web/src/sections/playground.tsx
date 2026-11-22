"use client";

import { type ReactNode, useRef, useState } from "react";
import type { AgentBus } from "../agent/agent-bus";
import { useAgent } from "../agent/agent-context";
import { AgentSlot } from "../agent/agent-slot";
import { Reveal } from "../motion/reveal";
import { answered, type DemoCard, type DemoLine, type DemoRun, demoPace } from "./demo-script";
import styles from "./playground.module.css";

/** The playground's words. */
export interface PlaygroundWords {
  readonly title: ReactNode;
  readonly sub: string;
  readonly idle: string;
  readonly waiting: string;
  readonly cancelled: ReactNode;
  readonly confirm: string;
  readonly cancel: string;
  readonly label: string;
  readonly listening: string;
  readonly waitingTap: string;
  readonly done: string;
  readonly standing: string;
  readonly frozen: string;
}

/** The reader's answer to a demo card. */
type Reply = "confirm" | "cancel";

function pause(ms: number, signal: AbortSignal): Promise<boolean> {
  const instant = matchMedia("(prefers-reduced-motion: reduce)").matches;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(!signal.aborted), instant ? 0 : ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

interface Player {
  readonly bus: AgentBus;
  readonly words: PlaygroundWords;
  readonly show: (update: (lines: readonly DemoLine[]) => readonly DemoLine[]) => void;
  readonly signal: AbortSignal;
}

// The steps show one after another, each after its pause; a newer run stops this one.
async function showSteps(run: DemoRun, player: Player): Promise<boolean> {
  return run.steps.reduce(
    async (going, step) => {
      if (!(await going)) {
        return false;
      }
      player.bus.order({ mode: "think", label: step.use });
      player.show((lines) => [...lines, { kind: "step", text: step.text }]);
      return pause(demoPace.step, player.signal);
    },
    pause(demoPace.ask, player.signal),
  );
}

async function play(run: DemoRun, player: Player): Promise<void> {
  const { bus, show, signal } = player;
  show(() => [{ kind: "me", text: run.ask }]);
  bus.order({ mode: "think", label: player.words.listening });
  if (!(await showSteps(run, player))) {
    return;
  }
  const { card } = run;
  if (card === undefined) {
    bus.order({ mode: "frozen", label: player.words.frozen });
    show((lines) => [...lines, { kind: "result", tone: "cold", body: run.frozen }]);
    return;
  }
  if (await pause(demoPace.card, signal)) {
    show((lines) => [...lines, { kind: "card", card, answered: false }, { kind: "waiting" }]);
    const target = document.querySelector("[data-agent-target=demo-confirm]") ?? undefined;
    bus.order(
      target === undefined
        ? { mode: "wait", label: player.words.waitingTap }
        : { mode: "wait", label: player.words.waitingTap, target },
    );
  }
}

interface PlayerView {
  readonly lines: readonly DemoLine[];
  readonly picked: string | undefined;
  readonly start: (run: DemoRun) => void;
  readonly answer: (card: DemoCard, reply: Reply) => void;
}

function usePlayer(words: PlaygroundWords): PlayerView {
  const bus = useAgent();
  const [lines, setLines] = useState<readonly DemoLine[]>([]);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const current = useRef<AbortController | undefined>(undefined);
  const start = (run: DemoRun): void => {
    current.current?.abort();
    const control = new AbortController();
    current.current = control;
    bus.tap();
    setPicked(run.id);
    void play(run, { bus, words, show: setLines, signal: control.signal });
  };
  const answer = (card: DemoCard, reply: Reply): void => {
    const yes = reply === "confirm";
    bus.tap();
    if (yes) {
      bus.pulse();
    }
    bus.order({
      mode: "idle",
      label: yes ? words.done : words.standing,
      until: performance.now() + 2600,
    });
    setLines((now) =>
      answered(now, {
        kind: "result",
        tone: yes ? "ok" : "no",
        body: yes ? card.done : words.cancelled,
      }),
    );
  };
  return { lines, picked, start, answer };
}

/** Now talk to me: pick a request; the agent works, then stops at its card and waits for a tap. */
export function Playground(props: {
  readonly words: PlaygroundWords;
  readonly runs: readonly DemoRun[];
}): React.JSX.Element {
  const player = usePlayer(props.words);
  return (
    <section className={`wide ${styles["play"] ?? ""}`} id="play">
      <Reveal tag="h2" wordsOnly className={`t-xl thin ${styles["title"] ?? ""}`}>
        {props.words.title}
      </Reveal>
      <Reveal tag="p" className={`t-lead mute ${styles["sub"] ?? ""}`}>
        {props.words.sub}
      </Reveal>
      <div className={styles["board"]}>
        <div className={styles["asks"]}>
          <AgentSlot className={styles["slot"]} label={props.words.label} />
          {props.runs.map((run) => (
            <button
              key={run.id}
              type="button"
              className={styles["ask"]}
              aria-pressed={player.picked === run.id}
              onClick={() => player.start(run)}
            >
              {run.ask}
              <small>{run.hint}</small>
            </button>
          ))}
        </div>
        <Screen lines={player.lines} words={props.words} onAnswer={player.answer} />
      </div>
    </section>
  );
}

interface ScreenProps {
  readonly lines: readonly DemoLine[];
  readonly words: PlaygroundWords;
  readonly onAnswer: (card: DemoCard, reply: Reply) => void;
}

// Within one run every line says something of its own, so what it says is its key.
function lineKey(line: DemoLine): string {
  if (line.kind === "me" || line.kind === "step") {
    return `${line.kind}:${line.text}`;
  }
  return line.kind;
}

function Screen(props: ScreenProps): React.JSX.Element {
  return (
    <div className={styles["screen"]} aria-live="polite">
      {props.lines.length === 0 ? <div className={styles["idle"]}>{props.words.idle}</div> : null}
      {props.lines.map((line) => (
        <Line key={lineKey(line)} line={line} words={props.words} onAnswer={props.onAnswer} />
      ))}
    </div>
  );
}

function CardLine(props: {
  readonly card: DemoCard;
  readonly answered: boolean;
  readonly words: PlaygroundWords;
  readonly onAnswer: ScreenProps["onAnswer"];
}): React.JSX.Element {
  const { card, words } = props;
  return (
    <div className={styles["card"]}>
      <div className={styles["head"]}>
        <i />
        {card.head}
      </div>
      <div className={styles["action"]}>{card.action}</div>
      {card.lines.map((text) => (
        <div key={text} className={styles["line"]}>
          {text}
        </div>
      ))}
      {props.answered ? null : (
        <div className={styles["keys"]}>
          <button
            type="button"
            className={styles["yes"]}
            data-agent-target="demo-confirm"
            onClick={() => props.onAnswer(card, "confirm")}
          >
            {words.confirm}
          </button>
          <button type="button" onClick={() => props.onAnswer(card, "cancel")}>
            {words.cancel}
          </button>
        </div>
      )}
    </div>
  );
}

function Line(props: {
  readonly line: DemoLine;
  readonly words: PlaygroundWords;
  readonly onAnswer: ScreenProps["onAnswer"];
}): React.JSX.Element {
  const { line, words } = props;
  if (line.kind === "me") {
    return <div className={`${styles["bubble"] ?? ""} ${styles["me"] ?? ""}`}>{line.text}</div>;
  }
  if (line.kind === "step") {
    return (
      <div className={styles["step"]}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path pathLength={1} d="M4 10.5l4 4 8-9" />
        </svg>
        {line.text}
      </div>
    );
  }
  if (line.kind === "waiting") {
    return <div className={styles["waiting"]}>{words.waiting}</div>;
  }
  if (line.kind === "result") {
    return (
      <div className={`${styles["bubble"] ?? ""} ${styles["it"] ?? ""} ${styles[line.tone] ?? ""}`}>
        {line.body}
      </div>
    );
  }
  return (
    <CardLine card={line.card} answered={line.answered} words={words} onAnswer={props.onAnswer} />
  );
}
