import type { MetadataRoute } from "next";
import { siteUrl } from "../landing/site-url";

/** The two pages, each naming the other as its other language. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const languages = { en: new URL("/", base).href, "zh-Hans": new URL("/zh", base).href };
  return [
    { url: languages.en, alternates: { languages } },
    { url: languages["zh-Hans"], alternates: { languages } },
  ];
}
