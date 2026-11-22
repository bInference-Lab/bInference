import { Tally } from "./tally";
import styles from "./site-nav.module.css";

/** The navigation's words and links. */
export interface SiteNavProps {
  readonly links: readonly { readonly href: string; readonly label: string }[];
  readonly start: string;
  readonly other: { readonly href: string; readonly label: string; readonly lang: string };
  readonly tally: { readonly taps: string; readonly moved: string };
}

/** The thin bar at the top: the lockup, the tap counter, the sections and the other language. */
export function SiteNav(props: SiteNavProps): React.JSX.Element {
  return (
    <header className={styles["nav"]}>
      <div className={`wide ${styles["row"] ?? ""}`}>
        <a href="#top" className={styles["brand"]} aria-label="bInference">
          <img src="/lockup.svg" alt="" width={90} height={20} />
        </a>
        <Tally words={props.tally} />
        <nav className={styles["links"]}>
          {props.links.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
          <a href={props.other.href} hrefLang={props.other.lang} lang={props.other.lang}>
            {props.other.label}
          </a>
          <a className="btn btn-sm" href="#install">
            {props.start}
          </a>
        </nav>
      </div>
    </header>
  );
}
