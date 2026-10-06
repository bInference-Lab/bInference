import { existsSync, readdirSync } from "node:fs";
import type { RuleOutcome, SyncRule, UserConfig } from "@commitlint/types";

const types = ["feat", "fix", "perf", "refactor", "test", "docs", "ci", "build", "chore", "revert"];
const fixedScopes = ["deps", "skills", "dev-skills", "docs", "release"];
const featureHosts = ["packages/engine/src", "packages/runtime/src"];

function folders(parent: string): readonly string[] {
  if (!existsSync(parent)) {
    return [];
  }
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

// The scope list comes from the folders, so it never drifts from the code.
function scopes(): readonly string[] {
  const packages = [...folders("packages"), ...folders("plugins")];
  const features = featureHosts.flatMap((host) => folders(host));
  const clash = features.find((feature) => packages.includes(feature));
  if (clash !== undefined) {
    throw new Error(`The feature folder ${clash} reuses a package name; rename the folder.`);
  }
  return [...new Set([...packages, ...features, ...fixedScopes])].toSorted();
}

type Commit = Parameters<SyncRule>[0];

const masterSuffix = / \(#\d+\)$/;

function scopeSingle(commit: Commit): RuleOutcome {
  const scope = commit["scope"] ?? "";
  return [!/[,/\\ ]/.test(scope), "use one scope, never two"];
}

// commitlint's parser files a "Breaking:" line as a footer, so this rule reads the raw message.
function breakingParagraph(commit: Commit): RuleOutcome {
  const bang = /^\w+(?:\([^)]*\))?!:/.test(commit["header"] ?? "");
  return [
    !bang || /^Breaking: /m.test(commit["raw"] ?? ""),
    "a ! subject needs a body paragraph that starts with Breaking:",
  ];
}

function headerLength(commit: Commit): RuleOutcome {
  const header = (commit["header"] ?? "").replace(masterSuffix, "");
  return [header.length <= 72, `the subject is ${String(header.length)} characters; 72 at most`];
}

function subjectStartsLowercase(commit: Commit): RuleOutcome {
  return [
    !/^[A-Z]/.test(commit["subject"] ?? ""),
    "the description starts with a lowercase letter",
  ];
}

function revertReference(commit: Commit): RuleOutcome {
  return [
    commit["type"] !== "revert" || /This reverts commit [0-9a-f]{7,}/.test(commit["raw"] ?? ""),
    "a revert names the commit it undoes: This reverts commit <hash>",
  ];
}

const config: UserConfig = {
  parserPreset: {
    parserOpts: {
      headerPattern: /^(\w*)(?:\(([^)]*)\))?(!)?: (.*)$/,
      headerCorrespondence: ["type", "scope", "breaking", "subject"],
    },
  },
  plugins: [
    {
      rules: {
        "scope-single": scopeSingle,
        "breaking-paragraph": breakingParagraph,
        "header-length": headerLength,
        "subject-starts-lowercase": subjectStartsLowercase,
        "revert-reference": revertReference,
      },
    },
  ],
  rules: {
    "type-enum": [2, "always", types],
    "type-empty": [2, "never"],
    "scope-enum": [2, "always", [...scopes()]],
    "scope-single": [2, "always"],
    "subject-empty": [2, "never"],
    "subject-starts-lowercase": [2, "always"],
    "subject-full-stop": [2, "never", "."],
    "header-length": [2, "always"],
    "body-leading-blank": [2, "always"],
    "body-max-line-length": [2, "always", 72],
    "footer-max-line-length": [2, "always", 72],
    "breaking-paragraph": [2, "always"],
    "revert-reference": [2, "always"],
  },
};

export default config;
