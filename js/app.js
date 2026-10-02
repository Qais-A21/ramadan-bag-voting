import { auth, db, waitForUser } from "./firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { t, getLang, setLang, applyDocumentDirection } from "./i18n.js";
import { escapeHtml, slugify, percent, localize, LIMITS } from "./shared.js";

let uid = null;

// itemId -> { item, quantityCounts: Map(quantity -> count), myQuantity }
const itemsState = new Map();
const voterUnsubs = new Map(); // itemId -> unsubscribe fn
let itemsOrder = []; // ordered list of itemIds as received from the items query

// suggestionId -> { data, voterCount }
const suggestionsState = new Map();
const suggestionVoterUnsubs = new Map();

function el(id) {
  return document.getElementById(id);
}

function renderStaticText() {
  const lang = getLang();
  applyDocumentDirection(lang);
  document.title = t("title", lang);
  el("pageTitle").textContent = t("title", lang);
  el("pageSubtitle").textContent = t("subtitle", lang);
  el("langToggleBtn").textContent = t("langToggle", lang);
  el("resultsHeading").textContent = t("resultsHeading", lang);
  el("itemsHeading").textContent = t("itemsHeading", lang);
  el("addItemBtn").textContent = t("addItem", lang);
  el("suggestItemBtn").textContent = t("suggestItem", lang);
  el("suggestedHeading").textContent = t("suggestedHeading", lang);
  el("footerNote").textContent = t("footerNote", lang);
  el("adminLink").textContent = t("adminLink", lang);

  // Add-item modal
  el("modalAddItemTitle").textContent = t("modalAddItemTitle", lang);
  el("itemNameLabel").textContent = t("itemNameLabel", lang);
  el("itemNameInput").placeholder = t("itemNamePlaceholder", lang);
  el("questionLabel").textContent = t("questionLabel", lang);
  el("questionInput").placeholder = t("questionPlaceholder", lang);
  el("unitLabel").textContent = t("unitLabel", lang);
  el("unitInput").placeholder = t("unitPlaceholder", lang);
  el("submitItemBtn").textContent = t("submit", lang);
  el("cancelItemBtn").textContent = t("cancel", lang);

  // Suggest modal
  el("modalSuggestTitle").textContent = t("modalSuggestTitle", lang);
  el("suggestNameLabel").textContent = t("suggestNameLabel", lang);
  el("suggestNameInput").placeholder = t("suggestNamePlaceholder", lang);
  el("submitSuggestBtn").textContent = t("submitSuggestion", lang);
  el("cancelSuggestBtn").textContent = t("cancel", lang);

  renderItems();
  renderResults();
  renderSuggestions();
}

// ---------- Items & votes real-time wiring ----------
//
// Voting is free-form: a visitor types a quantity (e.g. "4") next to the
// item's unit (e.g. "KG") instead of picking from a preset list. Each
// answer is its own document (votes/{itemId}/voters/{uid}), and every
// connected client tallies the live subcollection itself — there is no
// mutable counter field anywhere for a client to tamper with.

function watchItems() {
  const q = query(collection(db, "items"), where("active", "==", true), orderBy("order", "asc"));
  onSnapshot(q, (snap) => {
    const seenIds = new Set();
    itemsOrder = [];
    snap.forEach((docSnap) => {
      const itemId = docSnap.id;
      seenIds.add(itemId);
      itemsOrder.push(itemId);
      const existing = itemsState.get(itemId);
      itemsState.set(itemId, {
        item: { id: itemId, ...docSnap.data() },
        quantityCounts: existing?.quantityCounts || new Map(),
        myQuantity: existing?.myQuantity ?? null,
      });
      if (!voterUnsubs.has(itemId)) watchVoters(itemId);
    });
    for (const itemId of [...itemsState.keys()]) {
      if (!seenIds.has(itemId)) {
        itemsState.delete(itemId);
        voterUnsubs.get(itemId)?.();
        voterUnsubs.delete(itemId);
      }
    }
    renderItems();
    renderResults();
  });
}

function watchVoters(itemId) {
  const unsub = onSnapshot(collection(db, "votes", itemId, "voters"), (snap) => {
    const state = itemsState.get(itemId);
    if (!state) return;
    const counts = new Map();
    let myQuantity = null;
    snap.forEach((d) => {
      const data = d.data();
      counts.set(data.quantity, (counts.get(data.quantity) || 0) + 1);
      if (d.id === uid) myQuantity = data.quantity;
    });
    state.quantityCounts = counts;
    state.myQuantity = myQuantity;
    renderItems();
    renderResults();
  });
  voterUnsubs.set(itemId, unsub);
}

function watchSuggestions() {
  const q = query(collection(db, "suggestions"), where("status", "==", "pending"));
  onSnapshot(q, (snap) => {
    const seen = new Set();
    snap.forEach((d) => {
      seen.add(d.id);
      const existing = suggestionsState.get(d.id);
      suggestionsState.set(d.id, { data: { id: d.id, ...d.data() }, voterCount: existing?.voterCount ?? 0 });
      if (!suggestionVoterUnsubs.has(d.id)) watchSuggestionVoters(d.id);
    });
    for (const id of [...suggestionsState.keys()]) {
      if (!seen.has(id)) {
        suggestionsState.delete(id);
        suggestionVoterUnsubs.get(id)?.();
        suggestionVoterUnsubs.delete(id);
      }
    }
    renderSuggestions();
  });
}

