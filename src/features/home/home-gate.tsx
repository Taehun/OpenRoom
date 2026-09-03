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
}

const CHECKING: HomeView = { status: null, guideRequested: false };

function readGuideRequested(): boolean {
  // `useSearchParams` would opt this page out of static rendering, and the
  // query string is only needed once the client is running anyway.
  return new URLSearchParams(window.location.search).get("view") === "guide";
}

export function HomeGate() {
  // The server and the first client render agree on "checking", so the page
  // hydrates before any browser-only signal is read.
  const [view, setView] = useState<HomeView>(CHECKING);

  useEffect(() => {
    const sync = () => {
      setView({
        status: readCompatibility(),
        guideRequested: readGuideRequested(),
      });
    };

    sync();

    // `/?view=guide` is the same route, so the App Router may keep this
    // component mounted across the navigation. popstate covers back and
    // forward; the Navigation API (Chromium, where WebMCP lives) covers the
    // pushState the Guide link performs.
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

  if (view.status?.kind === "ready" && !view.guideRequested) {
    return <DemoWorkspace guideHref={GUIDE_HREF} />;
  }

  return <WebMcpGuide onCheckAgain={checkAgain} status={view.status} />;
}
