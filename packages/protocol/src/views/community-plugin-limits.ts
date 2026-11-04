/**
 * How much a community plugin may declare, and how many may be installed (decision 0348). Small
 * enough that a permission review fits the terminal whole, one line per entry, so the owner never
 * consents to an entry the review did not show. The manifest schema, the review, the runtime's
 * settings and the install all read these.
 */
export const communityPluginLimits = {
  /** Installed plugins, on or off. */
  installed: 64,
  hosts: 16,
  /** Characters of one declared host. */
  hostLength: 100,
  tools: 32,
  /** Characters of one tool's name, as its manifest names it. */
  toolNameLength: 64,
  /** Top-level keys of its config schema. */
  configKeys: 64,
  /** Characters of one config key. */
  configKeyLength: 64,
} as const;
