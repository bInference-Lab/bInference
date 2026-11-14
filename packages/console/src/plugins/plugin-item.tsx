import { displayOutsideText } from "@binference/i18n";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { FailedAlert } from "../connection/failed-alert";
import { MessageText, useFormatter, useText } from "../i18n/console-text";
import { PluginDeclarations } from "./plugin-declarations";
import { PluginSwitch } from "./plugin-switch";
import type { PluginView, useSwitchPlugin } from "./use-plugins";

// A publisher's name is shown whole within the review's bound (decision 0348).
const publisherChars = 200;

// Why it does not run: the owner, crashes or changed files, and where it stands with its listing.
function Standing(props: { readonly view: PluginView }): React.JSX.Element {
  const text = useText();
  const { disabledReason, listing, state } = props.view;
  return (
    <>
      {state === "disabled" && disabledReason !== undefined ? (
        <p>{text("console.plugins.offReason", { reason: disabledReason })}</p>
      ) : null}
      {listing === undefined ? null : (
        <p>{text("console.plugins.listing", { state: listing.state })}</p>
      )}
    </>
  );
}

// Where it came from: npm's provenance, its publisher, its source and the pin of its files.
function Origin(props: { readonly view: PluginView }): React.JSX.Element {
  const text = useText();
  const formatter = useFormatter();
  const { provenance, publisher, source, hash, installedAt } = props.view;
  return (
    <>
      {provenance === undefined ? null : (
        <p>{text("console.plugins.provenance", { provenance })}</p>
      )}
      {publisher === undefined ? null : (
        <p>
          {text("console.plugins.publisher", {
            publisher: displayOutsideText(publisher, publisherChars),
          })}
        </p>
      )}
      <p className="break-all text-muted-foreground">
        <MessageText text={text("console.plugins.source", { source, hash })} />
      </p>
      <p className="text-muted-foreground">
        {text("console.plugins.added", { at: formatter.dateTime(installedAt) })}
      </p>
    </>
  );
}

// What the engine answered the last switch of this plugin: on, or off, as it stands now.
function Switched(props: {
  readonly view: PluginView;
  readonly change: ReturnType<typeof useSwitchPlugin>;
}): React.JSX.Element | null {
  const text = useText();
  const answered = props.change.data;
  if (answered === undefined || answered.plugin !== props.view.plugin) {
    return null;
  }
  return (
    <output className="text-sm">
      {text("console.plugins.switched", { state: answered.state, name: answered.name })}
    </output>
  );
}

/**
 * One installed plugin (decisions 0348 to 0351 and 0433 to 0435): its name, version, tier and
 * whether it is on; why it is off, and where it stands with its listing where one is needed; what
 * it declares, its provenance, publisher, source and pin; and its switch. The engine decides a
 * switch, and its answer or refusal shows in its words.
 */
export function PluginItem(props: {
  readonly view: PluginView;
  readonly change: ReturnType<typeof useSwitchPlugin>;
}): React.JSX.Element {
  const text = useText();
  const { view, change } = props;
  const failure = change.variables?.plugin === view.plugin ? change.error : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span className="break-all">{view.name}</span>
          <span className="font-normal text-muted-foreground">{view.version}</span>
          <Badge variant="outline">{text("console.plugins.tier", { tier: view.tier })}</Badge>
          <Badge variant={view.state === "enabled" ? "default" : "outline"}>
            {text("console.plugins.state", { state: view.state })}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <Standing view={view} />
        <PluginDeclarations view={view} />
        <Origin view={view} />
        <Switched view={view} change={change} />
        <FailedAlert error={failure} wordsKey="console.plugins.failed" />
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <PluginSwitch view={view} change={change} />
      </CardFooter>
    </Card>
  );
}
