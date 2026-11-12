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
  CommandWall,
  CommandWallKind,
  CommandWallState,
  NoWallCause,
  ShellLauncher,
  FileAccess,
  FileAccessState,
  FilePermissions,
  IpcEndpoint,
  ScreenCapture,
  ServiceManager,
} from "./ports.js";
export type { RunScreenProgram, ScreenCaptureOptions } from "./screen-shots.js";
export type { ScreenRefusal, ScreenShot } from "./screen-shot.js";
export type { CommandLaunch } from "./command-launch.js";
export type { RunningShell, ShellEnd, ShellLaunch, ShellProgram } from "./shell-launch.js";
export { walledPaths } from "./command-wall-paths.js";
export type { WalledPaths } from "./command-wall-paths.js";
export { startNodeProgram } from "./node-program.js";
export type { NodeProgram, NodeProgramOptions } from "./node-program.js";
export { ensurePrivateFolder, writePrivateFile, writePrivateStream } from "./private-files.js";
export type { PrivateFileOptions } from "./private-files.js";
export { fileSize } from "./file-size.js";
export { findFolderStrays } from "./folder-strays.js";
export { listFolderFiles } from "./list-folder-files.js";
export { movePath, removePath } from "./move-path.js";
export { readFilePieces } from "./read-file-pieces.js";
export type { ReadPiecesOptions } from "./read-file-pieces.js";
export { readTextFile } from "./read-text-file.js";
export { ensureReadableFolder, writeReadableFile } from "./readable-files.js";
export { isFolder } from "./is-folder.js";
export { readFileBytes, realPathOf } from "./read-file-bytes.js";
export { readJudgedFile } from "./read-judged-file.js";
export { realPlaceOf } from "./real-place-of.js";
export type {
  JudgedFileRead,
  JudgedReadFault,
  JudgedReadOptions,
  RealPathStep,
} from "./read-judged-file.js";
export { removeOwnerFile, writeOwnerFile } from "./owner-files.js";
export type { FileBytesRefusal } from "./read-file-bytes.js";
export { realFilePath } from "./real-file-path.js";
export { runCommand, runCommandToExit, runCommandWithin } from "./run-command.js";
export { holdsRunningFiles, readSystemFacts } from "./system-facts.js";
export type { SystemFacts } from "./system-facts.js";
export { findProgram, type ProgramEnv } from "./find-program.js";
export { programFolders } from "./program-folders.js";
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
