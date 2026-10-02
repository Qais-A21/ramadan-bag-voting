export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

export function slugify(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 60) || `item-${Date.now()}`;
}

// Returns obj[`${field}Ar`] when lang is Arabic and that field exists,
// otherwise falls back to obj[field]. Lets seeded/admin-entered content
// carry real Arabic translations while user-submitted content (which can't
// be auto-translated) still renders fine via the fallback.
export function localize(obj, field, lang) {
  if (lang === "ar" && obj[`${field}Ar`]) return obj[`${field}Ar`];
  return obj[field];
}

export function percent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

export const LIMITS = {
  itemName: 100,
  question: 200,
  unit: 20,
  suggestionName: 60,
  quantityMin: 0.5,
  quantityMax: 1000,
};
