import Image from "next/image";
import Link from "next/link";
import {
  Fragment,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
} from "react";
import {
  WEBMCP_FLAG_URL,
  WEBMCP_MIN_CHROMIUM,
  type BrowserInfo,
  type CompatibilityStatus,
} from "../../webmcp/browser-compatibility";
import type { CoreToolName } from "../../webmcp/tool-contracts";
import { GitHubMark } from "./github-mark";
import { REPOSITORY_URL } from "./repository";
import styles from "./home.module.css";

const HERO_HEADING_ID = "openroom-heading";
/** The bar's jump target; `.connect` carries the sticky bar's scroll margin. */
const CONNECT_SECTION_ID = "connect-an-ai-app";
const CONNECT_HEADING_ID = "connect-an-ai-app-heading";

/**
 * What a reader copies to reach the local companion: two `mcp add` commands,
 * the Claude Desktop config block that has no command to run, and the log to
 * tail. `<repo>` is literal text the reader replaces with their checkout path,
 * and the copy buttons write these strings verbatim.
 *
 * The client starts the companion itself, so there is no separate command to
 * run first: a second companion in a terminal either fails with `EADDRINUSE`
 * or prints a code for a relay no client is attached to. The client also owns
 * the companion's stderr, which is where the pair code lands, so every entry
 * wraps it in `sh -c` and appends stderr to a log the reader can `tail`. See
 * `docs/local-mcp.md`.
 */
export const CONNECT_COMMANDS = {
  claude:
    'claude mcp add --transport stdio openroom -- sh -c \'exec pnpm --silent --dir <repo> mcp:openroom 2>>"$HOME/openroom-mcp.log"\'',
  claudeDesktop: `{
  "mcpServers": {
    "openroom": {
      "command": "sh",
      "args": ["-c", "exec pnpm --silent --dir <repo> mcp:openroom 2>>\\"$HOME/openroom-mcp.log\\""]
    }
  }
}`,
  codex:
    'codex mcp add openroom -- sh -c \'exec pnpm --silent --dir <repo> mcp:openroom 2>>"$HOME/openroom-mcp.log"\'',
  log: "tail -f ~/openroom-mcp.log",
} as const;

/** Every companion card needs the repository on disk before anything runs. */
const CHECKOUT_NOTE = `Needs a local checkout: git clone ${REPOSITORY_URL}, then pnpm install. Replace <repo> below with that folder.`;

const PAIR_STEP =
  "Start a chat. Your app launches OpenRoom's companion, which writes a six-digit code to the log. In the demo, press Connect an AI app, enter the code, and press Connect.";

/**
 * A step is a command to run, a config block to paste, a plain instruction, or
 * this page's own address — which only the browser knows, so it is a marker
 * here and resolved at render time.
 */
type ConnectStep =
  | { command: string }
  | { config: string }
  | { note: string }
  | { address: true };

interface ConnectCardContent {
  title: string;
  body: string | null;
  steps: ReadonlyArray<ConnectStep>;
}

const CONNECT_CARDS: ReadonlyArray<ConnectCardContent> = [
  {
    title: "ChatGPT or Codex app",
    body: "Open OpenRoom inside the app's built-in browser. Nothing to install.",
    steps: [
      { note: "In the app, open its browser and paste this address:" },
      { address: true },
      { note: "Start a chat. The app finds OpenRoom's tools on its own." },
    ],
  },
  {
    title: "Claude Code",
    body: CHECKOUT_NOTE,
    steps: [
      { command: CONNECT_COMMANDS.claude },
      { command: CONNECT_COMMANDS.log },
      { note: PAIR_STEP },
    ],
  },
  {
    // Claude Desktop has no `mcp add`; the same server is registered by hand.
    title: "Claude Desktop",
    body: `Add this to claude_desktop_config.json (Settings > Developer > Edit Config). ${CHECKOUT_NOTE}`,
    steps: [
      { config: CONNECT_COMMANDS.claudeDesktop },
      { command: CONNECT_COMMANDS.log },
      { note: PAIR_STEP },
    ],
  },
  {
    title: "Codex CLI",
    body: CHECKOUT_NOTE,
    steps: [
      { command: CONNECT_COMMANDS.codex },
      { command: CONNECT_COMMANDS.log },
      { note: PAIR_STEP },
    ],
  },
];

