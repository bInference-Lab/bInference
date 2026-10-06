// The probe database's store worker entry, for the store's own tests.
import { serveDatabase } from "../worker/serve-database.worker.js";
import { probeDatabase } from "./probe-database.js";

serveDatabase(probeDatabase);
