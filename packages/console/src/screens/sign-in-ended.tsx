import { Alert, AlertDescription } from "../components/ui/alert";
import { useEngine } from "../connection/engine-context";
import { useClientStatus } from "../connection/use-client-status";
import { MessageText, useText } from "../i18n/console-text";

/**
 * Says the sign-in ran out once the engine ended the connection with `auth.expired`: a Mini App's
 * ends 12 hours after it signed in (decision 0161), and the owner opens the console again from the
 * bot's button.
 */
export function SignInEnded(): React.JSX.Element | null {
  const text = useText();
  const { client } = useEngine();
  const state = useClientStatus(client);
  const status = client.status();
  const isExpired =
    state === "closed" &&
    status.state === "closed" &&
    "code" in status.error &&
    status.error.code === "auth.expired";
  return isExpired ? (
    <Alert>
      <AlertDescription>
        <MessageText text={text("console.session.expired")} />
      </AlertDescription>
    </Alert>
  ) : null;
}
