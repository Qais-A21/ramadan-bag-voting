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
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { t, getLang, setLang, applyDocumentDirection } from "./i18n.js";
import { escapeHtml, slugify, percent, LIMITS } from "./shared.js";

let uid = null;

// itemId -> { item, options: Map(optionId -> optionData), voteCounts: Map(optionId -> count), myOptionId, votersUnsub }
const itemsState = new Map();
const optionUnsubs = new Map(); // itemId -> unsubscribe fn
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
  el("optionsLabel").textContent = t("optionsLabel", lang);
  el("addOptionBtn").textContent = t("addOption", lang);
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

// ---------- Items, options & votes real-time wiring ----------
//
// Vote tallies are never stored as a mutable counter. Instead each vote is its
// own document (votes/{itemId}/voters/{uid}), and every connected client
// tallies the live subcollection itself. This means there is no "voteCount"
// field a malicious client could ever overwrite — the only thing anyone can
// write is their own single vote document.

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
        options: existing?.options || new Map(),
        voteCounts: existing?.voteCounts || new Map(),
        myOptionId: existing?.myOptionId ?? null,
      });
      if (!optionUnsubs.has(itemId)) watchOptions(itemId);
      if (!voterUnsubs.has(itemId)) watchVoters(itemId);
    });
    // Clean up items that disappeared (deactivated/deleted)
    for (const itemId of [...itemsState.keys()]) {
      if (!seenIds.has(itemId)) {
        itemsState.delete(itemId);
        optionUnsubs.get(itemId)?.();
        optionUnsubs.delete(itemId);
        voterUnsubs.get(itemId)?.();
        voterUnsubs.delete(itemId);
      }
    }
    renderItems();
    renderResults();
  });
}

function watchOptions(itemId) {
  const q = query(collection(db, "items", itemId, "options"), orderBy("order", "asc"));
  const unsub = onSnapshot(q, (snap) => {
    const state = itemsState.get(itemId);
    if (!state) return;
    const options = new Map();
    snap.forEach((d) => options.set(d.id, { id: d.id, ...d.data() }));
    state.options = options;
    renderItems();
    renderResults();
  });
  optionUnsubs.set(itemId, unsub);
}

