import { sourceUrl } from "../landing/source-url";
import type { Words } from "../words/words";
import styles from "./site-footer.module.css";

/** The last line: the risk, where the source lives, and who makes it. */
export function SiteFooter(props: { readonly words: Words }): React.JSX.Element {
  return (
    <footer className={styles["footer"]}>
      <div className={`wide ${styles["row"] ?? ""}`}>
        <span>{props.words.text("footer.risk")}</span>
        <span className={styles["end"]}>
          <a href={sourceUrl}>{props.words.text("footer.source")}</a>
          <span>{props.words.text("footer.maker")}</span>
        </span>
      </div>
    </footer>
  );
}
