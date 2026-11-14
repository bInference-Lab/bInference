import { Link, Outlet, useMatchRoute } from "@tanstack/react-router";
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
import { useOnSystemPage } from "./system-layout";

// The console's sections, in the order the header shows them.
const sections = [
  { to: "/", key: "console.nav.confirmations" },
  { to: "/chat", key: "console.nav.chat" },
  { to: "/portfolio", key: "console.nav.portfolio" },
  { to: "/ledger", key: "console.nav.ledger" },
  { to: "/orders", key: "console.nav.orders" },
  { to: "/limits", key: "console.nav.limits" },
  { to: "/safety", key: "console.nav.safety" },
  { to: "/rules", key: "console.nav.rules" },
  { to: "/skills", key: "console.nav.system" },
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

// Scrolls the row of sections, where it scrolls sideways on a narrow screen, so the link of the
// section shown is in view. React calls it with each link that becomes the shown one.
function scrollIntoRow(link: HTMLAnchorElement | null): void {
  const row = link?.parentElement;
  if (link === null || row === null || row === undefined) {
    return;
  }
  const end = link.offsetLeft + link.offsetWidth;
  if (link.offsetLeft < row.scrollLeft) {
    row.scrollLeft = link.offsetLeft;
  } else if (end > row.scrollLeft + row.clientWidth) {
    row.scrollLeft = end - row.clientWidth;
  }
}

// The console's sections: one line beside the brand on a wide screen, a row of their own that
// scrolls sideways on a phone. The System entry stays marked on each of its pages.
function SectionsNav(): React.JSX.Element {
  const text = useText();
  const matchRoute = useMatchRoute();
  const onSystemPage = useOnSystemPage();
  return (
    <nav
      aria-label={text("console.nav.label")}
      className="relative order-last flex min-w-0 basis-full gap-1 overflow-x-auto [scrollbar-width:none] lg:order-none lg:flex-1 lg:basis-auto"
    >
      {sections.map((section) => {
        const shown =
          section.key === "console.nav.system"
            ? onSystemPage
            : matchRoute({ to: section.to }) !== false;
        return (
          <Link
            key={section.key}
            to={section.to}
            ref={shown ? scrollIntoRow : undefined}
            aria-current={shown ? "page" : undefined}
            data-status={shown ? "active" : undefined}
            className="shrink-0 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground data-[status=active]:bg-accent data-[status=active]:text-foreground"
          >
            {text(section.key)}
          </Link>
        );
      })}
    </nav>
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
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <BrandLockup className="h-6 w-auto text-foreground" />
          <span className="sr-only">{text("console.brand")}</span>
          <SectionsNav />
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
