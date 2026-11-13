import type { ListingKeys } from "./listing-keys.js";
import type { PluginListingCatalog } from "./ports.js";

/**
 * Whether a plugin needs a plugin listing (decision 0433), a profile part only a composition root
 * sets: `notRequired`, installs as decisions 0348 to 0351 have them; or `required`, every install,
 * enable, update and start needs a listing that verifies with one of `keys` and that the newest
 * revocation list does not name, read from `catalog`. No config key or operation changes it.
 */
export type PluginListingRule =
  | { readonly kind: "notRequired" }
  | {
      readonly kind: "required";
      readonly keys: ListingKeys;
      readonly catalog: PluginListingCatalog;
    };
