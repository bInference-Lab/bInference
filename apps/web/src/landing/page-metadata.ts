import type { Metadata } from "next";
import { type Locale, wordsFor } from "../words/words";
import { siteUrl } from "./site-url";

/** The title and description of the page in `locale`, with the other language as its alternate. */
export function pageMetadata(locale: Locale): Metadata {
  const words = wordsFor(locale);
  const title = words.text("meta.title");
  const description = words.text("meta.description");
  return {
    metadataBase: siteUrl(),
    title,
    description,
    alternates: {
      canonical: locale === "en" ? "/" : "/zh",
      languages: { en: "/", "zh-Hans": "/zh", "x-default": "/" },
    },
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "bInference",
      locale: locale === "en" ? "en_US" : "zh_CN",
      alternateLocale: locale === "en" ? "zh_CN" : "en_US",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}
