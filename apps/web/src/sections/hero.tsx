import { AgentSlot } from "../agent/agent-slot";
import { Reveal } from "../motion/reveal";
import type { Words } from "../words/words";
import { InstallTerminal } from "./install-terminal";
import styles from "./hero.module.css";

/** The first screen: the agent, awake, what it is, and the command that installs it. */
export function Hero(props: { readonly words: Words }): React.JSX.Element {
  const { words } = props;
  return (
    <section className={`wrap ${styles["hero"] ?? ""}`} id="top">
      <p className={`${styles["eyebrow"] ?? ""} mute`}>{words.text("hero.eyebrow")}</p>
      <AgentSlot className={styles["slot"]} label={words.text("status.watching")} />
      <Reveal tag="h1" wordsOnly className={styles["title"]}>
        {words.split("hero.title")}
      </Reveal>
      <p className={`t-lead mute ${styles["lead"] ?? ""}`}>{words.text("hero.lead")}</p>
      <div className={styles["start"]} data-agent-clear="">
        <InstallTerminal
          words={{
            copy: words.text("install.copy"),
            hint: words.text("install.hint"),
            copied: words.rich("install.copied"),
            status: words.text("status.copied"),
          }}
        />
        <p className={styles["after"]}>
          <span className="mute">{words.text("install.meta")}</span>
          <a className="more" href="#play">
            {words.text("hero.talk")}
          </a>
        </p>
      </div>
    </section>
  );
}