function watchSuggestionVoters(suggestionId) {
  const unsub = onSnapshot(collection(db, "suggestions", suggestionId, "voters"), (snap) => {
    const s = suggestionsState.get(suggestionId);
    if (!s) return;
    s.voterCount = snap.size;
    renderSuggestions();
  });
  suggestionVoterUnsubs.set(suggestionId, unsub);
}

// ---------- Voting ----------
// Submitting/changing an answer is a single document write (own vote doc).
// That single write is already atomic — there is nothing else to keep in sync.

async function castVote(itemId, quantity) {
  const voterRef = doc(db, "votes", itemId, "voters", uid);
  try {
    await setDoc(voterRef, { quantity, votedAt: serverTimestamp() });
  } catch (err) {
    console.error("Vote failed", err);
    alert(t("errorGeneric"));
  }
}

// ---------- Add item ----------

async function submitNewItem(name, question, unit) {
  const itemRef = doc(collection(db, "items"));
  await setDoc(itemRef, {
    name,
    question,
    unit,
    active: true,
    order: Date.now(),
    createdAt: serverTimestamp(),
    createdBy: uid,
  });
}

// ---------- Suggestions ----------

async function submitSuggestion(name) {
  const slug = slugify(name);
  const suggRef = doc(db, "suggestions", slug);
  const voterRef = doc(db, "suggestions", slug, "voters", uid);

  const suggSnap = await getDoc(suggRef);
  if (!suggSnap.exists()) {
    try {
      await setDoc(suggRef, {
        name,
        status: "pending",
        createdAt: serverTimestamp(),
        createdBy: uid,
      });
    } catch (err) {
      // Someone else created the same suggestion a moment earlier — fine,
      // we just add our own voter doc to it below.
      if (err.code !== "permission-denied") throw err;
    }
  }

  try {
    await setDoc(voterRef, { suggestedAt: serverTimestamp() });
  } catch (err) {
    if (err.code === "permission-denied") throw new Error("ALREADY_SUGGESTED");
    throw err;
  }
}

// ---------- Rendering ----------

function renderItems() {
  const container = el("itemsList");
  const lang = getLang();
  if (itemsOrder.length === 0) {
    container.innerHTML = `<p class="text-center text-stone-500 py-10">${t("noItems", lang)}</p>`;
    return;
  }
  container.innerHTML = itemsOrder
    .map((itemId) => {
      const state = itemsState.get(itemId);
      if (!state) return "";
      const { item, quantityCounts, myQuantity } = state;
      const unit = localize(item, "unit", lang);
      const total = [...quantityCounts.values()].reduce((a, b) => a + b, 0);
      const sortedEntries = [...quantityCounts.entries()].sort((a, b) => a[0] - b[0]);

      const distributionHtml =
        total === 0
          ? `<p class="quantity-empty">${t("noAnswersYet", lang)}</p>`
          : sortedEntries
              .map(([qty, count]) => {
                const pct = percent(count, total);
                const isMine = myQuantity === qty;
                return `
                  <div class="quantity-row ${isMine ? "quantity-row--mine" : ""}">
                    <span class="quantity-row__label">${formatQty(qty)} ${escapeHtml(unit)}</span>
                    <div class="quantity-row__track"><div class="quantity-row__fill" style="width:${pct}%"></div></div>
                    <span class="quantity-row__meta">${count} ${count === 1 ? t("vote", lang) : t("votes", lang)} · ${pct}%</span>
                  </div>`;
              })
              .join("");

      return `
        <article class="item-card">
          <h3 class="item-card__name">${escapeHtml(localize(item, "name", lang))}</h3>
          <p class="item-card__question">${escapeHtml(localize(item, "question", lang))}</p>
          <form class="quantity-form" data-item-id="${itemId}">
            <input
              type="number"
              class="quantity-input"
              inputmode="decimal"
              min="${LIMITS.quantityMin}"
              max="${LIMITS.quantityMax}"
              step="0.5"
              placeholder="${t("quantityPlaceholder", lang)}"
              value="${myQuantity ?? ""}"
              required
            />
            <span class="quantity-unit">${escapeHtml(unit)}</span>
            <button type="submit" class="btn-primary quantity-submit">${myQuantity != null ? t("updateVote", lang) : t("submitVote", lang)}</button>
          </form>
          ${myQuantity != null ? `<p class="quantity-my-answer">${t("yourAnswerIs", lang)} <strong>${formatQty(myQuantity)} ${escapeHtml(unit)}</strong></p>` : ""}
          <div class="quantity-distribution">
            <p class="quantity-distribution__heading">${t("distributionHeading", lang)}</p>
            ${distributionHtml}
          </div>
        </article>`;
    })
    .join("");

  container.querySelectorAll(".quantity-form").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const itemId = form.dataset.itemId;
      const input = form.querySelector(".quantity-input");
      const value = Number(input.value);
      if (!Number.isFinite(value) || value <= 0 || value > LIMITS.quantityMax) {
        alert(t("errorInvalidQuantity"));
        return;
      }
      castVote(itemId, value);
    });
  });
}

