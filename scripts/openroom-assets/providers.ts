/**
 * The image providers the two offline asset pipelines call. Both shells
 * (`pnpm assets:views`, `pnpm assets:products`) go through `ImageProvider`, so
 * neither one names an endpoint, both share one retry ladder, and the key
 * travels in a header only and is never logged.
 *
 * The Gemini shape is the one verified live on 2026-09-04 (spec section 6):
 * `POST /v1beta/models/{model}:generateContent`, `x-goog-api-key`, and an
 * image returned as the first `inlineData` part — `image/jpeg` in the probe,
 * so callers decode by content and never assume PNG.
 */

export type AspectRatio = "3:2" | "2:3";
export type ProviderName = "openai" | "gemini";

/** OpenAI wants pixels, Gemini wants the ratio; these are the same two shapes. */
export const SIZE_BY_ASPECT: Readonly<Record<AspectRatio, string>> = Object.freeze(
  {
    "3:2": "1536x1024",
    "2:3": "1024x1536",
  },
);

export interface ImageReference {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
}

export interface ImageRequest {
  prompt: string;
  aspect: AspectRatio;
  model: string;
  quality: "low" | "medium" | "high";
  /** Present in views mode: the photographed cutout the model must match. */
  reference?: ImageReference;
  /**
   * The complete `images/edits` multipart fields (`model`, `prompt`, `size` and
   * the rest). Views mode pins them; products mode omits them and the provider
   * falls back to `images/generations`.
   */
  openaiFields?: readonly (readonly [string, string])[];
}

export interface ProviderContext {
  fetch: typeof globalThis.fetch;
  /** Read from the environment by the shell; only ever sent as a header. */
  key: string;
  log: (message: string) => void;
  sleep: (ms: number) => Promise<void>;
  /** Prefixes a retry line, e.g. `[products] oak-side-table`. */
  label: string;
}

export interface ImageProvider {
  readonly name: ProviderName;
  readonly keyEnv: "OPENAI_API_KEY" | "GEMINI_API_KEY";
  readonly modelEnv: "OPENROOM_IMAGE_MODEL" | "OPENROOM_IMAGE_MODEL_GEMINI";
  readonly defaultModel: string;
  generate(
    request: ImageRequest,
    context: ProviderContext,
  ): Promise<Uint8Array>;
}

/** 429 and 5xx are retried after these waits; anything else aborts the run. */
export const RETRY_WAITS_MS = [2_000, 4_000, 8_000] as const;

const OPENAI_EDITS_URL = "https://api.openai.com/v1/images/edits";
const OPENAI_GENERATIONS_URL = "https://api.openai.com/v1/images/generations";
const GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Sends `attempt()` until it succeeds or the ladder runs out. The body is built
 * inside the callback because `FormData` is consumed by a failed request.
 */
async function withRetries(
  context: ProviderContext,
  what: string,
  attempt: () => Promise<Response>,
): Promise<Response> {
  for (let index = 0; index <= RETRY_WAITS_MS.length; index += 1) {
    const response = await attempt();
    if (response.ok) return response;

    const detail = (await response.text()).slice(0, 400);
    const wait = RETRY_WAITS_MS[index];
    if (isRetryable(response.status) && wait !== undefined) {
      context.log(
        `${context.label} HTTP ${response.status}, retrying in ${wait / 1000}s`,
      );
      await context.sleep(wait);
      continue;
    }
    throw new Error(`HTTP ${response.status} from ${what}: ${detail}`);
  }
  throw new Error(`${what} exhausted its retries`);
}

interface OpenAiImageResponse {
  data?: { b64_json?: string }[];
}

