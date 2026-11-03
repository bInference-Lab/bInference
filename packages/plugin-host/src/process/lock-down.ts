import { syncBuiltinESMExports } from "node:module";
import process from "node:process";
import v8 from "node:v8";

// What Node's permission model leaves to a plugin's code that could change the process itself:
// V8's flags, which can turn on its internal functions (decision 0343), and the functions that end
// the process, which a plugin could replace to outlive its channel.
const refusedV8 = ["setFlagsFromString"] as const;
const keptProcess = ["exit", "reallyExit", "kill", "_kill"] as const;

function refusal(name: string): () => never {
  return () => {
    throw Object.assign(new Error(`${name} is refused to community plugins.`), {
      code: "ERR_ACCESS_DENIED",
    });
  };
}

// Keeps a property's value as it stands: defined with no value, it can be neither written nor
// defined again.
function keep(owner: object, name: string): void {
  Object.defineProperty(owner, name, { writable: false, configurable: false });
}

function replace(owner: object, name: string, by: () => never): void {
  Object.defineProperty(owner, name, { value: by, writable: false, configurable: false });
}

/**
 * Locks the process down before a plugin's code loads (decision 0343): `v8.setFlagsFromString`
 * throws `ERR_ACCESS_DENIED` in every import form, the default and named exports of `node:v8`
 * and `require("v8")` alike, and `process.exit`, `reallyExit`, `kill` and `_kill` stay the ones
 * Node gave, so the program can always end itself. Neither can be put back or redefined.
 */
export function lockDown(): void {
  for (const name of refusedV8) {
    replace(v8, name, refusal(`v8.${name}`));
  }
  for (const name of keptProcess) {
    keep(process, name);
  }
  syncBuiltinESMExports();
}
