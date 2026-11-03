import { whichCommand } from "which-command";

/** The variables a program lookup reads: `PATH`, spelled `Path` on Windows too, and `PATHEXT`. */
export type ProgramEnv = Readonly<Record<string, string | undefined>>;

// Windows names ignore case, so its PATH may be spelled `Path`.
function variableOf(env: ProgramEnv, name: string): string | undefined {
  return Object.entries(env).find(([key]) => key.toUpperCase() === name)?.[1];
}

/**
 * The absolute path of a program found on the `PATH` of `env` alone, never this process's, with
 * Windows' `PATHEXT` endings; an absolute path is checked as it is. Answers `undefined` when no
 * executable file is there, and with no `PATH` in `env` it looks nowhere.
 */
export async function findProgram(file: string, env: ProgramEnv): Promise<string | undefined> {
  const pathExt = variableOf(env, "PATHEXT");
  return whichCommand(file, {
    path: variableOf(env, "PATH") ?? "",
    ...(pathExt === undefined ? {} : { pathExt }),
  });
}
