import type { ReactNode } from "react";
import { sansVariable } from "../fonts";
import "../app/globals.css";

/** The page around a language: its `lang`, the brand font, and the page closed until the tap. */
export function SiteDocument(props: {
  readonly lang: string;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <html lang={props.lang} className={sansVariable}>
      <body className="gated">
        <noscript>
          <style>
            {"body.gated{overflow:auto;height:auto}[data-gate]{display:none!important}"}
          </style>
        </noscript>
        {props.children}
      </body>
    </html>
  );
}
