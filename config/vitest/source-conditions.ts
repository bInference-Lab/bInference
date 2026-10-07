/**
 * The export conditions tests resolve. Workspace packages give their src under the first one, so
 * tests never need a build.
 */
export const sourceConditions: readonly string[] = [
  "@binference/source",
  "module",
  "node",
  "development|production",
];
