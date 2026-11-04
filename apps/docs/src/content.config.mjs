import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";

/** The site's one collection: every page under src/content/docs, in each language. */
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
