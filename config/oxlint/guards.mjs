// AST rules Oxlint has no built-in for, loaded through "jsPlugins" in .oxlintrc.json.

function report(context, node, message) {
  context.report({ node, message });
}

function isBooleanAnnotation(node) {
  return node?.typeAnnotation?.typeAnnotation?.type === "TSBooleanKeyword";
}

function paramTarget(param) {
  if (param.type === "AssignmentPattern") {
    return param.left;
  }
  if (param.type === "TSParameterProperty") {
    return param.parameter;
  }
  return param;
}

function checkParams(context, node) {
  for (const param of node.params ?? []) {
    const target = paramTarget(param);
    if (isBooleanAnnotation(target)) {
      report(context, target, "Split the function or pass a named option, not a boolean flag.");
    }
  }
}

const noBooleanParam = {
  create(context) {
    const visit = (node) => checkParams(context, node);
    return {
      FunctionDeclaration: visit,
      FunctionExpression: visit,
      ArrowFunctionExpression: visit,
      TSDeclareFunction: visit,
      TSMethodSignature: visit,
      TSFunctionType: visit,
    };
  },
};

function isDateCallee(node) {
  return node.callee.type === "Identifier" && node.callee.name === "Date";
}

const noArglessDate = {
  create(context) {
    const visit = (node) => {
      if (isDateCallee(node) && node.arguments.length === 0) {
        report(context, node, "Read the time through the Clock port.");
      }
    };
    return { NewExpression: visit, CallExpression: visit };
  },
};

const noClass = {
  create(context) {
    const visit = (node) =>
      report(context, node, "Write a factory function; the error class is the only class.");
    return { ClassDeclaration: visit, ClassExpression: visit };
  },
};

function isReexportOnly(statement) {
  if (statement.type === "ImportDeclaration" || statement.type === "ExportAllDeclaration") {
    return true;
  }
  return statement.type === "ExportNamedDeclaration" && statement.declaration === null;
}

const noReexportFile = {
  create(context) {
    return {
      Program(node) {
        const exports = node.body.filter((statement) => statement.type.startsWith("Export"));
        if (exports.length > 0 && node.body.every(isReexportOnly)) {
          report(context, node, "A file of re-exports is a barrel; import from the source file.");
        }
      },
    };
  },
};

const noInterfacePrefix = {
  create(context) {
    return {
      TSInterfaceDeclaration(node) {
        if (/^I[A-Z]/.test(node.id.name)) {
          report(context, node.id, "Name the interface without an I prefix.");
        }
      },
    };
  },
};

const pascalCase = /^[A-Z][a-zA-Z0-9]*$/;

const typePascalCase = {
  create(context) {
    const visit = (node) => {
      if (node.id !== null && !pascalCase.test(node.id.name)) {
        report(context, node.id, "Name types and interfaces in PascalCase.");
      }
    };
    return { TSInterfaceDeclaration: visit, TSTypeAliasDeclaration: visit };
  },
};

const signalKeys = { fetch: "signal", execa: "cancelSignal", execaNode: "cancelSignal" };

function hasKey(argument, key) {
  return (
    argument.type === "ObjectExpression" &&
    argument.properties.some(
      (property) =>
        property.type === "Property" &&
        ((property.key.type === "Identifier" && property.key.name === key) ||
          (property.key.type === "Literal" && property.key.value === key)),
    )
  );
}

const requireAbortSignal = {
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || !Object.hasOwn(signalKeys, node.callee.name)) {
          return;
        }
        const key = signalKeys[node.callee.name];
        if (!node.arguments.some((argument) => hasKey(argument, key))) {
          report(context, node, `Pass ${key} with a timeout to ${node.callee.name}.`);
        }
      },
    };
  },
};

