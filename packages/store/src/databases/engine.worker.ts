// The engine database's store worker entry: every engine.sqlite connection lives on one of these.
import { serveDatabase } from "../worker/serve-database.worker.js";
import { engineDatabase } from "./engine-database.js";

serveDatabase(engineDatabase);
