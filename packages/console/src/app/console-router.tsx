import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import { ChatScreen } from "../screens/chat-screen";
import { ChecksScreen } from "../screens/checks-screen";
import { ConfirmationsScreen } from "../screens/confirmations-screen";
import { ConsoleShell } from "../screens/console-shell";
import { LedgerScreen } from "../screens/ledger-screen";
import { LimitsScreen } from "../screens/limits-screen";
import { LogsScreen } from "../screens/logs-screen";
import { OrdersScreen } from "../screens/orders-screen";
import { PluginsScreen } from "../screens/plugins-screen";
import { PortfolioScreen } from "../screens/portfolio-screen";
import { RulesScreen } from "../screens/rules-screen";
import { SafetyScreen } from "../screens/safety-screen";
import { SkillsScreen } from "../screens/skills-screen";
import { SystemLayout } from "../screens/system-layout";

function buildRouter(basepath: string) {
  const root = createRootRoute({ component: ConsoleShell });
  const parent = { getParentRoute: () => root };
  // The System section holds its pages under a layout of its own, with no path of its own.
  const system = createRoute({ ...parent, id: "system", component: SystemLayout });
  const inSystem = { getParentRoute: () => system };
  const routeTree = root.addChildren([
    createRoute({ ...parent, path: "/", component: ConfirmationsScreen }),
    createRoute({ ...parent, path: "/chat", component: ChatScreen }),
    createRoute({ ...parent, path: "/portfolio", component: PortfolioScreen }),
    createRoute({ ...parent, path: "/ledger", component: LedgerScreen }),
    createRoute({ ...parent, path: "/orders", component: OrdersScreen }),
    createRoute({ ...parent, path: "/limits", component: LimitsScreen }),
    createRoute({ ...parent, path: "/safety", component: SafetyScreen }),
    createRoute({ ...parent, path: "/rules", component: RulesScreen }),
    system.addChildren([
      createRoute({ ...inSystem, path: "/skills", component: SkillsScreen }),
      createRoute({ ...inSystem, path: "/plugins", component: PluginsScreen }),
      createRoute({ ...inSystem, path: "/logs", component: LogsScreen }),
      createRoute({ ...inSystem, path: "/checks", component: ChecksScreen }),
    ]),
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
