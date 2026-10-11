import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellIcon, BellOffIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { useEngine } from "../connection/engine-context";
import { errorWords } from "../connection/error-words";
import { useText, type Words } from "../i18n/console-text";
import {
  type BrowserPush,
  type PushSetting,
  readPushSetting,
  turnPushOff,
  turnPushOn,
} from "./browser-push";
import { useConsolePush } from "./console-push";

const settingKey = ["webPush", "setting"] as const;

const sentenceKeys = {
  blocked: "console.push.blocked",
  off: "console.push.off",
  on: "console.push.on",
} as const;

function useSetting(push: BrowserPush) {
  const { client } = useEngine();
  const queries = useQueryClient();
  const setting = useQuery({
    queryKey: settingKey,
    queryFn: async ({ signal }) => readPushSetting({ push, client, signal }),
  });
  const change = useMutation({
    mutationFn: async (turn: "on" | "off") => {
      const context = { push, client, signal: AbortSignal.timeout(30_000) };
      return turn === "on" ? turnPushOn(context) : turnPushOff(context);
    },
    onSuccess: (next: PushSetting) => queries.setQueryData(settingKey, next),
  });
  return { setting, change };
}

// An engine refusal names its next step; anything else is the browser or its push service.
function failureWords(text: Words, error: Error): string {
  return "code" in error ? errorWords(text, error) : text("console.push.unavailable");
}

function Toggle(props: { readonly push: BrowserPush }): React.JSX.Element {
  const text = useText();
  const { setting, change } = useSetting(props.push);
  const kind = setting.data?.kind;
  const failure = change.error ?? setting.error;
  const isOn = kind === "on";
  return (
    <section
      aria-label={text("console.push.title")}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3 text-sm"
    >
      <p className="flex-1 text-muted-foreground">
        {text(sentenceKeys[kind ?? "off"])}
        {failure === null ? null : (
          <span role="alert" className="block text-destructive">
            {text("console.push.failed", { reason: failureWords(text, failure) })}
          </span>
        )}
      </p>
      {kind === undefined || kind === "blocked" ? null : (
        <Button
          variant="outline"
          size="sm"
          disabled={change.isPending}
          onClick={() => change.mutate(isOn ? "off" : "on")}
        >
          {isOn ? (
            <BellOffIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
          ) : (
            <BellIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
          )}
          {text(isOn ? "console.push.disable" : "console.push.enable")}
        </Button>
      )}
    </section>
  );
}

/**
 * The browser's notifications for cards (decision 0158): whether they are on, and the button
 * that turns them on or off. A device that cannot confirm, or a browser without the Push API,
 * sees nothing.
 */
export function PushToggle(): React.JSX.Element | null {
  const { push } = useConsolePush();
  const { ready } = useEngine();
  return push === undefined || !ready.scopes.includes("confirm") ? null : <Toggle push={push} />;
}
