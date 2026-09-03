import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import {
  WEBMCP_FLAG_URL,
  WEBMCP_MIN_CHROMIUM,
  type BrowserInfo,
  type CompatibilityStatus,
} from "../../webmcp/browser-compatibility";
import { CORE_TOOL_MANIFEST } from "../../webmcp/core-tool-manifest";
import { GitHubMark } from "./github-mark";
import { REPOSITORY_URL } from "./repository";
import styles from "./home.module.css";

const HERO_HEADING_ID = "openroom-heading";
/** The bar's jump target; `.connect` carries the sticky bar's scroll margin. */
const CONNECT_SECTION_ID = "connect-an-ai-app";
const CONNECT_HEADING_ID = "connect-an-ai-app-heading";

/**
 * The commands a reader copies to reach the local companion. `<repo>` is
 * literal text the reader replaces with their checkout path, and the copy
 * buttons write these strings verbatim.
 */
export const CONNECT_COMMANDS = {
  start: "pnpm mcp:openroom",
  claude: "claude mcp add openroom -- pnpm --silent --dir <repo> mcp:openroom",
  codex: "codex mcp add openroom -- pnpm --silent --dir <repo> mcp:openroom",
} as const;

const PAIR_STEP = "Type the six-digit code into the dashboard.";

type ConnectStep = { command: string } | { note: string };

interface ConnectCardContent {
  title: string;
  body: string | null;
  steps: ReadonlyArray<ConnectStep>;
}

const CONNECT_CARDS: ReadonlyArray<ConnectCardContent> = [
  {
    title: "ChatGPT & Codex app",
    body: "Open OpenRoom in the ChatGPT desktop app's browser. Nothing else to install.",
    steps: [],
  },
  {
    title: "Claude Code & Claude Desktop",
    body: null,
    steps: [
      { command: CONNECT_COMMANDS.start },
      { command: CONNECT_COMMANDS.claude },
      { note: PAIR_STEP },
    ],
  },
  {
    title: "Codex CLI",
    body: null,
    steps: [
      { command: CONNECT_COMMANDS.start },
      { command: CONNECT_COMMANDS.codex },
      { note: PAIR_STEP },
    ],
  },
];

function describeBrowser(browser: BrowserInfo): string {
  return `${browser.brand} ${browser.version ?? "an unknown version"}`;
}

interface BannerContent {
  title: string;
  body: string | null;
}

function bannerContent(status: CompatibilityStatus | null): BannerContent {
  if (status === null) return { title: "Checking your browser…", body: null };

  switch (status.kind) {
    case "ready":
      return { title: "Ready — WebMCP detected", body: null };
    case "flag-required":
      return {
        title: `Needs a flag in ${describeBrowser(status.browser)}`,
        body: "Enable WebMCP for testing, relaunch, then check again.",
      };
    case "update-required":
      return {
        title: `Update Chrome to ${WEBMCP_MIN_CHROMIUM} or newer`,
        body: `You are on ${describeBrowser(status.browser)}.`,
      };
    case "unsupported-browser":
      return {
        title: `Not available in ${status.browser.brand}`,
        body: `Use Google Chrome ${WEBMCP_MIN_CHROMIUM} or newer.`,
      };
    case "insecure-context":
      return {
        title: "Needs HTTPS or localhost",
        body: "Open this page over HTTPS or on http://localhost.",
      };
  }
}

/** One body-small line of facts, never a table. */
function bannerFacts(status: CompatibilityStatus): string {
  const context =
    status.kind === "insecure-context" ? "insecure context" : "secure context";
  return `${describeBrowser(status.browser)} · ${context}`;
}

/** Outlined 24px glyphs in the same stroke language as the workspace icons. */
function BannerIcon({ ready }: { ready: boolean }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={24}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.7}
      viewBox="0 0 24 24"
      width={24}
    >
      <circle cx="12" cy="12" r="9" />
      {ready ? (
        <path d="m8.2 12.4 2.6 2.6 5-5.4" />
      ) : (
        <>
          <path d="M12 11.2v4.6" />
          <circle cx="12" cy="8.2" fill="currentColor" r="0.9" stroke="none" />
        </>
      )}
    </svg>
  );
}

