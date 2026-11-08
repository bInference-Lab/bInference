/** A model named `<provider>/<model>`, split at its first slash. */
export interface ModelRef {
  readonly provider: string;
  readonly model: string;
}

/**
 * Splits `<provider>/<model>`: the provider's name ends at the first slash, and the model's id,
 * which may hold slashes of its own (`anthropic/claude-sonnet-4.5`), is the rest. `undefined` when
 * either part is empty.
 */
export function splitModel(ref: string): ModelRef | undefined {
  const slash = ref.indexOf("/");
  return slash <= 0 || slash === ref.length - 1
    ? undefined
    : { provider: ref.slice(0, slash), model: ref.slice(slash + 1) };
}

/**
 * Whether `ref` names a model of one of `providers` as `<provider>/<model>`: the check a helper's
 * model and a chat model pass (decisions 0403 and 0404).
 */
export function isConfiguredModel(ref: string, providers: readonly string[]): boolean {
  const named = splitModel(ref);
  return named !== undefined && providers.includes(named.provider);
}
