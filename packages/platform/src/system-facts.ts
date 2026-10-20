import { arch, platform, release } from "node:os";
import process from "node:process";

/** The machine a program runs on, as a support bundle names it. */
export interface SystemFacts {
  /** Node's version, such as `v26.10.0`. */
  readonly node: string;
  /** Node's name for the OS: `darwin`, `linux` or `win32`. */
  readonly os: string;
  /** The OS's own release, such as `25.0.0`. */
  readonly osRelease: string;
  /** The CPU type, such as `arm64`. */
  readonly cpu: string;
}

/** Reads the machine this process runs on: Node's version, the OS, its release and the CPU type. */
export function readSystemFacts(): SystemFacts {
  return { node: process.version, os: platform(), osRelease: release(), cpu: arch() };
}
