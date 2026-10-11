import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { useEngine } from "../connection/engine-context";
import { MessageText, useText } from "../i18n/console-text";

/** The first page: the browser is signed in, and the engine's state. */
export function HomeScreen(): React.JSX.Element {
  const text = useText();
  const { engine } = useEngine().ready;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{text("console.home.title")}</CardTitle>
        <CardDescription>{text("console.home.body", { version: engine.version })}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        <MessageText text={text("console.engine.state", { state: engine.state })} />
      </CardContent>
    </Card>
  );
}