export const openaiProvider: ImageProvider = {
  name: "openai",
  keyEnv: "OPENAI_API_KEY",
  modelEnv: "OPENROOM_IMAGE_MODEL",
  defaultModel: "gpt-image-1",
  async generate(request, context) {
    const editing = request.reference !== undefined && request.openaiFields !== undefined;
    const url = editing ? OPENAI_EDITS_URL : OPENAI_GENERATIONS_URL;
    const what = editing ? "images/edits" : "images/generations";

    const response = await withRetries(context, what, () => {
      if (editing) {
        const body = new FormData();
        for (const [name, value] of request.openaiFields!) {
          body.append(name, value);
        }
        const reference = request.reference!;
        body.append(
          "image",
          // Copied so the Blob owns a plain ArrayBuffer, whatever the reader returned.
          new Blob([new Uint8Array(reference.bytes)], {
            type: reference.mimeType,
          }),
          reference.filename,
        );
        return context.fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${context.key}` },
          body,
        });
      }

      return context.fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${context.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          size: SIZE_BY_ASPECT[request.aspect],
          quality: request.quality,
          output_format: "png",
          n: 1,
        }),
      });
    });

    const payload = (await response.json()) as OpenAiImageResponse;
    const base64 = payload.data?.[0]?.b64_json;
    if (!base64) throw new Error(`${what} returned no image data`);
    return new Uint8Array(Buffer.from(base64, "base64"));
  },
};

export interface GeminiInlineData {
  mimeType: string;
  data: string;
}

export type GeminiPart = { text: string } | { inlineData: GeminiInlineData };

export interface GeminiRequestBody {
  contents: { parts: GeminiPart[] }[];
  generationConfig: {
    responseModalities: ["IMAGE"];
    imageConfig: { aspectRatio: AspectRatio };
  };
}

/** The verified `generateContent` body: prompt part, optional reference part. */
export function geminiRequestBody(
  request: Pick<ImageRequest, "prompt" | "aspect"> &
    Partial<Pick<ImageRequest, "reference">>,
): GeminiRequestBody {
  const parts: GeminiPart[] = [{ text: request.prompt }];
  if (request.reference) {
    parts.push({
      inlineData: {
        mimeType: request.reference.mimeType,
        data: Buffer.from(request.reference.bytes).toString("base64"),
      },
    });
  }
  return {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: request.aspect },
    },
  };
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { inlineData?: Partial<GeminiInlineData> }[] };
  }[];
}

export const geminiProvider: ImageProvider = {
  name: "gemini",
  keyEnv: "GEMINI_API_KEY",
  modelEnv: "OPENROOM_IMAGE_MODEL_GEMINI",
  defaultModel: "gemini-3.1-flash-image",
  async generate(request, context) {
    const url = `${GEMINI_BASE_URL}/${request.model}:generateContent`;
    const response = await withRetries(context, "generateContent", () =>
      context.fetch(url, {
        method: "POST",
        headers: {
          "x-goog-api-key": context.key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(geminiRequestBody(request)),
      }),
    );

    const payload = (await response.json()) as GeminiResponse;
    const parts = payload.candidates?.[0]?.content?.parts ?? [];
    const data = parts.find((part) => part.inlineData?.data)?.inlineData?.data;
    if (!data) throw new Error("generateContent returned no inline image data");
    return new Uint8Array(Buffer.from(data, "base64"));
  },
};

const PROVIDERS: Readonly<Record<ProviderName, ImageProvider>> = Object.freeze({
  openai: openaiProvider,
  gemini: geminiProvider,
});

function isProviderName(value: string): value is ProviderName {
  return value === "openai" || value === "gemini";
}

/**
 * `OPENROOM_IMAGE_PROVIDER` decides when it is set; otherwise Gemini is the
 * default only when it is the only key present, so an existing OpenAI-only
 * setup keeps calling OpenAI. Throws with a message the shell turns into exit 2.
 */
export function selectProvider(
  env: Readonly<Record<string, string | undefined>>,
): ImageProvider {
  const override = env.OPENROOM_IMAGE_PROVIDER?.trim();
  if (override) {
    if (!isProviderName(override)) {
      throw new Error(
        `OPENROOM_IMAGE_PROVIDER must be gemini or openai, got ${override}`,
      );
    }
    const provider = PROVIDERS[override];
    if (!env[provider.keyEnv]?.trim()) {
      throw new Error(
        `OPENROOM_IMAGE_PROVIDER=${override} needs ${provider.keyEnv} in .env.local (never committed)`,
      );
    }
    return provider;
  }

  if (env.OPENAI_API_KEY?.trim()) return openaiProvider;
  if (env.GEMINI_API_KEY?.trim()) return geminiProvider;
  throw new Error(
    "no image key: set GEMINI_API_KEY or OPENAI_API_KEY in .env.local (never committed), or run with --dry-run",
  );
}

/** The model for a provider: its env override, else its default. */
export function modelFor(
  provider: ImageProvider,
  env: Readonly<Record<string, string | undefined>>,
): string {
  return env[provider.modelEnv]?.trim() || provider.defaultModel;
}
