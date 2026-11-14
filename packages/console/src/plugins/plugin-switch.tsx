import { PowerIcon, PowerOffIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { useEngine } from "../connection/engine-context";
import { MessageText, useText } from "../i18n/console-text";
import type { PluginView, useSwitchPlugin } from "./use-plugins";

/** What a switch acts on: the plugin, and the change that runs `plugin/enable` or `plugin/disable`. */
interface SwitchProps {
  readonly view: PluginView;
  readonly change: ReturnType<typeof useSwitchPlugin>;
}

// Enable, asked once more before the call: Enable it enables, Keep it off leaves it.
function EnableAsked(props: SwitchProps): React.JSX.Element {
  const text = useText();
  const [isAsking, ask] = useState(false);
  const { view, change } = props;
  if (!isAsking) {
    return (
      <Button type="button" disabled={change.isPending} onClick={() => ask(true)}>
        <PowerIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
        {text("console.plugins.enable")}
      </Button>
    );
  }
  const enable = (): void => {
    ask(false);
    change.mutate({ plugin: view.plugin, on: true });
  };
  return (
    <div className="flex w-full flex-col gap-2">
      <p className="text-sm">{text("console.plugins.enableAsk", { name: view.name })}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={enable}>
          {text("console.plugins.enableConfirm")}
        </Button>
        <Button type="button" variant="outline" onClick={() => ask(false)}>
          {text("console.plugins.keepDisabled")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Disable, at once, for a connection with `confirm`; Enable, asked once more since it lets the
 * plugin's tools reach the agent and makes auto mode ask (decision 0350), for one with `admin`. A
 * connection without `admin`, such as the Mini App, is told where to enable it.
 */
export function PluginSwitch(props: SwitchProps): React.JSX.Element | null {
  const text = useText();
  const { scopes } = useEngine().ready;
  const { view, change } = props;
  if (view.state === "enabled") {
    return scopes.includes("confirm") ? (
      <Button
        type="button"
        variant="outline"
        disabled={change.isPending}
        onClick={() => change.mutate({ plugin: view.plugin, on: false })}
      >
        <PowerOffIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
        {text("console.plugins.disable")}
      </Button>
    ) : null;
  }
  return scopes.includes("admin") ? (
    <EnableAsked view={view} change={change} />
  ) : (
    <p className="text-sm text-muted-foreground">
      <MessageText text={text("console.plugins.noEnable")} />
    </p>
  );
}
