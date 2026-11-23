import { sourceUrl } from "../landing/source-url";
import { Reveal } from "../motion/reveal";
import type { Words } from "../words/words";
import { ReadingLight } from "./reading-light";
import { readSourceColumns, type SourceColumn } from "./source-files";
import styles from "./source-wall.module.css";

function Wall(props: {
  readonly columns: readonly SourceColumn[];
  readonly lit: boolean;
}): React.JSX.Element {
  return (
    <div
      className={`${styles["wall"] ?? ""} ${props.lit ? (styles["lit"] ?? "") : ""}`}
      data-lit={props.lit ? "" : undefined}
    >
      {props.columns.map((column) => (
        // The text runs twice, so its slow crawl loops without a seam.
        <pre key={column.id}>{`${column.text}\n\n${column.text}\n\n`}</pre>
      ))}
    </div>
  );
}

/** Read me: the engine's real source crawls behind the words, under a light the pointer moves. */
export async function SourceWall(props: { readonly words: Words }): Promise<React.JSX.Element> {
  const columns = await readSourceColumns(AbortSignal.timeout(10_000));
  return (
    <ReadingLight className={styles["readme"]} id="readme">
      <div className={styles["walls"]} aria-hidden="true">
        <Wall columns={columns} lit={false} />
        <Wall columns={columns} lit />
      </div>
      <div className={`wrap ${styles["front"] ?? ""}`}>
        <Reveal tag="h2" wordsOnly className={styles["title"]}>
          {props.words.split("readme.title")}
        </Reveal>
        <Reveal tag="p" className="t-lead mute">
          {props.words.text("readme.text")}
        </Reveal>
        <Reveal tag="p" className={styles["link"]} order={2}>
          <a className="more" href={sourceUrl}>
            {props.words.text("readme.link")}
          </a>
        </Reveal>
      </div>
    </ReadingLight>
  );
}
