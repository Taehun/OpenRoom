import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { CoreToolName } from "../../webmcp/tool-contracts";
import {
  WEBMCP_FLAG_URL,
  WEBMCP_MIN_CHROMIUM,
  WEBMCP_ORIGIN_TRIAL_CHROME,
  type BrowserInfo,
  type CompatibilityStatus,
} from "../../webmcp/browser-compatibility";
import styles from "./home.module.css";

/** Copied from `src/webmcp/core-tool-manifest.ts`; keep both in step. */
const CORE_TOOLS: ReadonlyArray<{
  name: CoreToolName;
  description: string;
}> = [
  {
    name: "get_scene",
    description:
      "Return the current validated Scene; each object includes a derived unit facing vector {x, z} ({x:0,z:1} faces the camera side).",
  },
  {
    name: "get_selection",
    description:
      "Return the currently selected Scene object, including its derived unit facing vector {x, z} ({x:0,z:1} faces the camera side).",
  },
  {
    name: "search_products",
    description: "Search the local product catalog in deterministic order.",
  },
  {
    name: "replace_object",
    description:
      "Replace an explicit or selected Scene object with a catalog product.",
  },
  {
    name: "move_object",
    description:
      "Move an explicit or selected Scene object; orient it with rotationYDegrees or a facing vector {x, z}.",
  },
  {
    name: "add_scene_to_cart",
    description: "Open a local approval draft for product-backed Scene objects.",
  },
];

function describeBrowser(browser: BrowserInfo): string {
  return `${browser.brand} ${browser.version ?? "an unknown version"}`;
}

function statusMessage(status: CompatibilityStatus | null): string {
  if (status === null) return "Checking your browser…";

  switch (status.kind) {
    case "ready":
      return "WebMCP detected. Opening the dashboard.";
    case "flag-required":
      return `WebMCP is available in ${describeBrowser(status.browser)} once the flag is enabled.`;
    case "update-required":
      return `WebMCP needs Chromium ${WEBMCP_MIN_CHROMIUM} or newer; you are on ${describeBrowser(status.browser)}.`;
    case "unsupported-browser":
      return `WebMCP is not available in ${status.browser.brand}; use Google Chrome ${WEBMCP_MIN_CHROMIUM} or newer.`;
    case "insecure-context":
      return "WebMCP is only exposed on secure pages; open OpenInterior over HTTPS or on localhost.";
  }
}

function CopyFlagAddress() {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      className={styles.copyButton}
      onClick={() => {
        // Clipboard access is absent on insecure origins and can be denied.
        try {
          const written = navigator.clipboard?.writeText(WEBMCP_FLAG_URL);
          if (!written) return;
          written.then(
            () => setCopied(true),
            () => undefined,
          );
        } catch {
          // Leave the label untouched; the address stays selectable.
        }
      }}
      type="button"
    >
      {copied ? "Copied" : "Copy flag address"}
    </button>
  );
}

function FlagInstructions({ browser }: { browser: BrowserInfo }) {
  return (
    <>
      <ol className={styles.steps}>
        <li>
          <span>Open the flag address in a new tab:</span>
          <span className={styles.flagRow}>
            <code className={styles.code}>{WEBMCP_FLAG_URL}</code>
            <CopyFlagAddress />
          </span>
        </li>
        <li>Set WebMCP for testing to Enabled.</li>
        <li>Relaunch the browser. Refreshing this tab is not enough.</li>
        <li>Come back here and choose Check again.</li>
      </ol>
      <p className={styles.note}>
        {`From Chrome ${WEBMCP_ORIGIN_TRIAL_CHROME} the origin trial removes the flag requirement.`}
      </p>
      {browser.verified ? null : (
        <p className={styles.note}>
          Verified on Google Chrome; other Chromium browsers may differ.
        </p>
      )}
    </>
  );
}

