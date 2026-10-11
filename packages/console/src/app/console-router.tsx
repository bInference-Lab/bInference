import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import { ConsoleShell } from "../screens/console-shell";
import { HomeScreen } from "../screens/home-screen";

function buildRouter(basepath: string) {
  const root = createRootRoute({ component: ConsoleShell });
  const home = createRoute({ getParentRoute: () => root, path: "/", component: HomeScreen });
  return createRouter({ routeTree: root.addChildren([home]), basepath });
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
