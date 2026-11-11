import { Alert, AlertDescription } from "../components/ui/alert";
import { MessageText, useText } from "../i18n/console-text";
import { errorWords } from "./error-words";

/**
 * Why a call did nothing, as the message under `wordsKey` writes the engine's error in its
 * `{reason}`; nothing while there is no error.
 */
export function FailedAlert(props: {
  readonly error: Error | null;
  readonly wordsKey: string;
}): React.JSX.Element | null {
  const text = useText();
  if (props.error === null) {
    return null;
  }
  return (
    <Alert variant="destructive">
      <AlertDescription>
        <MessageText text={text(props.wordsKey, { reason: errorWords(text, props.error) })} />
      </AlertDescription>
    </Alert>
  );
}
