import { useEffect, useState } from "react";

import { MissionWorkspace } from "./MissionWorkspace";

function missionIdFromPath(pathname: string): string | undefined {
  const missionId = pathname.match(/^\/missions\/([^/]+)\/?$/)?.[1];
  return missionId === "new" ? undefined : missionId;
}

export function App() {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return <MissionWorkspace missionId={missionIdFromPath(pathname)} />;
}
