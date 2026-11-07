export { configChangedNotice, configInvalidNotice } from "./audit/config-notices.js";
export type { ProxyUse } from "./audit/config-notices.js";
export type { ConfigProblemNamed } from "./audit/config-notices.js";
export { authorOf, journalConfigChange } from "./audit/journal-config-change.js";
export type {
  ConfigAuthor,
  ConfigChangeMade,
  ConfigChangeParts,
} from "./audit/journal-config-change.js";
export type {
  ConfigChangePreview,
  ConfigChanges,
  ConfigChangeRefusal,
  ConfigPatchAsked,
  ConfigPreviewRefusal,
} from "./config-changes/config-change-parts.js";
export type {
  ConfigChangeQuote,
  ConfigKeyChange,
  ConfigPatch,
} from "./config-changes/config-change-quote.js";
export { configChangeLimits } from "./config-changes/config-change-quote.js";
