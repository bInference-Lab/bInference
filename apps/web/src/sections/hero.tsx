import { AgentSlot } from "../agent/agent-slot";
import { Reveal } from "../motion/reveal";
import type { Words } from "../words/words";
import styles from "./hero.module.css";

/** The first screen: the agent, awake, and what it is. */
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
      <div className={styles["ctas"]}>
        <a className="btn" href="#install">
          {words.text("hero.home")}
        </a>
        <a className="more" href="#play">
          {words.text("hero.talk")}
        </a>
      </div>
    </section>
  );
}
