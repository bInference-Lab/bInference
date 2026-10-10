import type { ProtocolId } from "@binference/protocol";
import type {
  LabelFlags,
  AgentFlags,
  CeilingSetFlags,
  CheckFlags,
  CommonOptions,
  InitFlags,
  LogsFlags,
  StartFlags,
  WalletAddressFlags,
} from "./cli-flags.schema.js";
import type { CliHost } from "./cli-host.js";

/** The approval mode `binference approval` sets. */
export type ApprovalModeChoice = "manual" | "auto";

/** The command that runs, with its options checked. */
export type ChosenCommand =
  | { readonly name: "init"; readonly options: InitFlags }
  | { readonly name: "start"; readonly options: StartFlags }
  | { readonly name: "status" | "health"; readonly options: CommonOptions }
  | { readonly name: "unlock"; readonly options: CommonOptions }
  | { readonly name: "logs"; readonly options: LogsFlags }
  | {
      readonly name: "approval";
      readonly options: AgentFlags;
      /** The mode to set; the command shows the mode when left out. */
      readonly mode?: ApprovalModeChoice;
    }
  | {
      readonly name: "confirm" | "deny";
      readonly options: CommonOptions;
      readonly intent: ProtocolId<"intent">;
    }
  | { readonly name: "live" | "paper" | "walletList"; readonly options: AgentFlags }
  | { readonly name: "walletAddress" | "ceiling"; readonly options: WalletAddressFlags }
  | { readonly name: "walletCreate"; readonly options: LabelFlags }
  | { readonly name: "ceilingSet"; readonly options: CeilingSetFlags }
  | { readonly name: "freeze" | "unfreeze"; readonly options: AgentFlags }
  | { readonly name: "rescue" | "rescueCancel" | "safetyStatus"; readonly options: CommonOptions }
  | { readonly name: "rescueSet"; readonly options: CommonOptions; readonly address: string }
  | { readonly name: "addressList" | "limit" | "limitCancel"; readonly options: AgentFlags }
  | { readonly name: "limitSet"; readonly options: AgentFlags; readonly sets: readonly string[] }
  | { readonly name: "addressAdd"; readonly options: LabelFlags; readonly address: string }
  | {
      readonly name: "addressRemove";
      readonly options: CommonOptions;
      readonly entry: ProtocolId<"addressBook">;
    }
  | { readonly name: "check"; readonly options: CheckFlags };

/** What the program is built from. */
export interface ProgramOptions {
  readonly version: string;
  /** A message of the `cli` area in the owner's language. */
  readonly message: (key: string) => string;
  readonly host: Pick<CliHost, "out" | "err">;
  /** Receives the command commander chose, before it runs. */
  readonly choose: (command: ChosenCommand) => void;
}
