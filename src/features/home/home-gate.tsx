"use client";

import { useCallback, useEffect, useState } from "react";
import { DemoWorkspace } from "../demo/demo-workspace";
import {
  readCompatibility,
  type CompatibilityStatus,
} from "../../webmcp/browser-compatibility";
import { WebMcpGuide } from "./webmcp-guide";

const GUIDE_HREF = "/?view=guide";

interface HomeView {
  /** null until the mount effect has read the browser. */
  status: CompatibilityStatus | null;
  /** The reader asked for the guide even though WebMCP is available. */
  guideRequested: boolean;
  /**
   * The reader asked for the dashboard. Claude Desktop and Claude Code reach
   * the Scene through the local companion rather than `document.modelContext`,
   * so a browser without native WebMCP still needs the workspace and its
   * pairing controls.
   */
  dashboardRequested: boolean;
}

const CHECKING: HomeView = {
  status: null,
  guideRequested: false,
  dashboardRequested: false,
};

function readRequestedView(): Pick<
  HomeView,
  "guideRequested" | "dashboardRequested"
> {
  // `useSearchParams` would opt this page out of static rendering, and the
  // query string is only needed once the client is running anyway.
  const view = new URLSearchParams(window.location.search).get("view");
  return {
    guideRequested: view === "guide",
    dashboardRequested: view === "dashboard",
  };
}

export function HomeGate() {
  // The server and the first client render agree on "checking", so the page
  // hydrates before any browser-only signal is read.
  const [view, setView] = useState<HomeView>(CHECKING);

  useEffect(() => {
    const sync = () => {
      setView({ status: readCompatibility(), ...readRequestedView() });
    };

    sync();

    // `/?view=guide` and `/?view=dashboard` are the same route, so the App
    // Router may keep this component mounted across the navigation. popstate
    // covers back and forward; the Navigation API (Chromium, where WebMCP
    // lives) covers the pushState the Guide and dashboard links perform.
    const navigation = (window as Window & { navigation?: EventTarget })
      .navigation;
    window.addEventListener("popstate", sync);
    navigation?.addEventListener("navigatesuccess", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      navigation?.removeEventListener("navigatesuccess", sync);
    };
  }, []);

  const checkAgain = useCallback(() => {
    setView((current) => ({ ...current, status: readCompatibility() }));
  }, []);

  // Native WebMCP opens the dashboard on its own; everyone else may ask for it
  // explicitly, which is how a Claude-only browser reaches the pairing card.
  const showDashboard =
    !view.guideRequested &&
    (view.status?.kind === "ready" || view.dashboardRequested);
  if (showDashboard) return <DemoWorkspace guideHref={GUIDE_HREF} />;

  return <WebMcpGuide onCheckAgain={checkAgain} status={view.status} />;
}
