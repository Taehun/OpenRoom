/**
 * Checks the committed theme's setting values against the theme's own schema.
 *
 * `pnpm shop:theme:check` runs Shopify's Theme Check, which validates Liquid
 * and block nesting — it caught a block used where its parent's schema forbade
 * it — but it does **not** validate setting *values*. Re-skinning Horizon by
 * hand put four illegal values into `config/settings_data.json`
 * (`type_size_h2: "36"`, `type_size_h3: "28"`, `type_size_paragraph: "15"`,
 * `card_hover_effect: "zoom-image"`), and nothing in the toolchain objected;
 * they were found only by a throwaway script. This closes that gap, in the
 * unit suite, where it cannot be forgotten.
 *
 * Only the setting types with an enumerable or numeric constraint are checked.
 * A colour, font, image, or free text has nothing to check it against.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const THEME_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "theme");

export interface SettingSchema {
  id: string;
  type: string;
  options?: { value: string }[];
  min?: number;
  max?: number;
  step?: number;
}

export interface SettingsData {
  current: Record<string, unknown>;
  presets?: Record<string, Record<string, unknown>>;
}

export interface Violation {
  id: string;
  value: unknown;
  reason: string;
}

/**
 * Shopify writes these files with a leading `/* … *\/` banner, which is not
 * legal JSON. Strip it before parsing.
 */
export function parseThemeJson<T>(source: string): T {
  return JSON.parse(source.replace(/^\s*\/\*[\s\S]*?\*\//, "")) as T;
}

/** Every setting the theme defines, flattened out of its schema groups. */
export function loadThemeSettings(themeDir: string = THEME_DIR): {
  schema: SettingSchema[];
  data: SettingsData;
} {
  const groups = parseThemeJson<{ settings?: SettingSchema[] }[]>(
    readFileSync(join(themeDir, "config", "settings_schema.json"), "utf8"),
  );
  const schema = groups
    .flatMap((group) => group.settings ?? [])
    .filter((setting): setting is SettingSchema => typeof setting.id === "string");
  const data = parseThemeJson<SettingsData>(
    readFileSync(join(themeDir, "config", "settings_data.json"), "utf8"),
  );
  return { schema, data };
}

/** `{{ settings.color_palette.background }}` is resolved by Liquid, not here. */
function isLiquidReference(value: unknown): boolean {
  return typeof value === "string" && /\{\{.*\}\}/.test(value);
}

function checkOne(setting: SettingSchema, value: unknown): string | null {
  switch (setting.type) {
    case "select": {
      const allowed = (setting.options ?? []).map((option) => option.value);
      if (allowed.length === 0 || allowed.includes(String(value))) return null;
      return `not one of ${allowed.join(", ")}`;
    }
    case "range": {
      if (typeof value !== "number") return "must be a number";
      const { min, max, step } = setting;
      if (min !== undefined && max !== undefined && (value < min || value > max)) {
        return `must be between ${min} and ${max}`;
      }
      if (step !== undefined && step > 0 && min !== undefined) {
        // Floating-point steps exist in theme schemas, so compare loosely.
        const offset = (value - min) / step;
        if (Math.abs(offset - Math.round(offset)) > 1e-6) {
          return `must sit on a step of ${step} from ${min}`;
        }
      }
      return null;
    }
    case "checkbox":
      return typeof value === "boolean" ? null : "must be a boolean";
    default:
      // color, font_picker, image_picker, text, richtext, url, … — nothing to
      // check a value against.
      return null;
  }
}

/**
 * Every value that its schema rejects, in the order the values appear. A value
 * whose id the schema does not define is ignored: themes carry settings the
 * schema drops between versions, and that is Theme Check's business, not this
 * function's.
 */
export function validateSettingsData(
  schema: readonly SettingSchema[],
  values: Readonly<Record<string, unknown>>,
): Violation[] {
  const byId = new Map(schema.map((setting) => [setting.id, setting]));
  const violations: Violation[] = [];

  for (const [id, value] of Object.entries(values)) {
    const setting = byId.get(id);
    if (setting === undefined || isLiquidReference(value)) continue;
    const reason = checkOne(setting, value);
    if (reason !== null) violations.push({ id, value, reason });
  }

  return violations;
}
