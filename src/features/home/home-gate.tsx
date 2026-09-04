"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DemoWorkspace } from "../demo/demo-workspace";
import {
  readCompatibility,
  type CompatibilityStatus,
} from "../../webmcp/browser-compatibility";
import { WebMcpGuide } from "./webmcp-guide";

const GUIDE_HREF = "/?view=guide";

function noop() {}

/**
 * The checking state of the guide, with nothing browser-only in it. `HomeGate`
 * reads the query string, so the prerender stops at the Suspense boundary in
 * `app/page.tsx`; this renders the same first paint the gate itself would.
 */
export function HomeGateFallback() {
  return <WebMcpGuide onCheckAgain={noop} status={null} />;
}

export function HomeGate() {
  // Both view switches are `next/link`, so `?view=guide` and `?view=dashboard`
  // arrive as soft navigations that keep the layout's Scene store — and the
  // room — alive. Reading the query on every render is what makes them work:
  // a mount effect would only ever see the view the document loaded with.
  const view = useSearchParams().get("view");
  const guideRequested = view === "guide";
  // Claude Desktop and Claude Code reach the Scene through the local companion
  // rather than `document.modelContext`, so a browser without native WebMCP
  // still needs the workspace and its pairing controls.
  const dashboardRequested = view === "dashboard";

  // The server and the first client render agree on "checking", so the page
  // hydrates before any browser-only signal is read.
  const [status, setStatus] = useState<CompatibilityStatus | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of browser-only state that cannot exist before hydration
    setStatus(readCompatibility());
  }, []);

  const checkAgain = useCallback(() => {
    setStatus(readCompatibility());
  }, []);

  // Native WebMCP opens the dashboard on its own; everyone else may ask for it
  // explicitly, which is how a Claude-only browser reaches the pairing card.
  const showDashboard =
    !guideRequested && (status?.kind === "ready" || dashboardRequested);
  if (showDashboard) return <DemoWorkspace guideHref={GUIDE_HREF} />;

  return <WebMcpGuide onCheckAgain={checkAgain} status={status} />;
}
