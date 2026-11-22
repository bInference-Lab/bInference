import type { Metadata } from "next";
import { type Locale, wordsFor } from "../words/words";

/** The title and description of the page in `locale`, with the other language as its alternate. */
export function pageMetadata(locale: Locale): Metadata {
  const words = wordsFor(locale);
  return {
    title: words.text("meta.title"),
    description: words.text("meta.description"),
    alternates: { languages: { en: "/", "zh-Hans": "/zh" } },
    openGraph: {
      title: words.text("meta.title"),
      description: words.text("meta.description"),
      type: "website",
    },
  };
}
