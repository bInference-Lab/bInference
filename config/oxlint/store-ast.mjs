// Helpers shared by the check:store rules in store-guards.mjs.

export function relativePath(context) {
  const [options = {}] = context.options;
  const file = context.filename.replaceAll("\\", "/");
  const root = `${(options.root ?? "").replaceAll("\\", "/")}/`;
  return file.startsWith(root) ? file.slice(root.length) : file;
}

export function isAllowed(context) {
  const [options = {}] = context.options;
  const file = relativePath(context);
  return (options.allow ?? []).some((prefix) => file === prefix || file.startsWith(prefix));
}

export const pathOptions = [
  {
    type: "object",
    properties: {
      root: { type: "string" },
      allow: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
  },
];

export function calleeName(node) {
  const callee = node.callee;
  if (callee.type === "Identifier") {
    return callee.name;
  }
  return callee.type === "MemberExpression" && callee.property.type === "Identifier"
    ? callee.property.name
    : undefined;
}

export function textOf(node) {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node?.type === "TemplateLiteral") {
    return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join(" ");
  }
  return undefined;
}

export function isFunction(node) {
  return node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression";
}

export function propertyValue(object, name) {
  const property = object?.properties?.find(
    (candidate) => candidate.type === "Property" && candidate.key?.name === name,
  );
  return property?.value;
}
