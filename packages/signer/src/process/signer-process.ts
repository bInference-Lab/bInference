import process from "node:process";
import { runSigner } from "./run-signer.js";

// The signer's entry and composition root. The engine starts it with `signerNodeArguments` and
// talks to it over its standard input and output only.
const fault = await runSigner({
  permission: process.permission,
  program: import.meta.filename,
  input: process.stdin,
  output: process.stdout,
});
if (fault !== undefined) {
  process.exitCode = 1;
}
