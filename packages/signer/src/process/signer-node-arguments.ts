/**
 * The arguments to start the signer with: Node's permission model with no grant at all, so Node
 * refuses every file, socket, child process and worker the signer could try to open; its
 * debugger's signal off, so no process of the machine can open it (decision 0343); code from
 * strings off; then the built entry, `signer-process.mjs`. `entry` is its real path, with no link
 * on the way, since Node lets a process read only the program it runs. The engine starts
 * `process.execPath` with these arguments and pipes for standard input and output, which are the
 * signer's only channel.
 */
export function signerNodeArguments(entry: string): readonly string[] {
  return ["--permission", "--disable-sigusr1", "--disallow-code-generation-from-strings", entry];
}
