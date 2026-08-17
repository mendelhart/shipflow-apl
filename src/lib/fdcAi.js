// Shared Gemini helpers for the Food Detail Checklist (FDC) AI features.
// Used by the FDC page (FdcAiPanel), the Products table (ProductAiToolbar),
// and the product form (ProductFormAi). All calls go through the shared
// Gemini client — no Base44 AI credits are consumed.

import { invokeLLM } from "@/lib/aiClient";

function eNumberPrompt(list) {
  return (
    "You are a food-additive expert fluent in EU E-number codes. For each ingredient below, return its assigned EU E-number " +
    '(e.g. Ascorbic Acid → "E300", Citric Acid → "E330", Monosodium Glutamate → "E621", Sodium Benzoate → "E211"). ' +
    'If the ingredient is NOT a regulated food additive with an E-number (e.g. water, sugar, wheat flour, fruit juice, vegetable oil, salt, honey), return an empty string "". ' +
    "Return the ingredients in the SAME ORDER as given.\n\nIngredients:\n" +
    list +
    "\n\nReturn only JSON."
  );
}

const E_SCHEMA = {
  type: "object",
  properties: {
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, e_number: { type: "string" } },
      },
    },
  },
};

/**
 * Look up EU E-numbers for a single product's ingredients via Gemini.
 * Returns { ingredients, skipped }. Does NOT persist — the caller saves
 * (table/toolbar) or applies to form state (product form). Skips the call
 * entirely when every ingredient already has an E-number.
 */
export async function enrichENumbersForProduct(prod, onStatus) {
  const ings = prod.fdc_ingredients || [];
  if (!ings.length) return { ingredients: ings, skipped: true };
  if (ings.every((i) => (i.e_number || "").trim() !== "")) return { ingredients: ings, skipped: true };

  const list = ings.map((i, idx) => `${idx + 1}. ${i.name || ""}`).join("\n");
  const res = await invokeLLM({ prompt: eNumberPrompt(list), response_json_schema: E_SCHEMA, onStatus });
  // Map by index (we sent them in order) so name-spelling drift can't
  // drop an E-number.
  const ingredients = ings.map((ing, i) => ({
    ...ing,
    e_number: res?.ingredients?.[i]?.e_number ?? ing.e_number ?? "",
  }));
  return { ingredients, skipped: false };
}

/**
 * Audit an array of FDC item-data objects. `payload` items each carry
 * product fields + an `ingredients` array. Returns { summary, issues }.
 * Issue objects may include `po` and/or `product` identifiers.
 */
export async function auditFdcData(payload, onStatus) {
  const prompt =
    "You are a food regulatory compliance auditor reviewing Food Detail Checklist (FDC) data for EU (United Kingdom / Germany) shipments. " +
    "Below is JSON data for product(s), each with product info and its ingredient list.\n\n" +
    "Identify:\n" +
    "1. MISSING required information — e.g. missing % by weight, missing country of origin, missing animal/plant classification (required for Germany/Form 3), " +
    "missing approval numbers for animal-origin ingredients, missing heat-treatment info for dairy/egg ingredients, missing E-numbers for known additives, missing shelf life.\n" +
    "2. MISTAKES — e.g. ingredient percentages that don't sum to ~100%, incorrect animal/plant classification, additive ingredients missing an E-number, " +
    "inconsistent countries of origin across the product, missing or invalid HS/UPC codes.\n" +
    '3. Severity: "high" (blocks compliance / shipment), "medium" (should fix before submission), "low" (minor / informational).\n\n' +
    "For each issue give a concrete, specific recommendation. Only flag real problems — do not invent issues. " +
    "If everything looks complete and correct, return an empty issues array with a summary saying so.\n\n" +
    "Data:\n" +
    JSON.stringify(payload, null, 2) +
    "\n\nReturn only JSON matching the schema.";

  const schema = {
    type: "object",
    properties: {
      summary: { type: "string" },
      issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            po: { type: "string" },
            product: { type: "string" },
            ingredient: { type: "string" },
            field: { type: "string" },
            issue: { type: "string" },
            severity: { type: "string", enum: ["high", "medium", "low"] },
            recommendation: { type: "string" },
          },
        },
      },
    },
  };
  return await invokeLLM({ prompt, response_json_schema: schema, onStatus });
}