import { auth, db } from "./firebase-init.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  orderBy,
  where,
  writeBatch,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { t, getLang, setLang, applyDocumentDirection } from "./i18n.js";
import { escapeHtml, percent, LIMITS } from "./shared.js";

function el(id) {
  return document.getElementById(id);
}

let currentUid = null;
const itemsState = new Map(); // itemId -> { item, options: Map, voteCounts: Map }
const optionUnsubs = new Map();
const voterUnsubs = new Map();
let itemsOrder = [];
const suggestionsState = new Map(); // suggestionId -> { data, voterCount }
const suggestionVoterUnsubs = new Map();

// ---------- Auth ----------

el("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = el("adminEmail").value.trim();
  const password = el("adminPassword").value;
  const errorEl = el("loginError");
  errorEl.textContent = "";
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    console.error(err);
    errorEl.textContent = "Login failed. Check email/password.";
  }
});

el("logoutBtn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (!user || user.isAnonymous) {
    showLoggedOut();
    return;
  }
  const adminDoc = await getDoc(doc(db, "admins", user.uid));
  if (!adminDoc.exists()) {
    el("loginError").textContent = "This account is not an admin. Ask an existing admin to add your UID to the admins collection.";
    await signOut(auth);
    return;
  }
  currentUid = user.uid;
  showLoggedIn();
  watchItems();
  watchSuggestions();
});

function showLoggedOut() {
  el("loginPanel").classList.remove("hidden");
  el("adminPanel").classList.add("hidden");
}

function showLoggedIn() {
  el("loginPanel").classList.add("hidden");
  el("adminPanel").classList.remove("hidden");
}

// ---------- Items (admin view, live) ----------

function watchItems() {
  const q = query(collection(db, "items"), orderBy("order", "asc"));
  onSnapshot(q, (snap) => {
    const seen = new Set();
    itemsOrder = [];
    snap.forEach((d) => {
      seen.add(d.id);
      itemsOrder.push(d.id);
      const existing = itemsState.get(d.id);
      itemsState.set(d.id, {
        item: { id: d.id, ...d.data() },
        options: existing?.options || new Map(),
        voteCounts: existing?.voteCounts || new Map(),
      });
      if (!optionUnsubs.has(d.id)) watchOptions(d.id);
      if (!voterUnsubs.has(d.id)) watchVoters(d.id);
    });
    for (const id of [...itemsState.keys()]) {
      if (!seen.has(id)) {
        itemsState.delete(id);
        optionUnsubs.get(id)?.();
        optionUnsubs.delete(id);
        voterUnsubs.get(id)?.();
        voterUnsubs.delete(id);
      }
    }
    renderAdminItems();
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
    renderAdminItems();
  });
  optionUnsubs.set(itemId, unsub);
}

function watchVoters(itemId) {
  const unsub = onSnapshot(collection(db, "votes", itemId, "voters"), (snap) => {
    const state = itemsState.get(itemId);
    if (!state) return;
    const counts = new Map();
    snap.forEach((d) => {
      const optionId = d.data().optionId;
      counts.set(optionId, (counts.get(optionId) || 0) + 1);
    });
    state.voteCounts = counts;
    renderAdminItems();
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
    renderAdminSuggestions();
  });
}

function watchSuggestionVoters(suggestionId) {
  const unsub = onSnapshot(collection(db, "suggestions", suggestionId, "voters"), (snap) => {
    const s = suggestionsState.get(suggestionId);
    if (!s) return;
    s.voterCount = snap.size;
    renderAdminSuggestions();
  });
  suggestionVoterUnsubs.set(suggestionId, unsub);
}

// ---------- Admin actions ----------

async function toggleActive(itemId, active) {
  await updateDoc(doc(db, "items", itemId), { active });
}

async function addItemAsAdmin(name, question, options) {
  const itemRef = doc(collection(db, "items"));
  const batch = writeBatch(db);
  batch.set(itemRef, {
    name,
    question,
    active: true,
    order: Date.now(),
    createdAt: serverTimestamp(),
    createdBy: currentUid,
  });
  options.forEach((label, idx) => {
    const optRef = doc(collection(db, "items", itemRef.id, "options"));
    batch.set(optRef, { label, order: idx });
  });
  await batch.commit();
}

