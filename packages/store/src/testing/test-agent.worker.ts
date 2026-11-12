// The agent database's store worker entry for store tests, with their row tasks.
import { serveDatabase } from "../worker/serve-database.worker.js";
import { testAgentDatabase } from "./test-agent-database.js";

serveDatabase(testAgentDatabase);
