export { createPlatform } from "./create-platform.js";
export type { IpcEndpointOptions, Platform, PlatformOptions } from "./create-platform.js";
export { acquireFileLock } from "./file-lock.js";
export type { FileLock } from "./file-lock.js";
export type { IpcBindOptions, IpcBinding } from "./ipc/ipc-binding.js";
export { openIpcChannel } from "./ipc/ipc-channel.js";
export type { IpcChannel, IpcChannelOptions } from "./ipc/ipc-channel.js";
export { createFileSecretStore } from "./keychain/file-secret-store.js";
export { createKeychainSecretStore } from "./keychain/keychain-secret-store.js";
export type { KeychainSecretStoreOptions } from "./keychain/keychain-secret-store.js";
export type { FileSecretStoreOptions } from "./keychain/file-secret-store.js";
export { createPassphraseSecretStore } from "./keychain/passphrase-secret-store.js";
export type { PassphraseSecretStoreOptions } from "./keychain/passphrase-secret-store.js";
export { openLogFile } from "./logs/log-file.js";
export type { LogFile, LogFileOptions } from "./logs/log-file.js";
export { readLogLines } from "./logs/read-log-lines.js";
export type { LogLines, ReadLogLinesOptions } from "./logs/read-log-lines.js";
export type {
  FileAccess,
  FileAccessState,
  FilePermissions,
  IpcEndpoint,
  ServiceManager,
} from "./ports.js";
export { startNodeProgram } from "./node-program.js";
export type { NodeProgram, NodeProgramOptions } from "./node-program.js";
export { ensurePrivateFolder, writePrivateFile, writePrivateStream } from "./private-files.js";
export type { PrivateFileOptions } from "./private-files.js";
export { fileSize } from "./file-size.js";
export { listFolderFiles } from "./list-folder-files.js";
export { movePath, removePath } from "./move-path.js";
export { readFilePieces } from "./read-file-pieces.js";
export type { ReadPiecesOptions } from "./read-file-pieces.js";
export { readTextFile } from "./read-text-file.js";
export { realFilePath } from "./real-file-path.js";
export { runCommand, runCommandToExit, runCommandWithin } from "./run-command.js";
export { readSystemFacts } from "./system-facts.js";
export type { SystemFacts } from "./system-facts.js";
export { startTerminalProgram } from "./terminal-program.js";
export type { TerminalExit, TerminalProgram, TerminalProgramOptions } from "./terminal-program.js";
export type { ProgramExit, RunProgram, RunToExit, RunWithinOptions } from "./run-command.js";
export { pollUntil } from "./service/poll-until.js";
export type { Poll } from "./service/poll-until.js";
export type { ServiceDefinition, ServiceStatus } from "./service/service-definition.js";
export { createShutdown } from "./shutdown.js";
export type {
  ShutdownOptions,
  Shutdown,
  ShutdownReport,
  ShutdownStep,
  ShutdownStepReport,
  SignalEvents,
  StepOutcome,
  StopTrigger,
} from "./shutdown.js";
export { resolveStateFolder } from "./state-folder.js";
export { watchFile } from "./watch-file.js";
export { createWorkspaceFolder } from "./workspace-folder.js";
export type { WorkspaceFolderOptions } from "./workspace-folder.js";
export type { FileWatch, WatchFileOptions } from "./watch-file.js";
export type { StateFolder, StateFolderOptions } from "./state-folder.js";