async function addOptionToItem(itemId, label, nextOrder) {
  const optRef = doc(collection(db, "items", itemId, "options"));
  await writeBatch(db).set(optRef, { label, order: nextOrder }).commit();
}

async function approveSuggestion(suggestionId, name, question, options) {
  const itemRef = doc(collection(db, "items"));
  const batch = writeBatch(db);
  batch.set(itemRef, {
    name,
    question,
    active: true,
    order: Date.now(),
    createdAt: serverTimestamp(),
    createdBy: currentUid,
  });
  options.forEach((label, idx) => {
    const optRef = doc(collection(db, "items", itemRef.id, "options"));
    batch.set(optRef, { label, order: idx });
  });
  batch.update(doc(db, "suggestions", suggestionId), { status: "approved" });
  await batch.commit();
}

async function rejectSuggestion(suggestionId) {
  await updateDoc(doc(db, "suggestions", suggestionId), { status: "rejected" });
}

// ---------- Rendering ----------

function renderAdminItems() {
  const container = el("adminItemsList");
  if (itemsOrder.length === 0) {
    container.innerHTML = `<p class="text-stone-500">No items yet.</p>`;
    return;
  }
  container.innerHTML = itemsOrder
    .map((itemId) => {
      const state = itemsState.get(itemId);
      if (!state) return "";
      const { item, options, voteCounts } = state;
      const optionsArr = [...options.values()];
      const total = optionsArr.reduce((s, o) => s + (voteCounts.get(o.id) || 0), 0);
      const rows = optionsArr
        .map((o) => {
          const count = voteCounts.get(o.id) || 0;
          return `
          <li class="flex items-center justify-between text-sm py-1 border-b border-stone-100">
            <span>${escapeHtml(o.label)}</span>
            <span class="font-semibold">${count} votes (${percent(count, total)}%)</span>
          </li>`;
        })
        .join("");
      return `
        <div class="admin-card ${item.active ? "" : "admin-card--inactive"}">
          <div class="flex items-center justify-between">
            <h3 class="font-bold text-lg">${escapeHtml(item.name)} ${item.active ? "" : "<span class='text-xs text-red-600'>(inactive)</span>"}</h3>
            <button class="btn-secondary text-sm" data-toggle-active="${item.id}" data-active="${item.active}">
              ${item.active ? "Deactivate" : "Activate"}
            </button>
          </div>
          <p class="text-stone-500 text-sm mb-2">${escapeHtml(item.question)}</p>
          <ul class="mb-2">${rows}</ul>
          <form class="flex gap-2" data-add-option-form="${item.id}">
            <input type="text" class="form-input text-sm" placeholder="New option label" maxlength="${LIMITS.optionLabel}" required />
            <button type="submit" class="btn-primary text-sm whitespace-nowrap">Add option</button>
          </form>
        </div>`;
    })
    .join("");

  container.querySelectorAll("[data-toggle-active]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const active = btn.dataset.active === "true";
      toggleActive(btn.dataset.toggleActive, !active);
    });
  });
  container.querySelectorAll("[data-add-option-form]").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const itemId = form.dataset.addOptionForm;
      const input = form.querySelector("input");
      const label = input.value.trim();
      if (!label) return;
      const state = itemsState.get(itemId);
      const nextOrder = state ? state.options.size : 0;
      await addOptionToItem(itemId, label, nextOrder);
      input.value = "";
    });
  });
}

