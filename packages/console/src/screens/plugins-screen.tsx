import { MessageText, useText } from "../i18n/console-text";
import { PluginItem } from "../plugins/plugin-item";
import { usePlugins, useSwitchPlugin } from "../plugins/use-plugins";
import { ScreenState } from "./screen-state";

/**
 * The installed community plugins (decisions 0348 to 0351 and 0433 to 0435), as `plugin/list`
 * answers them: each with what its review showed, whether it runs and why not, and a switch.
 * Adding, updating and removing stay in the terminal, where the review needs the owner.
 */
export function PluginsScreen(): React.JSX.Element {
  const text = useText();
  const plugins = usePlugins();
  const change = useSwitchPlugin();
  const items = plugins.data ?? [];
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{text("console.plugins.title")}</h1>
      <p className="text-sm text-muted-foreground">
        <MessageText text={text("console.plugins.intro")} />
      </p>
      <p className="text-sm text-muted-foreground">{text("console.plugins.never")}</p>
      {plugins.data === undefined ? <ScreenState error={plugins.error} /> : null}
      {plugins.data !== undefined && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <MessageText text={text("console.plugins.none")} />
        </p>
      ) : null}
      {items.length === 0 ? null : (
        <ul aria-label={text("console.plugins.list")} className="flex flex-col gap-4">
          {items.map((view) => (
            <li key={view.plugin}>
              <PluginItem view={view} change={change} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
