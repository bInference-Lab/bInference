import type { Words } from "../words/words";
import styles from "./hero-facts.module.css";

// The Apple mark for macOS, from a CC0 set of brand icons, as the README shows it.
const appleMark =
  "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701";

function MacIcon(): React.JSX.Element {
  return (
    <svg className={styles["solid"]} viewBox="0 0 24 24" aria-hidden="true">
      <path d={appleMark} />
    </svg>
  );
}

function SourceIcon(): React.JSX.Element {
  return (
    <svg className={styles["line"]} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15" />
    </svg>
  );
}

function FeesIcon(): React.JSX.Element {
  return (
    <svg className={styles["line"]} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M14.6 9.6c-.5-.8-1.5-1.3-2.6-1.3-1.5 0-2.6.8-2.6 1.9 0 2.6 5.3 1.4 5.3 4 0 1.1-1.2 2-2.7 2-1.2 0-2.2-.5-2.7-1.4M5.5 18.5l13-13" />
    </svg>
  );
}

function TalkIcon(): React.JSX.Element {
  return (
    <svg className={styles["line"]} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-4.5 3.5v-3.5h-.5a2 2 0 0 1-2-2z" />
      <path d="M8.5 10.5h7M8.5 13h4" />
    </svg>
  );
}

function Fact(props: {
  readonly icon: React.JSX.Element;
  readonly label: string;
  readonly note: string;
}): React.JSX.Element {
  return (
    <li className={styles["fact"]}>
      {props.icon}
      <span>
        <b>{props.label}</b>
        <small>{props.note}</small>
      </span>
    </li>
  );
}

/**
 * The facts under the install command, each a fine icon beside a label and a quiet note: where
 * it runs, that it is open source, that it charges nothing, and the demo to try first.
 */
export function HeroFacts(props: { readonly words: Words }): React.JSX.Element {
  const { words } = props;
  return (
    <ul className={styles["facts"]}>
      <Fact icon={<MacIcon />} label={words.text("fact.mac")} note={words.text("fact.macNote")} />
      <Fact
        icon={<SourceIcon />}
        label={words.text("fact.open")}
        note={words.text("fact.openNote")}
      />
      <Fact
        icon={<FeesIcon />}
        label={words.text("fact.fees")}
        note={words.text("fact.feesNote")}
      />
      <li className={`${styles["fact"] ?? ""} ${styles["talk"] ?? ""}`}>
        <a href="#play">
          <TalkIcon />
          <span>
            <b>{words.text("hero.talk")}</b>
            <small>{words.text("fact.talkNote")}</small>
          </span>
        </a>
      </li>
    </ul>
  );
}
