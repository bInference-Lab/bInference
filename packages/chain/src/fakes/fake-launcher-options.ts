import type { AssetRef } from "../caip/asset-ref.js";
import type { LaunchOption, LaunchOptionValue } from "../venues/launch-option.js";
import type { LaunchQuoteFailure } from "../venues/launch-refusals.js";
import type { LaunchWordLimits, WrittenWords } from "../venues/launch-words.js";

/** How a fake launchpad's pins go: pinned after some status reads, never, or failed. */
export type FakePinScript =
  | { readonly pinnedAfterReads: number }
  | { readonly never: true }
  | { readonly failsAfterReads: number };

/** What a fake launcher launches against, charges and makes. */
export interface FakeLauncherOptions {
  /** The asset its launches trade against; the fake chain's coin when absent. */
  readonly pair?: AssetRef;
  /** Its launch fee, in base units of the fake chain's coin; 2,000 when absent. */
  readonly feeBase?: bigint;
  /** The token every launch makes; `fake:1/token:0x000000e1` when absent. */
  readonly token?: AssetRef;
  /** Base units of the new token a first buy gets per base unit it spends; 1,000 when absent. */
  readonly tokensPerUnit?: bigint;
  /** How its pins go; pinned at the first status read when absent. */
  readonly pin?: FakePinScript;
  /** The settings it declares; none when absent. */
  readonly launchOptions?: readonly LaunchOption[];
  /**
   * Settings its create call writes in place of the request's, as a launchpad that lies about
   * them would; the request's when absent.
   */
  readonly writesOptions?: Readonly<Record<string, LaunchOptionValue>>;
  /** Its create call's first buy carries no minimum, as it declares; one when absent. */
  readonly noFirstBuyMin?: boolean;
  /** The minimum its create call writes for a first buy; the request's when absent. */
  readonly writesMinOut?: bigint;
  /**
   * It writes a launch's words into its create call, within these limits, as a launchpad that
   * keeps them on chain does; it writes none when absent.
   */
  readonly wordLimits?: LaunchWordLimits;
  /** Words its create call writes in place of the request's, as a launchpad that lies would. */
  readonly writesWords?: WrittenWords;
  /**
   * The SHA-256 its create call writes for the picture in place of the request's picture's, as a
   * launchpad that lies would; a fake that writes the picture into its create call only.
   */
  readonly writesPictureSha256?: string;
  /**
   * Values its quote works out for optional settings a launch leaves out (decision 0280), each
   * named only when the terms leave it out; none when absent.
   */
  readonly quotesSettings?: Readonly<Record<string, LaunchOptionValue>>;
  /**
   * Values its build works out for settings a launch leaves out (decision 0280), which its create
   * call writes beside the request's; none when absent.
   */
  readonly buildsSettings?: Readonly<Record<string, LaunchOptionValue>>;
  /** Why it cannot quote any launch now (decision 0284); it quotes when absent. */
  readonly quoteFails?: LaunchQuoteFailure;
}
