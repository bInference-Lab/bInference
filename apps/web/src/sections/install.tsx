import { AgentSlot } from "../agent/agent-slot";
import { Reveal } from "../motion/reveal";
import type { Words } from "../words/words";
import { CopyButton } from "./copy-button";
import styles from "./install.module.css";

// The command breaks after the host on a narrow phone, never inside the file name.
const commandParts = ["curl -fsSL https://binference.io/", "install.sh | sh"] as const;
const installCommand = commandParts.join("");

/** Take me home: the agent waits beside the install command. */
export function Install(props: { readonly words: Words }): React.JSX.Element {
  const { words } = props;
  return (
    <section className={styles["install"]} id="install">
      <AgentSlot className={styles["slot"]} look="install-copy" label={words.text("status.home")} />
      <Reveal tag="h2" wordsOnly className={styles["title"]}>
        {words.split("install.title")}
      </Reveal>
      <Reveal className={styles["command"]} order={2}>
        <code>
          <b>$</b> {commandParts[0]}
          <wbr />
          {commandParts[1]}
        </code>
        <CopyButton
          text={installCommand}
          label={words.text("install.copy")}
          done={words.text("install.copied")}
        />
      </Reveal>
      <Reveal tag="p" className={styles["meta"]} order={3}>
        {words.text("install.meta")}
      </Reveal>
    </section>
  );
}
