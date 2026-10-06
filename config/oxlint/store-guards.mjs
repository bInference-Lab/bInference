// AST rules for check:store, loaded only by the config that script writes. Each rule takes
// { root } (the repo root, with forward slashes) so it can tell paths apart; raw-sql and
// sqlite-in-worker also take { allow }, path prefixes where their pattern is legal.

import {
  calleeName,
  isAllowed,
  isFunction,
  pathOptions,
  propertyValue,
  relativePath,
  textOf,
} from "./store-ast.mjs";

const sqlStart =
  /^\s*(?:select|insert|update|delete|create|drop|alter|pragma|begin|commit|rollback|savepoint|release|vacuum|analyze|attach|detach|with|replace|reindex)\b/i;
const connectionName = /(?:^db|database|connection|sqlite)$/i;

function isRawStatement(node) {
  if (!["exec", "prepare"].includes(calleeName(node)) || node.callee.type !== "MemberExpression") {
    return false;
  }
  const text = textOf(node.arguments[0]);
  if (text !== undefined) {
    return sqlStart.test(text);
  }
  const receiver = node.callee.object;
  return receiver.type === "Identifier" && connectionName.test(receiver.name);
}

const rawSql = {
  meta: { schema: pathOptions },
  create(context) {
    if (isAllowed(context)) {
      return {};
    }
    const compiledQueries = new Set();
    const message = "Raw SQL belongs in a migration or the connection layer; build it with Kysely.";
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "kysely" || node.importKind === "type") {
          return;
        }
        for (const specifier of node.specifiers) {
          const imported = specifier.imported?.name;
          if (specifier.importKind !== "type" && imported === "sql") {
            context.report({ node: specifier, message });
          }
          if (imported === "CompiledQuery") {
            compiledQueries.add(specifier.local.name);
          }
        }
      },
      MemberExpression(node) {
        if (
          node.object.type === "Identifier" &&
          compiledQueries.has(node.object.name) &&
          node.property.name === "raw"
        ) {
          context.report({ node, message });
        }
      },
      CallExpression(node) {
        if (isRawStatement(node)) {
          context.report({ node, message });
        }
      },
    };
  },
};

const transactionCalls = new Set(["writeTransaction", "readTransaction"]);

// The callbacks that run inside a transaction: the second argument of writeTransaction and
// readTransaction, a task's run, and a migration's up.
function transactionCallbacks(node) {
  const name = calleeName(node);
  if (transactionCalls.has(name)) {
    return [node.arguments[1]];
  }
  return name === "defineTask" ? [propertyValue(node.arguments[0], "run")] : [];
}

function isPromiseWork(node) {
  if (node.type === "AwaitExpression") {
    return true;
  }
  if (node.type === "NewExpression") {
    return node.callee.type === "Identifier" && node.callee.name === "Promise";
  }
  if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") {
    return false;
  }
  const { object, property } = node.callee;
  const awaited = node.parent?.type === "AwaitExpression";
  return (
    !awaited &&
    (property.name === "then" || (object.type === "Identifier" && object.name === "Promise"))
  );
}

const syncTransaction = {
  meta: { schema: pathOptions },
  create(context) {
    const callbacks = new Set();
    const asyncNames = new Set();
    const named = [];
    const message =
      "A transaction callback is synchronous: do the async work first, then write without await.";
    const check = (callback) => {
      if (isFunction(callback)) {
        callbacks.add(callback);
        if (callback.async) {
          context.report({ node: callback, message });
        }
      } else if (callback?.type === "Identifier") {
        named.push(callback);
      }
    };
    const inCallback = (node) => {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (callbacks.has(parent)) {
          return true;
        }
      }
      return false;
    };
    const visitPromise = (node) =>
      isPromiseWork(node) && inCallback(node) && context.report({ node, message });
    return {
      FunctionDeclaration: (node) => node.async && node.id && asyncNames.add(node.id.name),
      VariableDeclarator(node) {
        if (isFunction(node.init) && node.init.async && node.id.type === "Identifier") {
          asyncNames.add(node.id.name);
        }
        if (node.id.typeAnnotation?.typeAnnotation?.typeName?.name === "Migration") {
          check(propertyValue(node.init, "up"));
        }
      },
      CallExpression(node) {
        transactionCallbacks(node).forEach(check);
        visitPromise(node);
      },
      AwaitExpression: visitPromise,
      NewExpression: visitPromise,
      "Program:exit"() {
        for (const callback of named.filter((identifier) => asyncNames.has(identifier.name))) {
          context.report({ node: callback, message });
        }
      },
    };
  },
};

