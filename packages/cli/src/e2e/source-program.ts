import { type NodeProgram, startNodeProgram } from "@binference/platform";

/** A TypeScript file run from source as a process of its own, and its standard output as lines. */
export interface SourceProgram {
  readonly program: NodeProgram;
  /** Resolves with the first line that holds `text`, or with every line once the output ends. */
  readonly lineWith: (text: string) => Promise<string>;
  /** Every whole line the program has written so far. */
  readonly lines: () => readonly string[];
}

/** What one source program starts with. */
export interface SourceProgramOptions {
  /** The TypeScript file's path. */
  readonly file: string;
  readonly args: readonly string[];
  /** The test process's environment: the program gets its temporary folder variables. */
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  /** Variables the program gets besides those. */
  readonly env: Readonly<Record<string, string>>;
  /** Ends the program at once when it aborts. */
  readonly signal: AbortSignal;
}

interface Waiter {
  readonly text: string;
  readonly resolve: (line: string) => void;
}

// Collects the program's output as lines, and answers each waiter with the first line that holds
// its text, or with the whole output once it ends.
function watchLines(program: NodeProgram): Omit<SourceProgram, "program"> {
  const lines: string[] = [];
  const waiters = new Set<Waiter>();
  const state = { rest: "", hasEnded: false };
  const answer = (waiter: Waiter, line: string): void => {
    waiters.delete(waiter);
    waiter.resolve(line);
  };
  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of program.output) {
      const whole = (state.rest + decoder.decode(chunk, { stream: true })).split("\n");
      state.rest = whole.pop() ?? "";
      lines.push(...whole);
      waiters.forEach((waiter) => {
        const found = whole.find((line) => line.includes(waiter.text));
        if (found !== undefined) {
          answer(waiter, found);
        }
      });
    }
    state.hasEnded = true;
    waiters.forEach((waiter) => answer(waiter, lines.join("\n")));
  })();
  const lineWith = async (text: string): Promise<string> => {
    const found = lines.find((line) => line.includes(text));
    if (found !== undefined || state.hasEnded) {
      return found ?? lines.join("\n");
    }
    return new Promise((resolve) => waiters.add({ text, resolve }));
  };
  return { lineWith, lines: () => [...lines] };
}

// The test's own temporary folder variables, so the TypeScript loader can keep its cache.
function loaderEnv(parentEnv: SourceProgramOptions["parentEnv"]): Readonly<Record<string, string>> {
  const names = ["TMPDIR", "TMP", "TEMP"];
  return Object.fromEntries(
    names.flatMap((name) => {
      const value = parentEnv[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

/**
 * Runs a TypeScript file of the tests from source, as an owner's machine runs a program: a Node
 * process of its own with the TypeScript loader, the workspace's source conditions, and only the
 * variables the options name. The program's standard error is dropped.
 */
export function startSourceProgram(options: SourceProgramOptions): SourceProgram {
  const program = startNodeProgram({
    args: ["--conditions=@binference/source", "--import", "tsx", options.file, ...options.args],
    parentEnv: options.parentEnv,
    env: { ...loaderEnv(options.parentEnv), ...options.env },
    signal: options.signal,
  });
  return { program, ...watchLines(program) };
}
