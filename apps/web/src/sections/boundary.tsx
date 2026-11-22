"use client";

import { type ReactNode, useState } from "react";
import { useAgent } from "../agent/agent-context";
import { Reveal } from "../motion/reveal";
import { Scene } from "../motion/scene";
import styles from "./boundary.module.css";

/** The trust boundary's words. */
export interface BoundaryWords {
  readonly title: ReactNode;
  readonly sub: string;
  readonly label: string;
  readonly zone: string;
  readonly sources: readonly [string, string, string, string];
  readonly engine: string;
  readonly engineNote: string;
  readonly signer: string;
  readonly signerNote: string;
  readonly chain: string;
  readonly waiting: string;
  readonly confirmed: string;
  readonly tap: string;
  readonly again: string;
  readonly note: string;
}

const wires: readonly number[] = [90, 170, 250, 330];

type SendState = "waiting" | "sending" | "confirmed";

interface DiagramProps {
  readonly words: BoundaryWords;
  readonly state: SendState;
}

const coinMotion = "boundary-coin";

function startCoin(): void {
  const motion = document.getElementById(coinMotion);
  if (motion instanceof SVGAnimationElement) {
    motion.beginElement();
  }
}

function Nodes(props: DiagramProps): React.JSX.Element {
  const { words, state } = props;
  return (
    <>
      {words.sources.map((name, index) => (
        <g key={name}>
          <rect
            className={styles["node"]}
            x="40"
            y={68 + index * 80}
            width="160"
            height="44"
            rx="22"
          />
          <text x="120" y={96 + index * 80} textAnchor="middle">
            {name}
          </text>
        </g>
      ))}
      <Hub x={500} name={words.engine} note={words.engineNote} />
      <Hub x={740} name={words.signer} note={words.signerNote} />
      <circle
        className={`${styles["landed"] ?? ""} ${state === "confirmed" ? (styles["ping"] ?? "") : ""}`}
        cx="920"
        cy="210"
        r="40"
      />
      <Hub
        x={920}
        name={words.chain}
        note={state === "confirmed" ? words.confirmed : words.waiting}
        plain
      />
    </>
  );
}

function Wires(): React.JSX.Element {
  return (
    <>
      {wires.map((y, index) => (
        <path
          key={y}
          id={`wire-${String(index)}`}
          className={styles["wire"]}
          pathLength={1}
          d={`M200 ${String(y)} C300 ${String(y)} 330 210 440 210`}
        />
      ))}
      <path
        id="wire-money"
        className={`${styles["wire"] ?? ""} ${styles["money"] ?? ""}`}
        pathLength={1}
        d="M560 210 L880 210"
      />
      {wires.map((y, index) => (
        <circle key={y} className={styles["packet"]} r="3.5">
          <animateMotion
            dur={`${String(2.8 + index * 0.33)}s`}
            repeatCount="indefinite"
            begin={`${String(index * 0.7)}s`}
          >
            <mpath href={`#wire-${String(index)}`} />
          </animateMotion>
        </circle>
      ))}
    </>
  );
}

function Diagram(props: DiagramProps): React.JSX.Element {
  const { words, state } = props;
  return (
    <svg className={styles["diagram"]} viewBox="0 0 1040 420" aria-labelledby="boundary-title">
      <title id="boundary-title">{words.label}</title>
      <rect className={styles["zone"]} x="370" y="40" width="580" height="340" rx="28" />
      <text className={styles["small"]} x="388" y="70">
        {words.zone}
      </text>
      <Wires />
      <circle
        className={`${styles["coin"] ?? ""} ${state === "sending" ? (styles["going"] ?? "") : ""}`}
        r="7"
      >
        <animateMotion
          id={coinMotion}
          dur="1.7s"
          begin="indefinite"
          fill="freeze"
          calcMode="spline"
          keyTimes="0;1"
          keySplines="0.4 0 0.2 1"
        >
          <mpath href="#wire-money" />
        </animateMotion>
      </circle>
      <Nodes words={words} state={state} />
    </svg>
  );
}

/** Only two parts touch money: proposals flow in, and the reader's tap sends the gold one through. */
export function Boundary(props: { readonly words: BoundaryWords }): React.JSX.Element {
  const { words } = props;
  const bus = useAgent();
  const [state, setState] = useState<SendState>("waiting");
  const send = (): void => {
    bus.tap();
    setState("sending");
    startCoin();
    setTimeout(() => setState("confirmed"), 1700);
  };
  return (
    <Scene mode="view" className={`wide ${styles["boundary"] ?? ""}`}>
      <Reveal tag="h2" wordsOnly className={styles["title"]}>
        {words.title}
      </Reveal>
      <Reveal tag="p" order={1} className={`t-lead mute ${styles["sub"] ?? ""}`}>
        {words.sub}
      </Reveal>
      <Diagram words={words} state={state} />
      <div className={styles["tap"]}>
        <button type="button" className="btn" disabled={state === "sending"} onClick={send}>
          {state === "confirmed" ? words.again : words.tap}
        </button>
        <span className="t-small mute">{words.note}</span>
      </div>
    </Scene>
  );
}

function Hub(props: {
  readonly x: number;
  readonly name: string;
  readonly note: string;
  readonly plain?: boolean;
}): React.JSX.Element {
  const radius = props.plain === true ? 40 : 60;
  return (
    <g>
      <circle
        className={props.plain === true ? styles["node"] : styles["core"]}
        cx={props.x}
        cy="210"
        r={radius}
      />
      <text x={props.x} y="207" textAnchor="middle">
        {props.name}
      </text>
      <text
        className={styles["small"]}
        x={props.x}
        y={props.plain === true ? 226 : 228}
        textAnchor="middle"
      >
        {props.note}
      </text>
    </g>
  );
}
