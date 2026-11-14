/**
 * The full i18n key of a message the CLI prints: a `check.` key names the shared `check` area,
 * which the console reads too for the findings of `binference check`; any other key is in the
 * `cli` area.
 */
export function cliMessageKey(key: string): string {
  return key.startsWith("check.") ? key : `cli.${key}`;
}