// Names that hold a chain, venue or other registry id: switching or comparing on them is a branch
// on the registry, which the core never takes.
const registryName = /(?:chain|venue|family|namespace|network|provider|channel)(?:id|ref|key)?$/i;
const hexAddress = /(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;

function nameOf(node) {
  if (node.type === "ChainExpression") {
    return nameOf(node.expression);
  }
  if (node.type === "Identifier") {
    return node.name;
  }
  return node.type === "MemberExpression" && node.property.type === "Identifier"
    ? node.property.name
    : undefined;
}

function isLiteral(node) {
  return node.type === "Literal" && node.value !== null;
}

function isRegistryName(node) {
  const name = nameOf(node);
  return name !== undefined && registryName.test(name);
}

function literalProblem(text, options) {
  if (options.caip.test(text)) {
    return "A CAIP id is data: read it from the chain registry.";
  }
  if (hexAddress.test(text)) {
    return "An address is data: read it from the chain registry.";
  }
  return options.ids.has(text.toLowerCase())
    ? `"${text}" is a registry id: read it from the registry instead.`
    : undefined;
}

function chainLiteralOptions(context) {
  const [options = {}] = context.options;
  const namespaces = options.namespaces ?? [];
  return {
    caip: new RegExp(`(?<![-a-z0-9])(?:${namespaces.join("|") || "(?!)"}):`),
    ids: new Set((options.ids ?? []).map((id) => id.toLowerCase())),
  };
}

const noChainLiteral = {
  meta: {
    schema: [
      {
        type: "object",
        properties: {
          namespaces: { type: "array", items: { type: "string" } },
          ids: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = chainLiteralOptions(context);
    const checkText = (node, text) => {
      const problem = literalProblem(text, options);
      if (problem !== undefined) {
        report(context, node, problem);
      }
    };
    const checkComparison = (node) => {
      const [left, right] = [node.left, node.right];
      if (
        (isRegistryName(left) && isLiteral(right)) ||
        (isRegistryName(right) && isLiteral(left))
      ) {
        report(context, node, "Compare through the registry, not against a literal id.");
      }
    };
    return {
      Literal: (node) => typeof node.value === "string" && checkText(node, node.value),
      TemplateElement: (node) => checkText(node, node.value.cooked ?? node.value.raw),
      SwitchStatement: (node) =>
        isRegistryName(node.discriminant) &&
        report(context, node, "Look the id up in its registry instead of switching on it."),
      BinaryExpression: (node) =>
        ["===", "!==", "==", "!="].includes(node.operator) && checkComparison(node),
    };
  },
};

// The words of a name or a text: camelCase, snake_case and kebab-case parts, in lowercase.
function wordsOf(text) {
  return text
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

// A profile's name: "cloud", or "self-hosted" in any spelling.
function namesProfile(words) {
  return words.some(
    (word, index) =>
      word === "cloud" ||
      word === "selfhosted" ||
      (word === "self" && words[index + 1] === "hosted"),
  );
}

// A name that holds a profile, such as `profile` or `activeProfile`.
function holdsProfile(words) {
  return [words[0], words.at(-1)].some((word) => word === "profile" || word === "profiles");
}

const profileMessage =
  "Only the composition root knows the profile: take a port, and let the root pick its adapter (ARCHITECTURE.md rule 19).";

const noProfileMention = {
  create(context) {
    const checkText = (node, text) => {
      if (namesProfile(wordsOf(text))) {
        report(context, node, profileMessage);
      }
    };
    return {
      Literal: (node) => typeof node.value === "string" && checkText(node, node.value),
      TemplateElement: (node) => checkText(node, node.value.cooked ?? node.value.raw),
      Identifier: (node) => {
        const words = wordsOf(node.name);
        if (namesProfile(words) || holdsProfile(words)) {
          report(context, node, profileMessage);
        }
      },
      Program: () => {
        for (const comment of context.sourceCode.getAllComments()) {
          checkText(comment, comment.value);
        }
      },
    };
  },
};

const plugin = {
  meta: { name: "guards" },
  rules: {
    "no-boolean-param": noBooleanParam,
    "no-argless-date": noArglessDate,
    "no-class": noClass,
    "no-reexport-file": noReexportFile,
    "no-interface-prefix": noInterfacePrefix,
    "type-pascal-case": typePascalCase,
    "require-abort-signal": requireAbortSignal,
    "no-chain-literal": noChainLiteral,
    "no-profile-mention": noProfileMention,
  },
};

export default plugin;
