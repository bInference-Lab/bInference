import { readFileSync } from "node:fs";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

// The site's own words live with every other word binference shows, in English and Chinese.
function words(locale) {
  const file = new URL(`../../packages/i18n/messages/${locale}/docs.json`, import.meta.url);
  return JSON.parse(readFileSync(file, "utf8"));
}

const en = words("en");
const zh = words("zh");

function group(key, items) {
  return { label: en[key], translations: { "zh-CN": zh[key] }, items };
}

// The guides by group, each by its slug: Starlight shows each page's title in the reader's
// language.
const start = ["guides/install", "guides/docker-vps"];
const features = [
  "guides/safety",
  "guides/auto-orders",
  "guides/staking",
  "guides/sends-and-bridges",
  "guides/names-and-identity",
  "guides/remote-and-webhooks",
];

// English sits at the content root and Chinese under zh-cn/, so every page has its twin at the
// same path (check:docs).
export default defineConfig({
  site: "https://binference.io",
  integrations: [
    starlight({
      title: "binference",
      defaultLocale: "root",
      locales: {
        root: { label: en["site.language"], lang: "en" },
        "zh-cn": { label: zh["site.language"], lang: "zh-CN" },
      },
      sidebar: [
        group("site.start", start),
        group("site.features", features),
        group("site.reference", [{ autogenerate: { directory: "reference" } }]),
      ],
    }),
  ],
});
