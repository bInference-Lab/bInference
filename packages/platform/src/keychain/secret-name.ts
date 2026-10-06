import { BinferenceError } from "@binference/core";

const namePattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
// Windows refuses these as file names whatever the extension, and the passphrase store keeps one
// file per entry.
const deviceName = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/;

/**
 * Checks the name of a secret store entry: 1 to 64 lowercase letters, digits, dots, dashes and
 * underscores, starting with a letter or a digit, and no Windows device name such as `con`. Throws
 * `platform.secret_name_invalid` for any other name, before a store touches anything.
 */
export function checkSecretName(name: string): void {
  if (!namePattern.test(name) || deviceName.test(name)) {
    throw new BinferenceError({
      code: "platform.secret_name_invalid",
      message:
        `${JSON.stringify(name)} is not a secret name; use lowercase letters, digits, dots, ` +
        "dashes and underscores, such as telegram-bot.",
      details: { name },
    });
  }
}
