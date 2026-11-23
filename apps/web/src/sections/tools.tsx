"use client";

import type { ReactNode } from "react";
import type { AgentBus } from "../agent/agent-bus";
import { useAgent } from "../agent/agent-context";
import { AgentSlot } from "../agent/agent-slot";
import { Reveal } from "../motion/reveal";
import styles from "./tools.module.css";

/** One thing the agent can do. */
export interface Tool {
  readonly name: string;
  readonly text: string;
  /** What it does it with or through: the venues, the services, or a short note. */
  readonly via: string;
  /** The status pill's words while the agent uses it. */
  readonly use: string;
}

/** The tools scene's words. */
export interface ToolsWords {
  readonly title: ReactNode;
  readonly label: string;
}

function putToWork(bus: AgentBus, el: Element, tool: Tool): void {
  bus.order({ mode: "think", target: el, label: tool.use, until: performance.now() + 1400 });
  setTimeout(
    () => bus.order({ mode: "idle", target: el, label: tool.use, until: performance.now() + 2600 }),
    1400,
  );
}

function ToolList(props: {
  readonly tools: readonly Tool[];
  readonly side: string;
}): React.JSX.Element {
  const bus = useAgent();
  return (
    <ul className={`${styles["list"] ?? ""} ${styles[props.side] ?? ""}`}>
      {props.tools.map((tool) => (
        <li key={tool.name}>
          <button
            type="button"
            className={styles["tool"]}
            onPointerEnter={(event) => putToWork(bus, event.currentTarget, tool)}
            onFocus={(event) => putToWork(bus, event.currentTarget, tool)}
            onClick={(event) => putToWork(bus, event.currentTarget, tool)}
          >
            <b>{tool.name}</b>
            <span>{tool.text}</span>
            <small>{tool.via}</small>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** What the agent can do: hover one, and it turns to it and puts it to work. */
export function Tools(props: {
  readonly words: ToolsWords;
  readonly tools: readonly Tool[];
}): React.JSX.Element {
  const half = Math.ceil(props.tools.length / 2);
  return (
    <section className={`wide ${styles["tools"] ?? ""}`} id="features">
      <Reveal tag="h2" wordsOnly className={`t-l thin ${styles["title"] ?? ""}`}>
        {props.words.title}
      </Reveal>
      <div className={styles["kit"]}>
        <ToolList tools={props.tools.slice(0, half)} side="left" />
        <AgentSlot className={styles["slot"]} label={props.words.label} />
        <ToolList tools={props.tools.slice(half)} side="right" />
      </div>
    </section>
  );
}