const ledgerWrites = new Set(["updateTable", "deleteFrom", "replaceInto", "mergeInto"]);
const ledgerTable = /^ledger(?:\s+as\s+\w+)?$/i;
const ledgerSql =
  /\b(?:update(?:\s+or\s+\w+)?|delete\s+from|replace\s+into|insert\s+or\s+replace\s+into)\s+["'`[]?ledger\b/i;

const ledgerAppendOnly = {
  meta: { schema: pathOptions },
  create(context) {
    const message = "The ledger is append-only: never update, replace or delete its rows.";
    const checkText = (node, text) => ledgerSql.test(text) && context.report({ node, message });
    return {
      CallExpression(node) {
        const table = textOf(node.arguments[0]);
        if (ledgerWrites.has(calleeName(node)) && table !== undefined && ledgerTable.test(table)) {
          context.report({ node, message });
        }
      },
      Literal: (node) => typeof node.value === "string" && checkText(node, node.value),
      TemplateElement: (node) => checkText(node, node.value.cooked ?? node.value.raw),
    };
  },
};

const intentWrites = new Set(["updateTable", "insertInto", "replaceInto", "mergeInto"]);

// The argument of the .set() or .values() call chained on the table call, if any.
function chainedValues(node) {
  const member = node.parent;
  if (member?.type !== "MemberExpression" || member.object !== node) {
    return undefined;
  }
  const call = member.parent;
  const name = member.property?.name;
  return call?.type === "CallExpression" && (name === "set" || name === "values")
    ? (call.arguments[0] ?? null)
    : undefined;
}

function mayWriteState(values) {
  if (values?.type !== "ObjectExpression") {
    return true;
  }
  return values.properties.some(
    (property) =>
      property.type === "SpreadElement" ||
      property.key?.name === "state" ||
      property.key?.value === "state",
  );
}

const intentStateWriter = {
  meta: { schema: pathOptions },
  create(context) {
    return {
      CallExpression(node) {
        const table = textOf(node.arguments[0]);
        if (
          !intentWrites.has(calleeName(node)) ||
          table === undefined ||
          !/^intents\b/.test(table)
        ) {
          return;
        }
        const values = chainedValues(node);
        if (values !== undefined && mayWriteState(values)) {
          context.report({ node, message: "This file writes intents.state." });
        }
      },
    };
  },
};

function isWorkerPath(path) {
  return /\.worker\.[cm]?[jt]s$/.test(path);
}

function isValueImport(node) {
  if (node.importKind === "type" || node.exportKind === "type") {
    return false;
  }
  const specifiers = node.specifiers ?? [];
  return specifiers.length === 0 || specifiers.some((specifier) => specifier.importKind !== "type");
}

const sqliteInWorker = {
  meta: { schema: pathOptions },
  create(context) {
    const file = relativePath(context);
    if (isWorkerPath(file) || isAllowed(context)) {
      return {};
    }
    const checkSource = (node, source) => {
      if (source === "node:sqlite" || source === "sqlite") {
        context.report({
          node,
          message: "Open node:sqlite only in a worker entry, a *.worker.ts file.",
        });
      } else if (typeof source === "string" && isWorkerPath(source)) {
        context.report({ node, message: "Only worker entries import a *.worker.ts module." });
      }
    };
    const visitDeclaration = (node) => isValueImport(node) && checkSource(node, node.source?.value);
    return {
      ImportDeclaration: visitDeclaration,
      ExportNamedDeclaration: visitDeclaration,
      ExportAllDeclaration: visitDeclaration,
      ImportExpression: (node) => checkSource(node, textOf(node.source)),
    };
  },
};

const migrationFile = /^packages\/store\/src\/migrations\/[^/]+\/\d{4}_[^/]*\.ts$/;

const noMigrationDown = {
  meta: { schema: pathOptions },
  create(context) {
    if (!migrationFile.test(relativePath(context))) {
      return {};
    }
    const message = "Migrations are forward-only: write no down step.";
    const visit = (node, name) => name === "down" && context.report({ node, message });
    return {
      Property: (node) => visit(node, node.key?.name ?? node.key?.value),
      FunctionDeclaration: (node) => visit(node, node.id?.name),
      VariableDeclarator: (node) => visit(node, node.id?.name),
    };
  },
};

const plugin = {
  meta: { name: "store" },
  rules: {
    "raw-sql": rawSql,
    "sync-transaction": syncTransaction,
    "ledger-append-only": ledgerAppendOnly,
    "intent-state-writer": intentStateWriter,
    "sqlite-in-worker": sqliteInWorker,
    "no-migration-down": noMigrationDown,
  },
};

export default plugin;
