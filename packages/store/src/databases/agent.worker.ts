// The agent database's store worker entry: every agent.sqlite connection lives on one of these.
import { serveDatabase } from "../worker/serve-database.worker.js";
import { agentDatabase } from "./agent-database.js";

serveDatabase(agentDatabase);
