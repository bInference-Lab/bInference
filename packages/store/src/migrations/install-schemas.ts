import type { Id } from "@binference/core";

/** The two Postgres schemas that hold one install's engine and agent tables. */
export interface InstallSchemas {
  readonly engine: string;
  readonly agent: string;
}

/**
 * The schemas of an install (database spec, section 6.2): `engine_<digits>` and `agent_<digits>`,
 * where the digits are the 32 lowercase hex digits of its `ins_` id.
 */
export function installSchemas(installId: Id<"ins">): InstallSchemas {
  const digits = installId.slice("ins_".length).replaceAll("-", "");
  return { engine: `engine_${digits}`, agent: `agent_${digits}` };
}
