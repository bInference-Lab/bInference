import { renderConfigReference } from "binference";
import type { ReferencePage } from "./reference-page.mjs";

/** The reference of every config key, from the config schema. */
export const configPage: ReferencePage = {
  name: "config",
  file: "config",
  render: renderConfigReference,
};
