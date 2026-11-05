import type { PostgresMigration } from "../postgres-migration.js";
import { migration as agentLeases } from "./0001_agent_leases.js";

/** The shared schema's migrations, oldest first. Released files never change. */
export const sharedPostgresMigrations: readonly PostgresMigration[] = [agentLeases];
