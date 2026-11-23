import { AgentSlot } from "../agent/agent-slot";
import { Reveal } from "../motion/reveal";
import type { Words } from "../words/words";
import { HeroFacts } from "./hero-facts";
import { InstallTerminal } from "./install-terminal";
import styles from "./hero.module.css";

/** The first screen: the agent, awake, what it is, and the command that installs it. */
export function Hero(props: { readonly words: Words }): React.JSX.Element {
  const { words } = props;
  return (
    <section className={`wrap ${styles["hero"] ?? ""}`} id="top">
      <AgentSlot className={styles["slot"]} label={words.text("status.watching")} />
      <p className={styles["eyebrow"]}>{words.text("hero.eyebrow")}</p>
      <Reveal tag="h1" wordsOnly className={styles["title"]}>
        {words.split("hero.title")}
      </Reveal>
      <div className={styles["lead"]}>
        <p className={styles["verbs"]}>{words.text("hero.verbs")}</p>
        <p className={`${styles["line"] ?? ""} mute`}>
          <span>{words.text("hero.where")}</span>
          <span>{words.text("hero.tap")}</span>
        </p>
      </div>
      <div className={styles["start"]} data-agent-clear="">
        <InstallTerminal
          words={{
            copy: words.text("install.copy"),
            hint: words.text("install.hint"),
            copied: words.rich("install.copied"),
            status: words.text("status.copied"),
          }}
        />
        <HeroFacts words={words} />
      </div>
    </section>
  );
}
