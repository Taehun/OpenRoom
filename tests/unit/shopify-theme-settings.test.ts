import { describe, expect, it } from "vitest";

import {
  loadThemeSettings,
  validateSettingsData,
  type SettingSchema,
} from "../../examples/shopify/src/theme-settings";

const { schema, data } = loadThemeSettings();

describe("validateSettingsData", () => {
  const select: SettingSchema = {
    id: "type_size_h2",
    type: "select",
    options: [{ value: "32" }, { value: "40" }],
  };
  const range: SettingSchema = { id: "logo_height", type: "range", min: 0, max: 100, step: 2 };
  const check: SettingSchema = { id: "show_cart_note", type: "checkbox" };
  const free: SettingSchema = { id: "page_background_color", type: "color" };
  const all = [select, range, check, free];

  it("passes values that satisfy the schema", () => {
    expect(
      validateSettingsData(all, {
        type_size_h2: "40",
        logo_height: 32,
        show_cart_note: false,
        page_background_color: "anything",
      }),
    ).toEqual([]);
  });

  it("rejects a select value that is not one of its options", () => {
    // Exactly the mistake made when the theme was first re-skinned: "36" reads
    // like a size but is not in the schema's list, and Theme Check says nothing.
    const [violation] = validateSettingsData(all, { type_size_h2: "36" });

    expect(violation).toMatchObject({ id: "type_size_h2", value: "36" });
    expect(violation.reason).toMatch(/not one of/i);
    expect(violation.reason).toContain("32");
  });

  it("rejects a range value outside min and max", () => {
    expect(validateSettingsData(all, { logo_height: 240 })[0].reason).toMatch(/between 0 and 100/);
    expect(validateSettingsData(all, { logo_height: -1 })[0].reason).toMatch(/between 0 and 100/);
  });

  it("rejects a range value off the schema's step", () => {
    expect(validateSettingsData(all, { logo_height: 33 })[0].reason).toMatch(/step of 2/);
  });

  it("rejects a non-boolean checkbox", () => {
    expect(validateSettingsData(all, { show_cart_note: "true" })[0].reason).toMatch(/boolean/i);
  });

  it("leaves free-form types alone", () => {
    // Colours, fonts, images and text have no enumerable set to check against.
    expect(validateSettingsData(all, { page_background_color: 42 })).toEqual([]);
  });

  it("ignores a Liquid reference, which resolves at render time", () => {
    expect(
      validateSettingsData(all, { type_size_h2: "{{ settings.color_palette.background }}" }),
    ).toEqual([]);
  });

  it("ignores a value whose id the schema does not define", () => {
    expect(validateSettingsData(all, { not_a_setting: "whatever" })).toEqual([]);
  });

  it("reports every violation, not just the first", () => {
    expect(
      validateSettingsData(all, { type_size_h2: "36", logo_height: 999, show_cart_note: "no" }),
    ).toHaveLength(3);
  });
});

describe("the committed Horizon theme", () => {
  it("has a schema and settings to check", () => {
    expect(schema.length).toBeGreaterThan(0);
    expect(Object.keys(data.current).length).toBeGreaterThan(0);
  });

  it("checks a meaningful share of the settings, not a handful", () => {
    const ids = new Set(
      schema.filter((s) => ["select", "range", "checkbox"].includes(s.type)).map((s) => s.id),
    );
    const checked = Object.keys(data.current).filter((key) => ids.has(key));

    expect(checked.length).toBeGreaterThan(40);
  });

  it("holds no value the schema rejects", () => {
    // Theme Check validates Liquid and block nesting but never setting values,
    // so this is the only thing standing between a typo and a broken push.
    const violations = validateSettingsData(schema, data.current);
    expect(
      violations,
      violations.map((v) => `${v.id}=${JSON.stringify(v.value)}: ${v.reason}`).join("\n"),
    ).toEqual([]);
  });

  it("holds no value the schema rejects in the Horizon preset either", () => {
    const preset = data.presets?.Horizon;
    expect(preset).toBeDefined();
    expect(validateSettingsData(schema, preset ?? {})).toEqual([]);
  });

  it("catches the four values that shipped before this check existed", () => {
    // Theme Check passed on every one of them. Asserting the guard fires on
    // known-bad input is the only thing that makes the clean run above mean
    // anything.
    const violations = validateSettingsData(schema, {
      ...data.current,
      type_size_h2: "36",
      type_size_h3: "28",
      type_size_paragraph: "15",
      card_hover_effect: "zoom-image",
    });

    expect(violations.map((v) => v.id).sort()).toEqual([
      "card_hover_effect",
      "type_size_h2",
      "type_size_h3",
      "type_size_paragraph",
    ]);
  });
});
