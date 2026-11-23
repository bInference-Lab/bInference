import type { Words } from "../words/words";
import styles from "./channel-screens.module.css";

/** When a surface shows the card, and when it shows it confirmed, as points of `--p`. */
export interface CardMoments {
  readonly shown: number;
  readonly done: number;
}

const never = 2;

function Check(): React.JSX.Element {
  return (
    <svg className={styles["check"]} viewBox="0 0 20 20" aria-hidden="true">
      <path pathLength={1} d="M4 10.5l4 4 8-9" />
    </svg>
  );
}

function TradeCard(props: {
  readonly words: Words;
  readonly at: CardMoments;
  readonly press?: number;
  readonly target?: string;
}): React.JSX.Element {
  const { words, at } = props;
  return (
    <div
      className={styles["card"]}
      style={{ "--shown": at.shown, "--done": at.done, "--press": props.press ?? never }}
    >
      <div className={styles["ask"]}>
        <p className={styles["cardHead"]}>
          <i />
          {words.text("card.head")}
        </p>
        <p className={styles["cardLine"]}>{words.text("channels.cardLine")}</p>
        <p className={styles["keys"]}>
          <span className={styles["yes"]} data-agent-target={props.target}>
            {words.text("card.confirm")}
          </span>
          <span>{words.text("card.cancel")}</span>
          <i className={styles["ring"]} />
        </p>
      </div>
      <p className={styles["ok"]}>
        <Check />
        <span>
          <b>{words.text("channels.confirmed")}</b>
          {words.text("card.result")}
        </span>
      </p>
    </div>
  );
}

// The short state a small window shows on a phone, where its full screen does not fit.
function Status(props: { readonly words: Words; readonly at: CardMoments }): React.JSX.Element {
  const { words, at } = props;
  return (
    <p className={styles["status"]} style={{ "--shown": at.shown, "--done": at.done }}>
      <span className={styles["waits"]}>
        <i />
        {words.text("channels.waiting")}
      </span>
      <span className={styles["did"]}>
        <Check />
        {words.text("channels.confirmed")}
      </span>
    </p>
  );
}

function Bar(props: { readonly title: string }): React.JSX.Element {
  return (
    <p className={styles["bar"]}>
      <i />
      <i />
      <i />
      <span>{props.title}</span>
    </p>
  );
}

/** Telegram on a phone: the owner asks, the agent answers with the card, and the owner taps it. */
export function PhoneScreen(props: {
  readonly words: Words;
  readonly at: CardMoments;
}): React.JSX.Element {
  const { words, at } = props;
  return (
    <div className={styles["phone"]}>
      <p className={styles["chatHead"]}>
        <i className={styles["avatar"]} />
        <span>
          <b>{words.text("channels.botName")}</b>
          <small>{words.text("channels.botNote")}</small>
        </span>
      </p>
      <div className={styles["messages"]}>
        <p className={`${styles["bubble"] ?? ""} ${styles["mine"] ?? ""}`} style={{ "--a": 0.27 }}>
          {words.text("play.buy")}
        </p>
        <p className={styles["typing"]} style={{ "--a": 0.3, "--b": 0.34 }}>
          <i />
          <i />
          <i />
        </p>
        <p className={styles["bubble"]} style={{ "--a": 0.34 }}>
          {words.text("channels.reply")}
        </p>
        <TradeCard words={words} at={at} press={at.done - 0.03} target="channels-confirm" />
      </div>
      <p className={styles["compose"]}>{words.text("channels.message")}</p>
    </div>
  );
}

/** The web console in a browser window: the same card arrives in its list of cards. */
export function ConsoleScreen(props: {
  readonly words: Words;
  readonly at: CardMoments;
}): React.JSX.Element {
  const { words, at } = props;
  return (
    <div className={styles["window"]}>
      <Bar title={words.text("channels.consoleBar")} />
      <div className={styles["body"]}>
        <p className={styles["idle"]} style={{ "--b": at.shown }}>
          {words.text("channels.consoleIdle")}
        </p>
        <TradeCard words={words} at={at} />
      </div>
      <Status words={words} at={at} />
    </div>
  );
}

// A window of text, as the terminal and an MCP client draw: its lines, then the confirmed line.
function TextWindow(props: {
  readonly words: Words;
  readonly at: CardMoments;
  readonly title: string;
  readonly className?: string | undefined;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const { words, at } = props;
  return (
    <div className={[styles["window"], styles["mono"], props.className].join(" ")}>
      <Bar title={props.title} />
      <div className={styles["body"]} style={{ "--shown": at.shown, "--done": at.done }}>
        {props.children}
        <p className={styles["line"]}>
          <Check />
          {words.text("channels.confirmed")} · {words.text("card.result")}
        </p>
      </div>
      <Status words={words} at={at} />
    </div>
  );
}

/** The terminal chat: the card drawn in text, answered with a key. */
export function TerminalScreen(props: {
  readonly words: Words;
  readonly at: CardMoments;
}): React.JSX.Element {
  const { words } = props;
  return (
    <TextWindow words={words} at={props.at} title="zsh">
      <p>
        <span className={styles["prompt"]}>~ %</span> binference chat
      </p>
      <p className={styles["reply"]}>{words.text("channels.reply")}</p>
      <div className={styles["box"]}>
        <p className={styles["boxHead"]}>{words.text("card.head")}</p>
        <p>{words.text("channels.cardLine")}</p>
        <p className={styles["dim"]}>{words.text("channels.terminalKeys")}</p>
      </div>
    </TextWindow>
  );
}

/** An MCP client, here Claude Code, reading the card it cannot answer for the owner. */
export function McpScreen(props: {
  readonly words: Words;
  readonly at: CardMoments;
}): React.JSX.Element {
  const { words } = props;
  return (
    <TextWindow
      words={words}
      at={props.at}
      title={words.text("channels.mcpBar")}
      className={styles["mcp"]}
    >
      <p className={styles["call"]}>
        <i />
        binference_intents
      </p>
      <p className={styles["reply"]}>{words.text("channels.mcpWait")}</p>
    </TextWindow>
  );
}
