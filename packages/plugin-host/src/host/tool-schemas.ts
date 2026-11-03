import type { CommunityManifest } from "@binference/plugin-sdk/community";
import { z } from "zod";

/** A tool's input and output schemas, read once from its manifest. */
export interface ToolSchemas {
  readonly input: z.ZodType;
  readonly output: z.ZodType;
}

/** Each declared tool's schemas by name, read with zod from the manifest's JSON Schemas. */
export function toolSchemasOf(manifest: CommunityManifest): ReadonlyMap<string, ToolSchemas> {
  return new Map(
    manifest.tools.map((tool) => [
      tool.name,
      { input: z.fromJSONSchema(tool.input), output: z.fromJSONSchema(tool.output) },
    ]),
  );
}

/** Whether a plugin's `ready` names exactly the tools its manifest declares. */
export function sameTools(manifest: CommunityManifest, ready: readonly string[]): boolean {
  const declared = new Set(manifest.tools.map(({ name }) => name));
  return ready.length === declared.size && ready.every((name) => declared.has(name));
}
