import type { Words } from "../words/words";
import styles from "./site-footer.module.css";

/** The last line: the risk, and who makes it. */
export function SiteFooter(props: { readonly words: Words }): React.JSX.Element {
  return (
    <footer className={styles["footer"]}>
      <div className={`wide ${styles["row"] ?? ""}`}>
        <span>{props.words.text("footer.risk")}</span>
        <span>{props.words.text("footer.maker")}</span>
      </div>
    </footer>
  );
}
