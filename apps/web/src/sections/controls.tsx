import { AgentSlot } from "../agent/agent-slot";
import type { Words } from "../words/words";
import { FreezeTile } from "./freeze-tile";
import { LimitTile } from "./limit-tile";
import { ModeTile } from "./mode-tile";
import styles from "./controls.module.css";

function RescueIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5 5 6v5.5c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6z" />
      <path d="M12 8.5v7M9 12.5l3 3 3-3" />
    </svg>
  );
}

function RescueTile(props: { readonly words: Words }): React.JSX.Element {
  const { words } = props;
  return (
    <div className={`${styles["tile"] ?? ""} ${styles["rescue"] ?? ""}`}>
      <span className={styles["pill"]}>
        <RescueIcon />
        {words.text("rules.rescue")}
      </span>
      <p className={styles["note"]}>{words.text("rules.rescueNote")}</p>
      <p className={styles["command"]}>/rescue</p>
    </div>
  );
}

function PaperTile(props: { readonly words: Words }): React.JSX.Element {
  const { words } = props;
  return (
    <div className={`${styles["tile"] ?? ""} ${styles["paper"] ?? ""}`}>
      <div className={styles["stage"]} data-on="">
        <h3>
          <i />
          {words.text("rules.paper")}
        </h3>
        <p className={styles["note"]}>{words.text("rules.paperNote")}</p>
      </div>
      <span className={styles["arrow"]} aria-hidden="true" />
      <div className={styles["stage"]}>
        <h3>
          <i />
          {words.text("rules.live")}
        </h3>
        <p className={styles["note"]}>{words.text("rules.liveNote")}</p>
        <p className={styles["command"]}>binference live</p>
      </div>
    </div>
  );
}

function Deck(props: { readonly words: Words }): React.JSX.Element {
  const { words } = props;
  return (
    <div className={styles["deck"]} data-agent-clear="">
      <ModeTile
        words={{
          title: words.text("rules.mode"),
          manual: words.text("rules.manual"),
          auto: words.text("rules.auto"),
          manualNote: words.text("rules.manualNote"),
          autoNote: words.text("rules.autoNote"),
          asks: words.text("rules.asks"),
          runs: words.text("rules.runs"),
          rows: [
            { text: words.text("rules.buy"), runsInAuto: true },
            { text: words.text("rules.stake"), runsInAuto: true },
            { text: words.text("rules.send"), runsInAuto: false },
            { text: words.text("rules.bridge"), runsInAuto: false },
            { text: words.text("rules.unverified"), runsInAuto: false },
          ],
        }}
      />
      <LimitTile
        words={{
          title: words.text("rules.limits"),
          perTrade: words.text("rules.perTrade"),
          perDay: words.text("rules.perDay"),
          drag: words.text("rules.drag"),
          tighter: words.text("rules.tighter"),
          looser: words.text("rules.looser"),
          later: words.text("rules.later"),
        }}
      />
      <FreezeTile
        words={{
          title: words.text("rules.freeze"),
          note: words.text("rules.freezeNote"),
          frozenNote: words.text("rules.frozenNote"),
          unfreeze: words.text("rules.unfreeze"),
          frozen: words.text("status.frozen"),
        }}
      />
      <RescueTile words={words} />
      <PaperTile words={words} />
    </div>
  );
}

/**
 * The owner's controls as a deck the reader can work: manual or auto mode, the two caps, the
 * brake, the rescue, and paper before live.
 */
export function Controls(props: { readonly words: Words }): React.JSX.Element {
  const { words } = props;
  return (
    <section className={`wide ${styles["controls"] ?? ""}`} id="rules">
      <header className={styles["head"]}>
        <div>
          <h2 className="t-l thin">{words.rich("rules.title")}</h2>
          <p className={`t-lead mute ${styles["sub"] ?? ""}`}>{words.text("rules.sub")}</p>
        </div>
        <AgentSlot className={styles["slot"]} label={words.text("status.rules")} />
      </header>
      <Deck words={words} />
    </section>
  );
}