function watchVoters(itemId) {
  const unsub = onSnapshot(collection(db, "votes", itemId, "voters"), (snap) => {
    const state = itemsState.get(itemId);
    if (!state) return;
    const counts = new Map();
    let myOptionId = null;
    snap.forEach((d) => {
      const data = d.data();
      counts.set(data.optionId, (counts.get(data.optionId) || 0) + 1);
      if (d.id === uid) myOptionId = data.optionId;
    });
    state.voteCounts = counts;
    state.myOptionId = myOptionId;
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
// Casting/changing a vote is a single document write (own vote doc). That
// single write is already atomic — there is nothing else to keep in sync.

async function castVote(itemId, optionId) {
  const state = itemsState.get(itemId);
  if (!state) return;
  if (state.myOptionId === optionId) return; // no-op, already voted this way

  const voterRef = doc(db, "votes", itemId, "voters", uid);
  try {
    await setDoc(voterRef, { optionId, votedAt: serverTimestamp() });
  } catch (err) {
    console.error("Vote failed", err);
    alert(t("errorGeneric"));
  }
}

// ---------- Add item ----------

async function submitNewItem(name, question, options) {
  const itemRef = doc(collection(db, "items"));
  const batch = writeBatch(db);
  batch.set(itemRef, {
    name,
    question,
    active: true,
    order: Date.now(),
    createdAt: serverTimestamp(),
    createdBy: uid,
  });
  options.forEach((label, idx) => {
    const optRef = doc(collection(db, "items", itemRef.id, "options"));
    batch.set(optRef, { label, order: idx });
  });
  await batch.commit();
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
      const { item, options, voteCounts, myOptionId } = state;
      const optionsArr = [...options.values()];
      const total = optionsArr.reduce((sum, o) => sum + (voteCounts.get(o.id) || 0), 0);

      const optionsHtml = optionsArr
        .map((opt) => {
          const count = voteCounts.get(opt.id) || 0;
          const pct = percent(count, total);
          const isMine = myOptionId === opt.id;
          return `
            <button
              class="vote-option ${isMine ? "vote-option--selected" : ""}"
              data-item-id="${itemId}"
              data-option-id="${opt.id}"
              aria-pressed="${isMine}"
            >
              <span class="vote-option__bar" style="width:${pct}%"></span>
              <span class="vote-option__content">
                <span class="vote-option__label">${escapeHtml(opt.label)}</span>
                <span class="vote-option__count">${count} ${count === 1 ? t("vote", lang) : t("votes", lang)} · ${pct}%</span>
              </span>
            </button>`;
        })
        .join("");

      return `
        <article class="item-card">
          <h3 class="item-card__name">${escapeHtml(item.name)}</h3>
          <p class="item-card__question">${escapeHtml(item.question)}</p>
          <div class="item-card__options">${optionsHtml}</div>
        </article>`;
    })
    .join("");

  container.querySelectorAll("[data-item-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      castVote(btn.dataset.itemId, btn.dataset.optionId);
    });
  });
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
      const { item, options, voteCounts } = state;
      const optionsArr = [...options.values()].sort(
        (a, b) => (voteCounts.get(b.id) || 0) - (voteCounts.get(a.id) || 0)
      );
      const total = optionsArr.reduce((sum, o) => sum + (voteCounts.get(o.id) || 0), 0);
      if (total === 0) return "";
      const rows = optionsArr
        .map((opt) => {
          const count = voteCounts.get(opt.id) || 0;
          const pct = percent(count, total);
          return `
            <div class="results-row">
              <span class="results-row__label">${escapeHtml(opt.label)}</span>
              <div class="results-row__track"><div class="results-row__fill" style="width:${pct}%"></div></div>
              <span class="results-row__pct">${pct}%</span>
            </div>`;
        })
        .join("");
      return `
        <div class="results-item">
          <h4 class="results-item__name">${escapeHtml(item.name)}</h4>
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
  const optionsContainer = el("optionsContainer");

  function addOptionField(value = "") {
    if (optionsContainer.children.length >= LIMITS.maxOptions) return;
    const wrapper = document.createElement("div");
    wrapper.className = "option-field";
    wrapper.innerHTML = `
      <input type="text" class="option-input" maxlength="${LIMITS.optionLabel}" value="${escapeHtml(value)}" placeholder="${t("optionPlaceholder")}" />
      <button type="button" class="option-remove" aria-label="${t("removeOption")}">&times;</button>
    `;
    wrapper.querySelector(".option-remove").addEventListener("click", () => {
      if (optionsContainer.children.length > LIMITS.minOptions) wrapper.remove();
    });
    optionsContainer.appendChild(wrapper);
  }

  el("addItemBtn").addEventListener("click", () => {
    el("itemNameInput").value = "";
    el("questionInput").value = "";
    optionsContainer.innerHTML = "";
    addOptionField();
    addOptionField();
    el("itemFormError").textContent = "";
    modal.classList.remove("hidden");
  });

  el("cancelItemBtn").addEventListener("click", () => modal.classList.add("hidden"));
  el("addOptionBtn").addEventListener("click", () => addOptionField());

  el("addItemForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = el("itemNameInput").value.trim();
    const question = el("questionInput").value.trim();
    const options = [...optionsContainer.querySelectorAll(".option-input")]
      .map((i) => i.value.trim())
      .filter(Boolean);

    const errorEl = el("itemFormError");
    if (!name || !question || options.length < LIMITS.minOptions) {
      errorEl.textContent = options.length < LIMITS.minOptions ? t("errorMinOptions") : t("errorRequired");
      return;
    }
    if (name.length > LIMITS.itemName || question.length > LIMITS.question || options.some((o) => o.length > LIMITS.optionLabel)) {
      errorEl.textContent = t("errorTooLong");
      return;
    }
    const uniqueOptions = new Set(options.map((o) => o.toLowerCase()));
    if (uniqueOptions.size !== options.length) {
      errorEl.textContent = t("errorDuplicateOptions");
      return;
    }

    try {
      await submitNewItem(name, question, options);
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
