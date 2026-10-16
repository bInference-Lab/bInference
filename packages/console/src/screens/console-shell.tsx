import { Link, Outlet } from "@tanstack/react-router";
import { CircleIcon } from "lucide-react";
import { BrandLockup } from "../brand/brand-lockup";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { useEngine } from "../connection/engine-context";
import { useClientStatus } from "../connection/use-client-status";
import { useLiveTopics } from "../connection/use-live-topics";
import { MessageText, useText } from "../i18n/console-text";
import { NoticeArea } from "../notices/notice-area";
import { SignInEnded } from "./sign-in-ended";

// The console's sections, in the order the header shows them.
const sections = [
  { to: "/", key: "console.nav.confirmations" },
  { to: "/chat", key: "console.nav.chat" },
  { to: "/ledger", key: "console.nav.ledger" },
  { to: "/limits", key: "console.nav.limits" },
] as const;

const statusKeys = {
  idle: "console.status.connecting",
  connecting: "console.status.connecting",
  ready: "console.status.ready",
  closed: "console.status.closed",
} as const;

function ConnectionBadge(): React.JSX.Element {
  const text = useText();
  const state = useClientStatus(useEngine().client);
  const key = statusKeys[state];
  return (
    <Badge variant="outline" className="gap-1.5" render={<output />}>
      <CircleIcon
        aria-hidden
        strokeWidth={1.5}
        className={state === "ready" ? "fill-gain text-gain" : "text-muted-foreground"}
      />
      {text(key)}
    </Badge>
  );
}

/** The frame of every console screen: the brand, the sections, the connection. */
export function ConsoleShell(): React.JSX.Element {
  const text = useText();
  const { engine } = useEngine().ready;
  useLiveTopics();
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <BrandLockup className="h-6 w-auto text-foreground" />
          <span className="sr-only">{text("console.brand")}</span>
          <nav aria-label={text("console.nav.label")} className="flex gap-1">
            {sections.map((section) => (
              <Link
                key={section.to}
                to={section.to}
                className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground data-[status=active]:bg-accent data-[status=active]:text-foreground"
              >
                {text(section.key)}
              </Link>
            ))}
          </nav>
          <div className="ml-auto">
            <ConnectionBadge />
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
        {engine.state === "ready" ? null : (
          <Alert>
            <AlertDescription>
              <MessageText text={text("console.engine.state", { state: engine.state })} />
            </AlertDescription>
          </Alert>
        )}
        <SignInEnded />
        <NoticeArea />
        <Outlet />
      </main>
    </div>
  );
}
