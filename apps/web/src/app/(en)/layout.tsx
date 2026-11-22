import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMetadata } from "../../landing/page-metadata";
import { SiteDocument } from "../../landing/site-document";

/** The English page's title and description. */
export const metadata: Metadata = pageMetadata("en");

/** The English site's root layout. */
export default function EnglishLayout(props: { readonly children: ReactNode }): React.JSX.Element {
  return <SiteDocument lang="en">{props.children}</SiteDocument>;
}
