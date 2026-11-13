import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import { ChatScreen } from "../screens/chat-screen";
import { ConfirmationsScreen } from "../screens/confirmations-screen";
import { ConsoleShell } from "../screens/console-shell";
import { LedgerScreen } from "../screens/ledger-screen";
import { LimitsScreen } from "../screens/limits-screen";
import { PortfolioScreen } from "../screens/portfolio-screen";
import { RulesScreen } from "../screens/rules-screen";
import { SafetyScreen } from "../screens/safety-screen";
import { SkillsScreen } from "../screens/skills-screen";

function buildRouter(basepath: string) {
  const root = createRootRoute({ component: ConsoleShell });
  const parent = { getParentRoute: () => root };
  const routeTree = root.addChildren([
    createRoute({ ...parent, path: "/", component: ConfirmationsScreen }),
    createRoute({ ...parent, path: "/chat", component: ChatScreen }),
    createRoute({ ...parent, path: "/portfolio", component: PortfolioScreen }),
    createRoute({ ...parent, path: "/ledger", component: LedgerScreen }),
    createRoute({ ...parent, path: "/limits", component: LimitsScreen }),
    createRoute({ ...parent, path: "/safety", component: SafetyScreen }),
    createRoute({ ...parent, path: "/rules", component: RulesScreen }),
    createRoute({ ...parent, path: "/skills", component: SkillsScreen }),
  ]);
  return createRouter({ routeTree, basepath });
}

// The router type every typed `Link` checks its paths against.
type ConsoleRouter = ReturnType<typeof buildRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: ConsoleRouter;
  }
}

/** The signed-in console's screens, under `/` or, in the Mini App, under `/mini`. */
export function ConsoleRoutes(props: { readonly basepath: string }): React.JSX.Element {
  const [router] = useState(() => buildRouter(props.basepath));
  return <RouterProvider router={router} />;
}
