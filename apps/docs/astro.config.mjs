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

function group(key, directory) {
  return {
    label: en[key],
    translations: { "zh-CN": zh[key] },
    items: [{ autogenerate: { directory } }],
  };
}

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
      sidebar: [group("site.guides", "guides"), group("site.reference", "reference")],
    }),
  ],
});
