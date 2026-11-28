// Runs the Next.js command line with its telemetry off, the same way on every OS.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The site serves the install script a release stages, and its sum, so the one-liner the site
// shows installs from the repository's own file (decision 0466). Each run writes them again.
const here = import.meta.dirname;
const script = readFileSync(join(here, "..", "..", "install", "install.sh"));
const sum = createHash("sha256").update(script).digest("hex");
writeFileSync(join(here, "public", "install.sh"), script);
writeFileSync(join(here, "public", "install.sh.sha256"), `${sum}  install.sh\n`);

process.env.NEXT_TELEMETRY_DISABLED = "1";
await import("next/dist/bin/next");
