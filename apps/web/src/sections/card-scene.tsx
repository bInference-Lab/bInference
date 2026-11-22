import { AgentSlot } from "../agent/agent-slot";
import { Scene } from "../motion/scene";
import type { Words, WordKey } from "../words/words";
import styles from "./card-scene.module.css";

const says: readonly { readonly key: WordKey; readonly from: number; readonly to: number }[] = [
  { key: "card.say1", from: -1, to: 0.17 },
  { key: "card.say2", from: 0.19, to: 0.5 },
  { key: "card.say3", from: 0.52, to: 0.66 },
  { key: "card.say4", from: 0.7, to: 2 },
];

const rows: readonly { readonly label: WordKey; readonly value: WordKey; readonly at: number }[] = [
  { label: "card.token", value: "card.tokenValue", at: 0.2 },
  { label: "card.gets", value: "card.getsValue", at: 0.27 },
  { label: "card.route", value: "card.routeValue", at: 0.34 },
  { label: "card.fees", value: "card.feesValue", at: 0.41 },
];

function Tick(): React.JSX.Element {
  return (
    <svg className={styles["tick"]} viewBox="0 0 20 20" aria-hidden="true">
      <path pathLength={1} d="M4 10.5l4 4 8-9" />
    </svg>
  );
}

function Front(props: { readonly words: Words }): React.JSX.Element {
  const { words } = props;
  return (
    <div className={`${styles["face"] ?? ""} ${styles["front"] ?? ""}`}>
      <div className={styles["head"]}>
        <i />
        {words.text("card.head")}
      </div>
      <div className={styles["action"]}>{words.text("card.action")}</div>
      <div className={styles["rows"]}>
        {rows.map((row) => (
          <div key={row.label} className={styles["row"]} style={{ "--o": row.at }}>
            <Tick />
            <span>{words.text(row.label)}</span>
            <span>{words.text(row.value)}</span>
          </div>
        ))}
      </div>
      <div className={styles["keys"]}>
        <span className={styles["yes"]} data-agent-target="card-confirm">
          {words.text("card.confirm")}
        </span>
        <span>{words.text("card.cancel")}</span>
        <i className={styles["ring"]} />
      </div>
    </div>
  );
}

function Back(props: { readonly words: Words }): React.JSX.Element {
  const { words } = props;
  return (
    <div className={`${styles["face"] ?? ""} ${styles["back"] ?? ""}`}>
      <svg className={styles["done"]} viewBox="0 0 80 80" aria-hidden="true">
        <circle cx="40" cy="40" r="36" pathLength={1} />
        <path pathLength={1} d="M25 41l10 10 20-22" />
      </svg>
      <p className={styles["big"]}>{words.text("card.result")}</p>
      <p className="mute">{words.text("card.resultLine")}</p>
      <span className="more">{words.text("card.explorer")}</span>
    </div>
  );
}

/** Every trade as one card: it rises, ticks its checks, takes the tap and turns into its receipt. */
export function CardScene(props: { readonly words: Words }): React.JSX.Element {
  const { words } = props;
  return (
    <Scene mode="pinned" className={styles["scene"]}>
      <div className={styles["stage"]}>
        <AgentSlot
          className={styles["slot"]}
          mode="wait"
          look="card-confirm"
          label={words.text("status.card")}
        />
        <div className={styles["says"]}>
          {says.map((say) => (
            <p key={say.key} className={styles["say"]} style={{ "--a": say.from, "--b": say.to }}>
              {words.rich(say.key)}
            </p>
          ))}
        </div>
        <div className={styles["flip"]}>
          <Front words={words} />
          <Back words={words} />
        </div>
      </div>
    </Scene>
  );
}
