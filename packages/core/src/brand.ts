declare const brandKey: unique symbol;

/**
 * A nominal type: `T` tagged with the name `B`, so two strings with different meanings never mix.
 * A value gets its brand only through a type guard or a schema that checks it.
 */
export type Brand<T, B extends string> = T & { readonly [brandKey]: B };
