import { AgentSlot } from "../agent/agent-slot";
import { Scene } from "../motion/scene";
import type { Words } from "../words/words";
import {
  type CardMoments,
  ConsoleScreen,
  McpScreen,
  PhoneScreen,
  TerminalScreen,
} from "./channel-screens";
import { ChannelThreads, type ThreadTiming } from "./channel-threads";
import { type SceneLine, SceneLines } from "./scene-lines";
import styles from "./channels.module.css";

const says: readonly SceneLine[] = [
  { key: "channels.say1", from: -1, to: 0.24 },
  { key: "channels.say2", from: 0.27, to: 0.52 },
  { key: "channels.say3", from: 0.55, to: 0.76 },
  { key: "channels.say4", from: 0.79, to: 2 },
];

type Surface = "phone" | "console" | "terminal" | "mcp";

// The story by scroll: the screens rise and the threads draw, the owner asks on the phone, the
// card travels out to every screen, the tap on the phone travels back, and every screen confirms.
const timings: Readonly<Record<Surface, ThreadTiming>> = {
  phone: { draw: 0.04, card: 0.35, back: 0.585, done: 2 },
  console: { draw: 0.07, card: 0.36, back: 2, done: 0.64 },
  terminal: { draw: 0.1, card: 0.37, back: 2, done: 0.65 },
  mcp: { draw: 0.13, card: 0.38, back: 2, done: 0.66 },
};

const moments: Readonly<Record<Surface, CardMoments>> = {
  phone: { shown: 0.43, done: 0.585 },
  console: { shown: 0.44, done: 0.72 },
  terminal: { shown: 0.45, done: 0.73 },
  mcp: { shown: 0.46, done: 0.74 },
};

const screens: Readonly<Record<Surface, typeof PhoneScreen>> = {
  phone: PhoneScreen,
  console: ConsoleScreen,
  terminal: TerminalScreen,
  mcp: McpScreen,
};

const order: readonly Surface[] = ["phone", "console", "terminal", "mcp"];

function SurfaceFigure(props: {
  readonly words: Words;
  readonly surface: Surface;
}): React.JSX.Element {
  const { words, surface } = props;
  const Screen = screens[surface];
  return (
    <figure className={`${styles["surface"] ?? ""} ${styles[surface] ?? ""}`}>
      <div className={styles["frame"]} data-thread={surface}>
        <div className={styles["rise"]} style={{ "--a": timings[surface].draw - 0.02 }}>
          <Screen words={words} at={moments[surface]} />
        </div>
      </div>
      <figcaption className={styles["caption"]}>
        <b>{words.text(`channels.${surface}`)}</b>
        <span>{words.text(`channels.${surface}Note`)}</span>
      </figcaption>
    </figure>
  );
}

/**
 * Where the owner talks to the agent: Telegram, the web console, the terminal and MCP clients,
 * each linked to it by a thread. One card travels out to all of them, the first tap on any one
 * travels back, and every screen shows it confirmed.
 */
export function Channels(props: { readonly words: Words }): React.JSX.Element {
  const { words } = props;
  return (
    <Scene mode="pinned" className={styles["scene"]} id="channels">
      <div className={styles["stage"]}>
        <SceneLines
          words={words}
          lines={says}
          className={styles["says"]}
          lineClassName={styles["say"]}
        />
        <div className={styles["board"]} data-agent-clear="">
          <ChannelThreads timings={timings} />
          <AgentSlot
            className={styles["slot"]}
            mode="wait"
            look="channels-confirm"
            label={words.text("status.everywhere")}
          />
          {order.map((surface) => (
            <SurfaceFigure key={surface} words={words} surface={surface} />
          ))}
        </div>
      </div>
    </Scene>
  );
}
