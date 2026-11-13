import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";

/**
 * The plugin listing a plugin installs under where the engine needs one, by its id and version
 * (decision 0433): the listing catalog reviewed and signed this package version.
 */
export interface PluginListingRef {
  readonly listing: ProtocolId<"pluginListing">;
  readonly version: number;
}

/**
 * Where an installed plugin stands with its listing, where the engine needs one (decision 0433):
 * listed, revoked and off for good, held while its listing cannot be checked, or holding no
 * listing, so it never runs. The listing's id and version are absent only for the last.
 */
export interface PluginListingView {
  readonly listing?: ProtocolId<"pluginListing">;
  readonly version?: number;
  readonly state: "listed" | "revoked" | "held" | "unlisted";
}

const listingVersion = z.int().positive();

/** Parses a {@link PluginListingRef}. */
export const pluginListingRefSchema: z.ZodType<PluginListingRef> = z.object({
  listing: protocolIdSchema("pluginListing"),
  version: listingVersion,
});

/** Parses a {@link PluginListingView}. */
export const pluginListingViewSchema: z.ZodType<PluginListingView> = z.object({
  listing: protocolIdSchema("pluginListing").exactOptional(),
  version: listingVersion.exactOptional(),
  state: z.enum(["listed", "revoked", "held", "unlisted"]),
});
