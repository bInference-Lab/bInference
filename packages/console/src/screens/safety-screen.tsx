import { useEngine } from "../connection/engine-context";
import { useAgents } from "../connection/use-agents";
import { useText } from "../i18n/console-text";
import { FreezeSection } from "../safety/freeze-section";
import { RescueSection } from "../safety/rescue-section";
import { useSafetyStatus } from "../safety/use-safety-status";
import { ScreenState } from "./screen-state";

/**
 * The brakes in the console and the Mini App (decisions 0089 and 0128): the freeze of every agent
 * or of one, the unfreeze card that waits for a tap, and the rescue card with the rescue address
 * in effect, as `safety/status` reads them.
 */
export function SafetyScreen(): React.JSX.Element {
  const text = useText();
  const { ready } = useEngine();
  const status = useSafetyStatus();
  const agents = useAgents()?.filter((agent) => agent.archivedAt === undefined);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{text("console.safety.title")}</h1>
      <p className="text-sm text-muted-foreground">{text("console.safety.intro")}</p>
      {ready.scopes.includes("confirm") ? null : (
        <p className="text-sm text-muted-foreground">{text("console.safety.noScope")}</p>
      )}
      {status.data === undefined || agents === undefined ? (
        <ScreenState error={status.error} />
      ) : (
        <>
          <FreezeSection status={status.data} agents={agents} />
          <RescueSection status={status.data} />
        </>
      )}
    </section>
  );
}
