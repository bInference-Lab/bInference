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
  },
};

export default plugin;
