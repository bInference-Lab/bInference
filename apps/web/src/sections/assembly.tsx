import type { CSSProperties } from "react";
import { AgentSlot } from "../agent/agent-slot";
import { Scene } from "../motion/scene";
import { Tilt } from "../motion/tilt";
import type { WordKey, Words } from "../words/words";
import styles from "./assembly.module.css";

interface Part {
  readonly key: string;
  readonly role: "model" | "engine" | "signer" | "you";
  readonly gold?: boolean;
  /** How far the part floats from its place before the scroll locks it in. */
  readonly drift: CSSProperties;
  readonly shape: React.JSX.Element;
}

const parts: readonly Part[] = [
  {
    key: "stem",
    role: "engine",
    drift: { "--dx": "-150px", "--dy": "-120px", "--dz": "-260px", "--r": "-16deg" },
    shape: (
      <path d="M0 402L0 17.32A10 10 0 0 1 15 8.66L120 69.28A28 28 0 0 1 134 93.53L134 186.68" />
    ),
  },
  {
    key: "ring",
    role: "engine",
    drift: { "--dx": "40px", "--dy": "60px", "--dz": "-340px" },
    shape: <circle cx="240" cy="402" r="239" />,
  },
  {
    key: "hole",
    role: "signer",
    drift: { "--dx": "-20px", "--dy": "10px", "--dz": "-40px" },
    shape: <circle cx="230" cy="402" r="127" />,
  },
  {
    key: "core",
    role: "you",
    gold: true,
    drift: { "--dx": "0px", "--dy": "0px", "--dz": "330px" },
    shape: <circle cx="230" cy="402" r="38" />,
  },
  {
    key: "node-left",
    role: "model",
    gold: true,
    drift: { "--dx": "-210px", "--dy": "150px", "--dz": "210px" },
    shape: <circle cx="87.41" cy="498.18" r="36" />,
  },
  {
    key: "node-right",
    role: "model",
    gold: true,
    drift: { "--dx": "230px", "--dy": "-170px", "--dz": "150px" },
    shape: <circle cx="372.59" cy="305.82" r="36" />,
  },
  {
    key: "arm-right",
    role: "model",
    drift: { "--dx": "120px", "--dy": "-70px", "--dz": "240px", "--r": "30deg" },
    shape: <path d="M262 376L346 320" />,
  },
  {
    key: "arm-left",
    role: "model",
    drift: { "--dx": "-110px", "--dy": "70px", "--dz": "270px", "--r": "-30deg" },
    shape: <path d="M198 428L114 478" />,
  },
];

const says: readonly { readonly title: WordKey; readonly line?: WordKey }[] = [
  { title: "assembly.model", line: "assembly.modelLine" },
  { title: "assembly.engine", line: "assembly.engineLine" },
  { title: "assembly.signer", line: "assembly.signerLine" },
  { title: "assembly.you" },
];

/** What the agent is made of: its parts float apart in depth, then lock into the mark. */
export function Assembly(props: { readonly words: Words }): React.JSX.Element {
  const { words } = props;
  return (
    <Scene mode="pinned" steps={5} className={styles["assembly"]}>
      <Tilt className={styles["stage"]}>
        <div className={styles["orbits"]} aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <h2 className={`t-xl thin ${styles["head"] ?? ""}`}>{words.rich("assembly.title")}</h2>
        <div className={styles["rig"]} aria-hidden="true">
          <div className={styles["space"]}>
            {parts.map((part) => (
              <svg
                key={part.key}
                viewBox="0 0 480 644"
                className={[
                  styles["part"],
                  styles[part.role],
                  part.gold === true ? styles["gold"] : "",
                ].join(" ")}
                style={part.drift}
              >
                {part.shape}
              </svg>
            ))}
          </div>
          <AgentSlot className={styles["end"]} label={words.text("status.watching")} />
        </div>
        <div className={styles["says"]}>
          {says.map((say) => (
            <p key={say.title} className={styles["say"]}>
              {words.rich(say.title)}
              {say.line === undefined ? null : <small>{words.text(say.line)}</small>}
            </p>
          ))}
        </div>
        <div className={styles["final"]}>
          <h2>{words.rich("assembly.final")}</h2>
        </div>
      </Tilt>
    </Scene>
  );
}
