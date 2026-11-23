import type { ReactNode } from "react";
import { sansVariable } from "../fonts";
import "../app/globals.css";

/** The page around a language: its `lang` and the brand font. */
export function SiteDocument(props: {
  readonly lang: string;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <html lang={props.lang} className={sansVariable}>
      <body>{props.children}</body>
    </html>
  );
}