function renderAdminSuggestions() {
  const container = el("adminSuggestionsList");
  const arr = [...suggestionsState.values()].sort((a, b) => b.voterCount - a.voterCount);
  if (arr.length === 0) {
    container.innerHTML = `<p class="text-stone-500">No pending suggestions.</p>`;
    return;
  }
  container.innerHTML = arr
    .map((s) => {
      const name = s.data.name;
      return `
      <div class="admin-card">
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-bold">${escapeHtml(name)} <span class="text-sm text-stone-500">(${s.voterCount} suggestions)</span></h3>
          <div class="flex gap-2">
            <button class="btn-secondary text-sm" data-reject="${s.data.id}">Reject</button>
            <button class="btn-primary text-sm" data-approve="${s.data.id}">Approve &rarr; Item</button>
          </div>
        </div>
        <form class="approve-form hidden space-y-2" data-approve-form="${s.data.id}">
          <input type="text" class="form-input text-sm" data-field="question" placeholder="Question (e.g. How much ${escapeHtml(name)} would you prefer?)" required />
          <input type="text" class="form-input text-sm" data-field="options" placeholder="Options, comma separated (e.g. 1 KG, 2 KG, 3 KG)" required />
          <button type="submit" class="btn-primary text-sm">Create Item</button>
        </form>
      </div>`;
    })
    .join("");

  container.querySelectorAll("[data-approve]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const form = container.querySelector(`[data-approve-form="${btn.dataset.approve}"]`);
      form.classList.toggle("hidden");
    });
  });
  container.querySelectorAll("[data-reject]").forEach((btn) => {
    btn.addEventListener("click", () => rejectSuggestion(btn.dataset.reject));
  });
  container.querySelectorAll("[data-approve-form]").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const suggestionId = form.dataset.approveForm;
      const suggestion = suggestionsState.get(suggestionId);
      const question = form.querySelector('[data-field="question"]').value.trim();
      const options = form
        .querySelector('[data-field="options"]')
        .value.split(",")
        .map((o) => o.trim())
        .filter(Boolean);
      if (!question || options.length < LIMITS.minOptions) {
        alert("Please provide a question and at least 2 options.");
        return;
      }
      await approveSuggestion(suggestionId, suggestion.data.name, question, options);
    });
  });
}

// ---------- Seed demo data ----------

const SEED_ITEMS = [
  { name: "Rice", question: "How much rice would you prefer?", options: ["3 KG", "4 KG", "5 KG"] },
  { name: "Pasta", question: "How much pasta would you prefer?", options: ["1 KG", "2 KG", "3 KG"] },
  { name: "Oil", question: "How much oil would you prefer?", options: ["1 bottle", "2 bottles", "3 bottles"] },
  { name: "Beans", question: "How much beans would you prefer?", options: ["1 pack", "2 packs", "3 packs"] },
];

el("seedDataBtn").addEventListener("click", async () => {
  el("seedDataBtn").disabled = true;
  el("seedDataBtn").textContent = "Seeding…";
  try {
    for (const item of SEED_ITEMS) {
      await addItemAsAdmin(item.name, item.question, item.options);
    }
    el("seedDataBtn").textContent = "Done! Seeded Rice / Pasta / Oil / Beans";
  } catch (err) {
    console.error(err);
    el("seedDataBtn").textContent = "Seeding failed — see console";
  } finally {
    el("seedDataBtn").disabled = false;
  }
});

// ---------- Admin add-item form ----------

const optionsContainer = el("adminOptionsContainer");
function addAdminOptionField() {
  if (optionsContainer.children.length >= LIMITS.maxOptions) return;
  const wrapper = document.createElement("div");
  wrapper.className = "option-field";
  wrapper.innerHTML = `
    <input type="text" class="option-input" maxlength="${LIMITS.optionLabel}" placeholder="e.g. 2 KG" />
    <button type="button" class="option-remove">&times;</button>
  `;
  wrapper.querySelector(".option-remove").addEventListener("click", () => {
    if (optionsContainer.children.length > LIMITS.minOptions) wrapper.remove();
  });
  optionsContainer.appendChild(wrapper);
}
addAdminOptionField();
addAdminOptionField();
el("adminAddOptionBtn").addEventListener("click", addAdminOptionField);

el("adminAddItemForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = el("adminItemName").value.trim();
  const question = el("adminItemQuestion").value.trim();
  const options = [...optionsContainer.querySelectorAll(".option-input")]
    .map((i) => i.value.trim())
    .filter(Boolean);
  const errorEl = el("adminItemFormError");
  if (!name || !question || options.length < LIMITS.minOptions) {
    errorEl.textContent = "Please fill in all fields and provide at least 2 options.";
    return;
  }
  await addItemAsAdmin(name, question, options);
  el("adminItemName").value = "";
  el("adminItemQuestion").value = "";
  optionsContainer.innerHTML = "";
  addAdminOptionField();
  addAdminOptionField();
  errorEl.textContent = "";
});
