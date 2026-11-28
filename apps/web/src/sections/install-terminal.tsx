"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { useAgent } from "../agent/agent-context";
import styles from "./install-terminal.module.css";

/** The words of the install terminal. */
export interface InstallWords {
  /** Read before the command by a screen reader: the window copies it. */
  readonly copy: string;
  /** The faint hint in the title bar. */
  readonly hint: string;
  /** What the terminal prints once the command is copied. */
  readonly copied: ReactNode;
  /** What the agent writes in its corner while the reader takes the command. */
  readonly status: string;
}

type Kind = "program" | "flag" | "url" | "pipe" | "space";

// The command in the parts a shell would color; the line may break after the host.
const parts: readonly { readonly text: string; readonly kind: Kind }[] = [
  { text: "curl", kind: "program" },
  { text: " ", kind: "space" },
  { text: "-fsSL", kind: "flag" },
  { text: " ", kind: "space" },
  { text: "https://agent.binference.io/", kind: "url" },
  { text: "install.sh", kind: "url" },
  { text: " ", kind: "space" },
  { text: "|", kind: "pipe" },
  { text: " ", kind: "space" },
  { text: "sh", kind: "program" },
  { text: " ", kind: "space" },
  { text: "-s -- --beta", kind: "flag" },
];

const command = parts.map((part) => part.text).join("");
const host = "curl -fsSL https://agent.binference.io/".length;
const plain = parts.flatMap((part) =>
  Array.from(part.text, (letter) => ({ letter, kind: part.kind })),
);
const letters = plain.map((item, at) => ({ letter: item.letter, kind: item.kind, at }));

/** How long the agent waits for the page to open, then how fast it types, in milliseconds. */
const typing = { after: 2300, each: 30 };

// The agent types its own command once the page opens; with reduced motion it is there at once.
function useTyped(): number {
  const [typed, setTyped] = useState(letters.length);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return undefined;
    }
    const start = performance.now() + typing.after;
    let frame = requestAnimationFrame(function step(now: number): void {
      setTyped(Math.max(0, Math.min(letters.length, Math.floor((now - start) / typing.each))));
      if (now - start < letters.length * typing.each) {
        frame = requestAnimationFrame(step);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return typed;
}

function Command(props: { readonly typed: number }): React.JSX.Element {
  return (
    <span className={styles["command"]} aria-hidden="true">
      {letters.slice(0, props.typed).map((item) => (
        <span key={item.at} className={styles[item.kind]} style={{ "--i": item.at }}>
          {item.letter}
          {item.at === host - 1 ? <wbr /> : null}
        </span>
      ))}
    </span>
  );
}

interface Copying {
  readonly screen: React.RefObject<HTMLButtonElement | null>;
  /** How many times the reader copied: each copy plays the answer again. */
  readonly round: number;
  readonly copy: () => Promise<void>;
}

// The agent above pulses and looks at the terminal while its corner writes what comes next.
function useCopy(status: string): Copying {
  const bus = useAgent();
  const screen = useRef<HTMLButtonElement>(null);
  const [round, setRound] = useState(0);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // Without clipboard access the reader selects the command and copies it by hand.
      return;
    }
    bus.tap();
    bus.pulse();
    setRound((value) => value + 1);
    const { current: target } = screen;
    if (target === null) {
      return;
    }
    bus.order({ mode: "think", target, label: status, until: performance.now() + 900 });
    setTimeout(() => {
      bus.order({ mode: "idle", target, label: status, until: performance.now() + 4200 });
    }, 900);
  };
  return { screen, round, copy };
}

/**
 * The install command as a terminal, first on the page. The agent types the command at a zsh
 * prompt as the page opens. A click anywhere on it copies: a gold selection sweeps the command,
 * the terminal answers with how to paste it and a fresh prompt, and the agent above looks on.
 */
export function InstallTerminal(props: { readonly words: InstallWords }): React.JSX.Element {
  const typed = useTyped();
  const { screen, round, copy } = useCopy(props.words.status);
  return (
    <div className={styles["terminal"]} id="install" data-copied={round > 0 ? "" : undefined}>
      <div className={styles["bar"]} aria-hidden="true">
        <i />
        <i />
        <i />
        <span>{props.words.hint}</span>
      </div>
      <button ref={screen} type="button" className={styles["screen"]} onClick={() => void copy()}>
        <span className={styles["spoken"]}>{props.words.copy}</span>
        <span className={styles["line"]} key={round}>
          <span className={styles["prompt"]} aria-hidden="true">
            ~ %
          </span>
          <Command typed={typed} />
          <span className={styles["spoken"]}>{command}</span>
          <i className={styles["cursor"]} aria-hidden="true" />
        </span>
      </button>
      <div className={styles["answer"]} key={round} aria-live="polite">
        <div>
          {round > 0 ? (
            <p className={styles["said"]}>
              <svg className={styles["tick"]} viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 8.5l3.2 3L13 4.5" />
              </svg>
              {props.words.copied}
            </p>
          ) : null}
          <p className={styles["next"]} aria-hidden="true">
            <span className={styles["prompt"]}>~ %</span>
            <i className={styles["cursor"]} />
          </p>
        </div>
      </div>
    </div>
  );
}