function formatQty(qty) {
  return Number.isInteger(qty) ? String(qty) : String(qty).replace(/\.0$/, "");
}

function renderResults() {
  const container = el("resultsList");
  const lang = getLang();
  if (itemsOrder.length === 0) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = itemsOrder
    .map((itemId) => {
      const state = itemsState.get(itemId);
      if (!state) return "";
      const { item, quantityCounts } = state;
      const unit = localize(item, "unit", lang);
      const total = [...quantityCounts.values()].reduce((a, b) => a + b, 0);
      if (total === 0) return "";
      const sortedEntries = [...quantityCounts.entries()].sort((a, b) => b[1] - a[1]);
      const rows = sortedEntries
        .map(([qty, count]) => {
          const pct = percent(count, total);
          return `
            <div class="results-row">
              <span class="results-row__label">${formatQty(qty)} ${escapeHtml(unit)}</span>
              <div class="results-row__track"><div class="results-row__fill" style="width:${pct}%"></div></div>
              <span class="results-row__pct">${pct}%</span>
            </div>`;
        })
        .join("");
      return `
        <div class="results-item">
          <h4 class="results-item__name">${escapeHtml(localize(item, "name", lang))}</h4>
          ${rows}
        </div>`;
    })
    .join("");

  if (!container.innerHTML.trim()) {
    container.innerHTML = `<p class="text-center text-stone-500 py-4">${t("loading", lang)}</p>`;
  }
}

function renderSuggestions() {
  const container = el("suggestionsList");
  const lang = getLang();
  const arr = [...suggestionsState.values()].sort((a, b) => b.voterCount - a.voterCount);
  if (arr.length === 0) {
    container.innerHTML = `<p class="text-center text-stone-500 py-4">${t("suggestedEmpty", lang)}</p>`;
    return;
  }
  container.innerHTML = arr
    .map(
      (s) => `
      <div class="suggestion-chip">
        <span>${escapeHtml(s.data.name)}</span>
        <span class="suggestion-chip__count">${s.voterCount} ${s.voterCount === 1 ? t("suggestion", lang) : t("suggestions", lang)}</span>
      </div>`
    )
    .join("");
}

// ---------- Modals ----------

function setupAddItemModal() {
  const modal = el("addItemModal");

  el("addItemBtn").addEventListener("click", () => {
    el("itemNameInput").value = "";
    el("questionInput").value = "";
    el("unitInput").value = "";
    el("itemFormError").textContent = "";
    modal.classList.remove("hidden");
  });

  el("cancelItemBtn").addEventListener("click", () => modal.classList.add("hidden"));

  el("addItemForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = el("itemNameInput").value.trim();
    const question = el("questionInput").value.trim();
    const unit = el("unitInput").value.trim();

    const errorEl = el("itemFormError");
    if (!name || !question || !unit) {
      errorEl.textContent = t("errorRequired");
      return;
    }
    if (name.length > LIMITS.itemName || question.length > LIMITS.question || unit.length > LIMITS.unit) {
      errorEl.textContent = t("errorTooLong");
      return;
    }

    try {
      await submitNewItem(name, question, unit);
      modal.classList.add("hidden");
    } catch (err) {
      console.error(err);
      errorEl.textContent = t("errorGeneric");
    }
  });
}

function setupSuggestModal() {
  const modal = el("suggestItemModal");

  el("suggestItemBtn").addEventListener("click", () => {
    el("suggestNameInput").value = "";
    el("suggestFormError").textContent = "";
    modal.classList.remove("hidden");
  });
  el("cancelSuggestBtn").addEventListener("click", () => modal.classList.add("hidden"));

  el("suggestItemForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = el("suggestNameInput").value.trim();
    const errorEl = el("suggestFormError");
    if (!name) {
      errorEl.textContent = t("errorRequired");
      return;
    }
    if (name.length > LIMITS.suggestionName) {
      errorEl.textContent = t("errorTooLong");
      return;
    }
    try {
      await submitSuggestion(name);
      modal.classList.add("hidden");
    } catch (err) {
      if (err.message === "ALREADY_SUGGESTED") {
        errorEl.textContent = t("alreadySuggested");
      } else {
        console.error(err);
        errorEl.textContent = t("errorGeneric");
      }
    }
  });
}

function setupLangToggle() {
  el("langToggleBtn").addEventListener("click", () => {
    const next = getLang() === "en" ? "ar" : "en";
    setLang(next);
    renderStaticText();
  });
}

// ---------- Boot ----------

async function main() {
  applyDocumentDirection(getLang());
  renderStaticText();
  setupAddItemModal();
  setupSuggestModal();
  setupLangToggle();

  const user = await waitForUser();
  uid = user.uid;

  watchItems();
  watchSuggestions();
}

main();
