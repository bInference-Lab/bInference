import { Scene } from "../motion/scene";
import type { WordKey, Words } from "../words/words";
import styles from "./start.module.css";

interface Step {
  readonly name: WordKey;
  readonly line: WordKey;
  /** A command to run, as typed. */
  readonly command?: string;
  /** Something to say to the agent in Telegram. */
  readonly ask?: WordKey;
}

const steps: readonly Step[] = [
  {
    name: "start.install",
    line: "start.installLine",
    command: "curl -fsSL https://agent.binference.io/install.sh | sh -s -- --beta",
  },
  { name: "start.setUp", line: "start.setUpLine", command: "binference init" },
  { name: "start.pair", line: "start.pairLine" },
  { name: "start.paper", line: "start.paperLine", ask: "start.ask" },
  { name: "start.live", line: "start.liveLine", command: "binference live" },
];

function Sample(props: { readonly step: Step; readonly words: Words }): React.JSX.Element | null {
  const { step, words } = props;
  if (step.command !== undefined) {
    return (
      <p className={styles["command"]}>
        <span>~ %</span> {step.command}
      </p>
    );
  }
  return step.ask === undefined ? null : <p className={styles["ask"]}>{words.text(step.ask)}</p>;
}

/**
 * From the install to the first trade: five steps on a line that draws itself as the reader
 * scrolls, each with the command to type or the words to send.
 */
export function Start(props: { readonly words: Words }): React.JSX.Element {
  const { words } = props;
  return (
    <Scene mode="view" className={`wide ${styles["start"] ?? ""}`} id="start">
      <h2 className={`t-l thin ${styles["title"] ?? ""}`}>{words.rich("start.title")}</h2>
      <ol className={styles["steps"]} data-agent-clear="">
        {steps.map((step, index) => (
          <li key={step.name} className={styles["step"]} style={{ "--o": 0.22 + index * 0.075 }}>
            <span className={styles["dot"]}>{index + 1}</span>
            <div>
              <h3>{words.text(step.name)}</h3>
              <p className="mute">{words.text(step.line)}</p>
              <Sample step={step} words={words} />
            </div>
          </li>
        ))}
      </ol>
    </Scene>
  );
}
