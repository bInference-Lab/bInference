import { Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { BookOpenIcon, ListChecksIcon, PlugIcon, ScrollTextIcon } from "lucide-react";
import { useText } from "../i18n/console-text";

// The pages the System section holds, in the order its own nav shows them. Each keeps its route.
const systemPages = [
  { to: "/skills", key: "console.nav.skills", Icon: BookOpenIcon },
  { to: "/plugins", key: "console.nav.plugins", Icon: PlugIcon },
  { to: "/logs", key: "console.nav.logs", Icon: ScrollTextIcon },
  { to: "/checks", key: "console.nav.checks", Icon: ListChecksIcon },
] as const;

/** Whether the page shown is one of the System section's: the console's sections mark it. */
export function useOnSystemPage(): boolean {
  const matchRoute = useMatchRoute();
  return systemPages.some((page) => matchRoute({ to: page.to }) !== false);
}

/** The System section: its own nav of skills, plugins, logs and checks, above the page shown. */
export function SystemLayout(): React.JSX.Element {
  const text = useText();
  return (
    <>
      <nav
        aria-label={text("console.nav.systemPages")}
        className="flex gap-1 overflow-x-auto border-b pb-2 [scrollbar-width:none]"
      >
        {systemPages.map(({ to, key, Icon }) => (
          <Link
            key={to}
            to={to}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground data-[status=active]:bg-accent data-[status=active]:text-foreground"
          >
            <Icon aria-hidden strokeWidth={1.5} className="size-4" />
            {text(key)}
          </Link>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