function Instructions({ status }: { status: CompatibilityStatus }) {
  switch (status.kind) {
    case "ready":
      return null;
    case "flag-required":
      return <FlagInstructions browser={status.browser} />;
    case "update-required":
      return (
        <p className={styles.instruction}>
          {`Update Google Chrome, or install Chrome Canary, Dev, or Beta (${WEBMCP_MIN_CHROMIUM} or newer), then return here.`}
        </p>
      );
    case "unsupported-browser":
      return (
        <p className={styles.instruction}>
          {`Install Google Chrome ${WEBMCP_MIN_CHROMIUM} or newer. Firefox and Safari do not expose WebMCP today.`}
        </p>
      );
    case "insecure-context":
      return (
        <p className={styles.instruction}>
          {"Open this page over HTTPS or on http://localhost, then choose Check again."}
        </p>
      );
  }
}

interface WebMcpGuideProps {
  onCheckAgain: () => void;
  status: CompatibilityStatus | null;
}

export function WebMcpGuide({ onCheckAgain, status }: WebMcpGuideProps) {
  return (
    <main className={styles.guide}>
      <section className={styles.hero} aria-labelledby="openinterior-heading">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>
            Open-source spatial commerce for WebMCP agents
          </p>
          <h1 id="openinterior-heading">The room becomes the storefront.</h1>
          <p className={styles.intro}>
            {"OpenInterior turns a room photo into a storefront that both people and AI agents can edit. This browser has not exposed WebMCP yet, so here is how to get it running, and how to try the demo without it."}
          </p>
        </div>

        <figure className={styles.heroRoom}>
          <Image
            alt="Approximate living room visualization with a cream sofa, oak coffee table, woven rug, floor lamp, chair, and potted plant."
            fill
            priority
            sizes="(min-width: 900px) 46vw, 100vw"
            src="/demo/openinterior-room.png"
          />
        </figure>
      </section>

      <section className={styles.card} aria-labelledby="webmcp-compat-heading">
        <h2 id="webmcp-compat-heading">WebMCP compatibility</h2>
        <p className={styles.status} role="status">
          {statusMessage(status)}
        </p>

        {status === null ? null : (
          <>
            <dl className={styles.facts}>
              <div>
                <dt>Detected browser</dt>
                <dd>{describeBrowser(status.browser)}</dd>
              </div>
              <div>
                <dt>Secure context</dt>
                <dd>{status.kind === "insecure-context" ? "no" : "yes"}</dd>
              </div>
            </dl>
            <Instructions status={status} />
            <button
              className={styles.checkButton}
              onClick={onCheckAgain}
              type="button"
            >
              Check again
            </button>
            <p className={styles.companionNote}>
              Using Claude Desktop or Claude Code?{" "}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
                  same-route query switch must reload: a soft navigation leaves
                  this guide on screen without the Chromium Navigation API. */}
              <a className={styles.inlineLink} href="/?view=dashboard">
                Open the dashboard
              </a>{" "}
              and pair with the local companion.
            </p>
          </>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="webmcp-tools-heading">
        <h2 id="webmcp-tools-heading">What an agent can do here</h2>
        <ul className={styles.toolList}>
          {CORE_TOOLS.map((tool) => (
            <li key={tool.name}>
              <code className={styles.code}>{tool.name}</code>
              <span>{tool.description}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.panel} aria-labelledby="webmcp-demo-heading">
        <h2 id="webmcp-demo-heading">Try it without an agent</h2>
        <p>
          {"The human editor works in any modern browser; WebMCP only adds the agent tools."}
        </p>
        <Link className={styles.demoLink} href="/demo">
          Open the demo
        </Link>
      </section>

      <section className={styles.panel} aria-labelledby="webmcp-shop-heading">
        <h2 id="webmcp-shop-heading">Shop with your agent</h2>
        <p>
          {"In Shopify mode, add_scene_to_cart returns Shopify merchandise lines and the store's Storefront MCP endpoint (https://your-store.myshopify.com/api/mcp), which needs no token. Connect Claude, ChatGPT, or any MCP client to that endpoint and let it call update_cart and get_cart."}
        </p>
        <p className={styles.note}>
          {'See README.md, section "Commerce integration".'}
        </p>
      </section>

      <section className={styles.panel} aria-labelledby="webmcp-source-heading">
        <h2 id="webmcp-source-heading">Open source</h2>
        <p>
          {"OpenInterior is MIT-licensed. The source in this repository includes the deterministic solver, the photo compositor, and the WebMCP tools."}
        </p>
      </section>
    </main>
  );
}
