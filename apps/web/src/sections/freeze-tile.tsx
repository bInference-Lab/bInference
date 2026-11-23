"use client";

import { useState } from "react";
import { useAgent } from "../agent/agent-context";
import styles from "./controls.module.css";

/** The words of the freeze tile. */
export interface FreezeWords {
  readonly title: string;
  readonly note: string;
  readonly frozenNote: string;
  readonly unfreeze: string;
  /** The status pill's words while the agent is frozen. */
  readonly frozen: string;
}

function Flake(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5M9.5 4.5 12 6.5l2.5-2M9.5 19.5 12 17.5l2.5 2M4.6 10.3l3 .5-1 2.9M19.4 13.7l-3-.5 1-2.9M4.6 13.7l3-.5-1-2.9M19.4 10.3l-3 .5 1 2.9" />
    </svg>
  );
}

/**
 * The brake: pressing it freezes the agent on the page, as `/freeze` stops every agent, and the
 * tile says how the owner unfreezes.
 */
export function FreezeTile(props: { readonly words: FreezeWords }): React.JSX.Element {
  const { words } = props;
  const bus = useAgent();
  const [frozen, setFrozen] = useState(false);
  const press = (): void => {
    bus.tap();
    bus.order(frozen ? undefined : { mode: "frozen", label: words.frozen });
    setFrozen(!frozen);
  };
  return (
    <div className={`${styles["tile"] ?? ""} ${styles["freeze"] ?? ""}`} data-frozen={frozen}>
      <button type="button" className={styles["brake"]} aria-pressed={frozen} onClick={press}>
        <Flake />
        <span>{frozen ? words.unfreeze : words.title}</span>
      </button>
      <p className={styles["note"]} aria-live="polite">
        {frozen ? words.frozenNote : words.note}
      </p>
      <p className={styles["command"]}>/freeze</p>
    </div>
  );
}