/**
 * The six Core tools, in the words a shopper reads. The manifest's technical
 * descriptions stay in the tool contracts for the AI app; people get a verb.
 */
const TOOL_SUMMARIES: ReadonlyArray<{ name: CoreToolName; summary: string }> =
  [
    { name: "get_scene", summary: "See the room and every piece in it" },
    { name: "get_selection", summary: "Know which piece you have selected" },
    {
      name: "search_products",
      summary: "Search the catalog by style, colour, or material",
    },
    { name: "replace_object", summary: "Swap any piece for a catalog product" },
    {
      name: "move_object",
      summary: "Move or turn a piece (lamps can sit on tables)",
    },
    {
      name: "add_scene_to_cart",
      summary: "Prepare the room's products for your approval",
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
        body:
          "Paste this address into the address bar, set “WebMCP for testing” to Enabled, relaunch, then check again.",
      };
    case "update-required":
      // The facts line under the banner already names the browser and its
      // version, so a body would say it twice.
      return {
        title: `Update Chrome to ${WEBMCP_MIN_CHROMIUM} or newer`,
        body: null,
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

/**
 * One body-small line of facts, never a table. The context is not named: every
 * page but the insecure one is secure, and that one says so in its title.
 */
function bannerFacts(status: CompatibilityStatus): string {
  return describeBrowser(status.browser);
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
  /** Accessible name when several buttons share the same visible label. */
  accessibleLabel?: string | undefined;
  className: string;
  describedBy?: string | undefined;
  /** Held down while the text to copy is still unknown. */
  disabled?: boolean | undefined;
  label: string;
  text: string;
}

function CopyButton({
  accessibleLabel,
  className,
  describedBy,
  disabled,
  label,
  text,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <>
    <button
      aria-describedby={describedBy}
      aria-label={accessibleLabel}
      className={className}
      disabled={disabled}
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
    {/* The label change alone is not announced; this is. */}
    <span aria-atomic="true" aria-live="polite" className={styles.srOnly}>
      {copied ? "Copied to the clipboard" : ""}
    </span>
    </>
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
      {/* An unsupported browser gets no actions: "Check again" cannot ever
          succeed there, and the body already names the browser to install. */}
      {status === null || status.kind === "unsupported-browser" ? null : (
        <div className="md-banner-actions">
          {status.kind === "ready" ? (
            // eslint-disable-next-line @next/next/no-html-link-for-pages -- same-route query switch must reload: a soft navigation leaves this guide on screen without the Chromium Navigation API.
            <a className="md-button md-button--filled" href="/?view=dashboard">
              Open the demo
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

const STEP_COPY_CLASS = `md-button md-button--text md-button--dense ${styles.stepCopy}`;

/** The origin never changes while the document is alive. */
const subscribeToOrigin = () => () => undefined;
const getOriginSnapshot = () => window.location.origin;
const getServerOriginSnapshot = () => null;

function ConnectCard({ card }: { card: ConnectCardContent }) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  // Only the browser knows where this page is served from, and the address a
  // reader must paste is the one they are already on. The server render says
  // so in words rather than guessing a host, and the hydrated page fills it in.
  const origin = useSyncExternalStore(
    subscribeToOrigin,
    getOriginSnapshot,
    getServerOriginSnapshot,
  );

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
          {card.steps.map((step, index) => {
            const stepId = `${baseId}-${index}`;

            // The row is a span so the `li` keeps its `list-item` display and
            // its ordinal marker.
            if ("command" in step)
              return (
                <li key={stepId}>
                  <span className={styles.commandRow}>
                    <code className="md-code" id={stepId}>
                      {/* One span per token, so a line breaks between tokens
                          before it breaks inside `--silent` or
                          `openroom-mcp.log`; the text is unchanged and the
                          Copy button still writes the exact command. */}
                      {step.command.split(" ").map((token, tokenIndex) => (
                        <Fragment key={tokenIndex}>
                          {tokenIndex > 0 ? " " : null}
                          <span className={styles.commandToken}>{token}</span>
                        </Fragment>
                      ))}
                    </code>
                    <CopyButton
                      accessibleLabel={`Copy ${card.title} command ${index + 1}`}
                      className={STEP_COPY_CLASS}
                      describedBy={stepId}
                      label="Copy"
                      text={step.command}
                    />
                  </span>
                </li>
              );

            // JSON carries its own line breaks and the code box keeps them
            // (`white-space: pre-wrap`), so a config needs no token split.
            if ("config" in step)
              return (
                <li key={stepId}>
                  <span className={styles.commandRow}>
                    <code className="md-code" id={stepId}>
                      {step.config}
                    </code>
                    <CopyButton
                      accessibleLabel={`Copy the ${card.title} configuration`}
                      className={STEP_COPY_CLASS}
                      describedBy={stepId}
                      label="Copy"
                      text={step.config}
                    />
                  </span>
                </li>
              );

            if ("address" in step)
              return (
                <li key={stepId}>
                  <span className={styles.commandRow}>
                    <code className="md-code" id={stepId}>
                      {origin ?? "this page's address"}
                    </code>
                    <CopyButton
                      accessibleLabel="Copy the OpenRoom address"
                      className={STEP_COPY_CLASS}
                      describedBy={stepId}
                      disabled={origin === null}
                      label="Copy"
                      text={origin ?? ""}
                    />
                  </span>
                </li>
              );

            return <li key={stepId}>{step.note}</li>;
          })}
        </ol>
      )}
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
              aria-label="OpenRoom on GitHub (opens in a new tab)"
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
              AI room planner and furniture shopping
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
            {/* The frame clips the photo; the caption sits outside it, so the
                overflow that crops the image never crops the words. */}
            <div className={styles.heroRoomFrame}>
              <Image
                alt="A living room furnished with a cream sofa, oak coffee table, woven rug, floor lamp, chair and potted plant."
                fill
                priority
                sizes="(min-width: 900px) 46vw, 100vw"
                src="/demo/openroom-room.png"
              />
            </div>
            <figcaption className={styles.heroCaption}>
              {"The demo room after one redesign. The demo opens with the room's original furniture, ready to swap."}
            </figcaption>
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
          {/* One link under the grid, not one per card: every card ends at the
              same demo. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- same-route query switch must reload: a soft navigation leaves this guide on screen without the Chromium Navigation API. */}
          <a
            className={`md-button md-button--text ${styles.connectFooterLink}`}
            href="/?view=dashboard"
          >
            Open the demo
          </a>
        </section>

        <div className={styles.moreInfo}>
          <details className={styles.disclosure}>
            <summary className={styles.summary}>What your AI app can do</summary>
            <ul className={styles.toolList}>
              {TOOL_SUMMARIES.map(({ name, summary }) => (
                <li key={name}>
                  <span>{summary}</span>
                  <code className="md-code">{name}</code>
                </li>
              ))}
            </ul>
          </details>

          <details className={styles.disclosure}>
            <summary className={styles.summary}>
              Shopping with your AI app
            </summary>
            <p className={styles.disclosureBody}>
              {"In Shopify mode your AI app receives the cart lines and the store's token-free Storefront MCP endpoint, so it can finish the order for you."}
            </p>
            <a
              className={styles.textLink}
              href={`${REPOSITORY_URL}#commerce-integration`}
              rel="noreferrer"
              target="_blank"
            >
              Commerce integration in the README
              <span className={styles.srOnly}> (opens in a new tab)</span>
            </a>
          </details>

          <details className={styles.disclosure}>
            <summary className={styles.summary}>Open source</summary>
            <p className={styles.disclosureBody}>
              {"OpenRoom is MIT-licensed: the photo compositor, the true-scale placement, and the WebMCP tools are all in the repository."}
            </p>
            <a
              className={styles.textLink}
              href={REPOSITORY_URL}
              rel="noreferrer"
              target="_blank"
            >
              Taehun/OpenRoom on GitHub
              <span className={styles.srOnly}> (opens in a new tab)</span>
            </a>
          </details>
        </div>
      </main>
    </div>
  );
}
