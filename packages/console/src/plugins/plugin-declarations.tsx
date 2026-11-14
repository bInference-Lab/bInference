import { displayOutsideText } from "@binference/i18n";
import { MessageText, useText } from "../i18n/console-text";
import type { PluginView } from "./use-plugins";

// A declared name is the plugin's own text, kept short and made visible.
const nameChars = 100;

// The names a plugin declares of one kind: each permission is the kind's prefix, then its name.
function declaredOf(view: PluginView, prefix: "kind:" | "host:" | "tool:" | "config:") {
  return view.permissions.flatMap((permission) =>
    permission.startsWith(prefix) ? [permission.slice(prefix.length)] : [],
  );
}

// One list of the review: its line, then each name as code; nothing below a line that says none.
function DeclaredList(props: {
  readonly line: string;
  readonly names: readonly string[];
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <p>
        <MessageText text={props.line} />
      </p>
      {props.names.length === 0 ? null : (
        <ul aria-label={props.line.replaceAll("`", "")} className="flex flex-wrap gap-1.5">
          {props.names.map((name) => (
            <li key={name}>
              <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs break-all">
                {displayOutsideText(name, nameChars)}
              </code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What a plugin declares, as its permission review showed it (decision 0348): its kinds, the
 * hosts it may reach, its tools and the settings it reads, every entry of every list.
 */
export function PluginDeclarations(props: { readonly view: PluginView }): React.JSX.Element {
  const text = useText();
  const { view } = props;
  const hosts = declaredOf(view, "host:");
  const tools = declaredOf(view, "tool:");
  const settings = declaredOf(view, "config:");
  return (
    <div className="flex flex-col gap-2">
      <DeclaredList line={text("console.plugins.kinds")} names={declaredOf(view, "kind:")} />
      <DeclaredList line={text("console.plugins.hosts", { count: hosts.length })} names={hosts} />
      <DeclaredList line={text("console.plugins.tools", { count: tools.length })} names={tools} />
      <DeclaredList
        line={text("console.plugins.config", { count: settings.length, name: view.name })}
        names={settings}
      />
    </div>
  );
}