interface CopyButtonProps {
  className: string;
  describedBy?: string | undefined;
  label: string;
  text: string;
}

function CopyButton({ className, describedBy, label, text }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      aria-describedby={describedBy}
      className={className}
      onClick={() => {
        // Clipboard access is absent on insecure origins and can be denied.
        try {
          const written = navigator.clipboard?.writeText(text);
          if (!written) return;
          written.then(
            () => setCopied(true),
            () => undefined,
          );
        } catch {
          // Leave the label untouched; the command stays selectable.
        }
      }}
      type="button"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function StatusBanner({
  onCheckAgain,
  status,
}: {
  onCheckAgain: () => void;
  status: CompatibilityStatus | null;
}) {
  const { title, body } = bannerContent(status);

  return (
    <section aria-label="WebMCP in this browser" className="md-banner">
      <span className="md-banner-icon">
        <BannerIcon ready={status?.kind === "ready"} />
      </span>
      <p className="md-banner-title" role="status">
        {title}
      </p>
      {body === null ? null : <p className="md-banner-body">{body}</p>}
      {status?.kind === "flag-required" ? (
        <p className={styles.bannerCode}>
          <code className="md-code">{WEBMCP_FLAG_URL}</code>
        </p>
      ) : null}
      {status === null ? null : (
        <p className={styles.bannerFacts}>{bannerFacts(status)}</p>
      )}
      {status === null ? null : (
        <div className="md-banner-actions">
          {status.kind === "ready" ? (
            // eslint-disable-next-line @next/next/no-html-link-for-pages -- same-route query switch must reload: a soft navigation leaves this guide on screen without the Chromium Navigation API.
            <a className="md-button md-button--filled" href="/?view=dashboard">
              Open the dashboard
            </a>
          ) : (
            <>
              {status.kind === "flag-required" ? (
                <CopyButton
                  className="md-button md-button--tonal"
                  label="Copy flag address"
                  text={WEBMCP_FLAG_URL}
                />
              ) : null}
              <button
                className="md-button md-button--text"
                onClick={onCheckAgain}
                type="button"
              >
                Check again
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function ConnectCard({ card }: { card: ConnectCardContent }) {
  const baseId = useId();
  const titleId = `${baseId}-title`;

  return (
    <article
      aria-labelledby={titleId}
      className={`md-card md-card--outlined ${styles.connectCard}`}
    >
      <h3 className={styles.connectTitle} id={titleId}>
        {card.title}
      </h3>
      {card.body === null ? null : (
        <p className={styles.connectBody}>{card.body}</p>
      )}
      {card.steps.length === 0 ? null : (
        <ol className={styles.steps}>
          {card.steps.map((step, index) =>
            "command" in step ? (
              // The row is a span so the `li` keeps its `list-item` display
              // and its ordinal marker.
              <li key={step.command}>
                <span className={styles.commandRow}>
                  <code className="md-code" id={`${baseId}-${index}`}>
                    {step.command}
                  </code>
                  <CopyButton
                    className={`md-button md-button--text md-button--dense ${styles.stepCopy}`}
                    describedBy={`${baseId}-${index}`}
                    label="Copy"
                    text={step.command}
                  />
                </span>
              </li>
            ) : (
              <li key={step.note}>{step.note}</li>
            ),
          )}
        </ol>
      )}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- same-route query switch must reload: a soft navigation leaves this guide on screen without the Chromium Navigation API. */}
      <a
        className={`md-button md-button--text ${styles.connectLink}`}
        href="/?view=dashboard"
      >
        Open the dashboard
      </a>
    </article>
  );
}

interface WebMcpGuideProps {
  onCheckAgain: () => void;
  status: CompatibilityStatus | null;
}

export function WebMcpGuide({ onCheckAgain, status }: WebMcpGuideProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    // A hash target or a restored scroll position means the page can already
    // be scrolled before the first scroll event ever fires.
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className={styles.page}>
      <header
        className={`md-top-app-bar ${styles.appBar}`}
        data-scrolled={scrolled ? "true" : "false"}
      >
        <div className={styles.appBarInner}>
          <span className="md-wordmark">OpenRoom</span>
          <div className={styles.appBarActions}>
            <a
              className="md-button md-button--text"
              href={`#${CONNECT_SECTION_ID}`}
            >
              Connect an AI app
            </a>
            <a
              aria-label="OpenRoom on GitHub"
              className="md-icon-button"
              href={REPOSITORY_URL}
              rel="noopener noreferrer"
              target="_blank"
              title="View on GitHub"
            >
              <GitHubMark />
            </a>
          </div>
        </div>
      </header>

      <main className={styles.guide}>
        <section aria-labelledby={HERO_HEADING_ID} className={styles.hero}>
          <div className={styles.heroCopy}>
            <h1 className={styles.heroTitle} id={HERO_HEADING_ID}>
              OpenRoom
            </h1>
            <p className={styles.heroTagline}>
              AI Room Planner &amp; Furniture Shopping
            </p>
            <p className={styles.heroLede}>
              {"Furnish a real room photo with catalog products — by hand, or through the AI app you already use."}
            </p>
            <Link
              className={`md-button md-button--filled ${styles.heroAction}`}
              href="/demo"
            >
              Open the demo
            </Link>
          </div>

          <figure className={styles.heroRoom}>
            <Image
              alt="Approximate living room visualization with a cream sofa, oak coffee table, woven rug, floor lamp, chair, and potted plant."
              fill
              priority
              sizes="(min-width: 900px) 46vw, 100vw"
              src="/demo/openroom-room.png"
            />
          </figure>
        </section>

        <StatusBanner onCheckAgain={onCheckAgain} status={status} />

        <section
          aria-labelledby={CONNECT_HEADING_ID}
          className={styles.connect}
          id={CONNECT_SECTION_ID}
        >
          <h2 className={styles.sectionTitle} id={CONNECT_HEADING_ID}>
            Connect an AI app
          </h2>
          <div className={styles.connectGrid}>
            {CONNECT_CARDS.map((card) => (
              <ConnectCard card={card} key={card.title} />
            ))}
          </div>
        </section>

        <div className={styles.moreInfo}>
          <details className={styles.disclosure}>
            <summary className={styles.summary}>What an agent can do</summary>
            <ul className={styles.toolList}>
              {CORE_TOOL_MANIFEST.map((tool) => (
                <li key={tool.name}>
                  <code className="md-code">{tool.name}</code>
                  <span>{`— ${tool.description}`}</span>
                </li>
              ))}
            </ul>
          </details>

          <details className={styles.disclosure}>
            <summary className={styles.summary}>
              Shopping with your agent
            </summary>
            <p className={styles.disclosureBody}>
              {"In Shopify mode, add_scene_to_cart returns Shopify merchandise lines and the store's token-free Storefront MCP endpoint, so the agent you already use can finish the cart."}
            </p>
            <a
              className={styles.textLink}
              href={`${REPOSITORY_URL}#commerce-integration`}
              rel="noreferrer"
              target="_blank"
            >
              Commerce integration in the README
            </a>
          </details>

          <details className={styles.disclosure}>
            <summary className={styles.summary}>Open source</summary>
            <p className={styles.disclosureBody}>
              {"OpenRoom is MIT-licensed: the deterministic solver, the photo compositor, and the WebMCP tools are all in the repository."}
            </p>
            <a
              className={styles.textLink}
              href={REPOSITORY_URL}
              rel="noreferrer"
              target="_blank"
            >
              Taehun/OpenRoom on GitHub
            </a>
          </details>
        </div>
      </main>
    </div>
  );
}
