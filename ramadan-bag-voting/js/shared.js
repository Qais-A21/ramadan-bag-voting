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

export function percent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

export const LIMITS = {
  itemName: 100,
  question: 200,
  optionLabel: 50,
  suggestionName: 60,
  maxOptions: 8,
  minOptions: 2,
};
