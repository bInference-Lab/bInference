import type { GateCase, GateStep } from "./gate-case.mjs";

const cachedTasks = ["check:layout", "lint:docs", "check:tsconfig"];

function turbo(expect: "pass" | "fail", output: readonly RegExp[]): GateStep {
  return {
    command: ["pnpm", "exec", "turbo", "run", ...cachedTasks, "--output-logs=errors-only"],
    expect,
    output,
  };
}

/** Cases for the Turborepo pipeline behind pnpm check. */
export function checkCases(): readonly GateCase[] {
  return [
    {
      name: "a second run with no change is served from the cache",
      steps: [
        turbo("pass", [/0 cached, 3 total/]),
        turbo("pass", [/3 cached, 3 total/, /FULL TURBO/]),
      ],
    },
    {
      name: "a changed file reruns the gates that read it",
      steps: [
        turbo("pass", [/0 cached, 3 total/]),
        {
          ...turbo("fail", [/check:layout\(shell-script\)/]),
          files: { "scripts/new.sh": "echo\n" },
        },
      ],
    },
  ];
}
