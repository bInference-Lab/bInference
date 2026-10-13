import { err, ok, type Result } from "@binference/core";
import { parse } from "yaml";
import { z } from "zod";

/** The frontmatter fields binference reads, as the Agent Skills format defines them. */
export interface SkillFields {
  readonly name: string;
  readonly description: string;
  readonly license?: string;
  readonly compatibility?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly "allowed-tools"?: string;
}

/** A skill's name in the Agent Skills format: lowercase letters, digits and single hyphens. */
const skillNamePattern: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// The format's fields (agentskills.io/specification); any other key is left out.
const fieldsSchema: z.ZodType<SkillFields> = z.object({
  name: z.string().max(64).regex(skillNamePattern),
  description: z.string().trim().min(1).max(1024),
  license: z.string().exactOptional(),
  compatibility: z.string().min(1).max(500).exactOptional(),
  metadata: z.record(z.string(), z.string()).exactOptional(),
  "allowed-tools": z.string().exactOptional(),
});

function yamlOf(block: string): Result<unknown, "bad_yaml"> {
  try {
    // Aliases are capped and merge keys off, so a small file cannot expand into a large one.
    return ok(parse(block, { schema: "core", maxAliasCount: 16, merge: false, uniqueKeys: true }));
  } catch {
    return err("bad_yaml");
  }
}

/**
 * Reads a frontmatter block with `yaml` (the core schema, unique keys, at most 16 aliases, no
 * merge keys) and checks its fields with zod. YAML that does not parse is `bad_yaml`; a field
 * that breaks the format is `bad_fields`.
 */
export function readSkillFields(block: string): Result<SkillFields, "bad_yaml" | "bad_fields"> {
  const yaml = yamlOf(block);
  if (!yaml.ok) {
    return yaml;
  }
  const fields = fieldsSchema.safeParse(yaml.value);
  return fields.success ? ok(fields.data) : err("bad_fields");
}
