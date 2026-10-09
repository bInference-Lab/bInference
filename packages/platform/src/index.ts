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
export { ensurePrivateFolder, writePrivateFile } from "./private-files.js";
export type { PrivateFileOptions } from "./private-files.js";
export { readTextFile } from "./read-text-file.js";
export { runCommand } from "./run-command.js";
export type { RunProgram } from "./run-command.js";
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
export type { StateFolder, StateFolderOptions } from "./state-folder.js";
