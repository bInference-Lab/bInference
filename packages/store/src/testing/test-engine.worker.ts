// The engine database's store worker entry for store tests, with their planting tasks.
import { serveDatabase } from "../worker/serve-database.worker.js";
import { testEngineDatabase } from "./test-engine-database.js";

serveDatabase(testEngineDatabase);
