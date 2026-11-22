import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMetadata } from "../../landing/page-metadata";
import { SiteDocument } from "../../landing/site-document";

/** The Chinese page's title and description. */
export const metadata: Metadata = pageMetadata("zh");

/** The Chinese site's root layout. */
export default function ChineseLayout(props: { readonly children: ReactNode }): React.JSX.Element {
  return <SiteDocument lang="zh-Hans">{props.children}</SiteDocument>;
}
