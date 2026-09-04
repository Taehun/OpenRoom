/**
 * A very small Shopify Admin GraphQL client: one `query` method, the throttle
 * rule the Admin API asks for, and error messages that name the fix.
 *
 * The access token lives in this process only. Nothing in `src/` or `app/`
 * imports this file, no bundle inlines it, and no CI job runs it — OpenRoom
 * itself stays token-free.
 */
export const DEFAULT_API_VERSION = "2026-01";

/** Retries after this many seconds when the response carries no `Retry-After`. */
export const DEFAULT_RETRY_SECONDS = 2;

export const MAX_RETRIES = 5;

export interface AdminClientOptions {
  storeDomain: string;
  accessToken: string;
  apiVersion?: string;
  fetch?: typeof globalThis.fetch;
  /** Injected by the tests so a retry costs no wall-clock time. */
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

export interface AdminClient {
  readonly endpoint: string;
  query<T>(document: string, variables?: Record<string, unknown>): Promise<T>;
}

interface GraphQLError {
  message?: string;
  extensions?: { code?: string };
}

interface GraphQLBody<T> {
  data?: T;
  errors?: GraphQLError[];
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `Retry-After` is seconds here; a missing or unparseable value falls back. */
export function retryDelayMs(header: string | null): number {
  const seconds = Number(header);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_RETRY_SECONDS) * 1000;
}

export function isThrottled(errors: readonly GraphQLError[] | undefined): boolean {
  return (errors ?? []).some((error) => error.extensions?.code === "THROTTLED");
}

export function adminEndpoint(storeDomain: string, apiVersion: string): string {
  const host = storeDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${host}/admin/api/${apiVersion}/graphql.json`;
}

export function createAdminClient(options: AdminClientOptions): AdminClient {
  const {
    storeDomain,
    accessToken,
    apiVersion = DEFAULT_API_VERSION,
    fetch: fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    maxRetries = MAX_RETRIES,
  } = options;
  const endpoint = adminEndpoint(storeDomain, apiVersion);

  async function query<T>(
    document: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ query: document, variables }),
      });

      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Shopify Admin API refused the request (HTTP ${response.status}) — check the app's scopes and token`,
        );
      }

      if (response.status === 429) {
        if (attempt >= maxRetries) {
          throw new Error(`Shopify Admin API throttled after ${maxRetries} retries`);
        }
        await sleep(retryDelayMs(response.headers.get("Retry-After")));
        continue;
      }

      const text = await response.text();
      let body: GraphQLBody<T>;
      try {
        body = JSON.parse(text) as GraphQLBody<T>;
      } catch {
        throw new Error(
          `Shopify Admin API returned HTTP ${response.status} with a non-JSON body`,
        );
      }

      if (isThrottled(body.errors)) {
        if (attempt >= maxRetries) {
          throw new Error(`Shopify Admin API throttled after ${maxRetries} retries`);
        }
        await sleep(retryDelayMs(response.headers.get("Retry-After")));
        continue;
      }

      if (body.errors && body.errors.length > 0) {
        const detail = body.errors.map((error) => error.message ?? "unknown error").join("; ");
        throw new Error(`Shopify Admin API error: ${detail}`);
      }

      if (!response.ok) {
        throw new Error(`Shopify Admin API returned HTTP ${response.status}`);
      }

      if (body.data === undefined) {
        throw new Error("Shopify Admin API returned no data");
      }

      return body.data;
    }
  }

  return { endpoint, query };
}
