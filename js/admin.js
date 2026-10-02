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
  setDoc,
  writeBatch,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { escapeHtml, percent } from "./shared.js";

function el(id) {
  return document.getElementById(id);
}

let currentUid = null;
const itemsState = new Map(); // itemId -> { item, quantityCounts: Map }
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
        quantityCounts: existing?.quantityCounts || new Map(),
      });
      if (!voterUnsubs.has(d.id)) watchVoters(d.id);
    });
    for (const id of [...itemsState.keys()]) {
      if (!seen.has(id)) {
        itemsState.delete(id);
        voterUnsubs.get(id)?.();
        voterUnsubs.delete(id);
      }
    }
    renderAdminItems();
  });
}

function watchVoters(itemId) {
  const unsub = onSnapshot(collection(db, "votes", itemId, "voters"), (snap) => {
    const state = itemsState.get(itemId);
    if (!state) return;
    const counts = new Map();
    snap.forEach((d) => {
      const qty = d.data().quantity;
      counts.set(qty, (counts.get(qty) || 0) + 1);
    });
    state.quantityCounts = counts;
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
      suggestionsState.set(d.id, {
        data: { id: d.id, ...d.data() },
        voterCount: existing?.voterCount ?? 0,
        quantityTexts: existing?.quantityTexts ?? [],
      });
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
    s.quantityTexts = [];
    snap.forEach((d) => {
      const qty = d.data().quantityText;
      if (qty) s.quantityTexts.push(qty);
    });
    renderAdminSuggestions();
  });
  suggestionVoterUnsubs.set(suggestionId, unsub);
}

// ---------- Admin actions ----------

async function toggleActive(itemId, active) {
  await updateDoc(doc(db, "items", itemId), { active });
}

async function deleteItem(itemId) {
  await deleteDoc(doc(db, "items", itemId));
}

async function addItemAsAdmin(name, question, unit, extra = {}) {
  const itemRef = doc(collection(db, "items"));
  await setDoc(itemRef, {
    name,
    question,
    unit,
    ...(extra.nameAr ? { nameAr: extra.nameAr } : {}),
    ...(extra.questionAr ? { questionAr: extra.questionAr } : {}),
    ...(extra.unitAr ? { unitAr: extra.unitAr } : {}),
    active: true,
    order: Date.now(),
    createdAt: serverTimestamp(),
    createdBy: currentUid,
  });
}

// The question is never custom-typed — it's always auto-built from the
// item name, so every approved item asks a consistent "how much" question.
async function approveSuggestion(suggestionId, name, unit) {
  const itemRef = doc(collection(db, "items"));
  const batch = writeBatch(db);
  batch.set(itemRef, {
    name,
    question: `How much ${name} would you prefer?`,
    unit,
    active: true,
    order: Date.now(),
    createdAt: serverTimestamp(),
    createdBy: currentUid,
  });
  batch.update(doc(db, "suggestions", suggestionId), { status: "approved" });
  await batch.commit();
}

async function rejectSuggestion(suggestionId) {
  await updateDoc(doc(db, "suggestions", suggestionId), { status: "rejected" });
}

// ---------- Rendering ----------

function formatQty(qty) {
  return Number.isInteger(qty) ? String(qty) : String(qty).replace(/\.0$/, "");
}

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
      const { item, quantityCounts } = state;
      const total = [...quantityCounts.values()].reduce((a, b) => a + b, 0);
      const sortedEntries = [...quantityCounts.entries()].sort((a, b) => a[0] - b[0]);
      const rows = sortedEntries
        .map(([qty, count]) => {
          return `
          <li class="flex items-center justify-between text-sm py-1 border-b border-stone-100">
            <span>${formatQty(qty)} ${escapeHtml(item.unit)}</span>
            <span class="font-semibold">${count} votes (${percent(count, total)}%)</span>
          </li>`;
        })
        .join("");
      return `
        <div class="admin-card ${item.active ? "" : "admin-card--inactive"}">
          <div class="flex items-center justify-between">
            <h3 class="font-bold text-lg">${escapeHtml(item.name)} ${item.active ? "" : "<span class='text-xs text-red-600'>(inactive)</span>"}</h3>
            <div class="flex gap-2">
              <button class="btn-secondary text-sm" data-toggle-active="${item.id}" data-active="${item.active}">
                ${item.active ? "Deactivate" : "Activate"}
              </button>
              <button class="btn-secondary text-sm text-red-600" data-delete="${item.id}">Delete</button>
            </div>
          </div>
          <p class="text-stone-500 text-sm mb-2">${escapeHtml(item.question)} (unit: ${escapeHtml(item.unit)})</p>
          <ul class="mb-2">${rows || '<li class="text-sm text-stone-400 py-1">No answers yet.</li>'}</ul>
        </div>`;
    })
    .join("");

  container.querySelectorAll("[data-toggle-active]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const active = btn.dataset.active === "true";
      toggleActive(btn.dataset.toggleActive, !active);
    });
  });
  container.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (confirm("Permanently delete this item? This cannot be undone (consider Deactivate instead if you just want to hide it).")) {
        deleteItem(btn.dataset.delete);
      }
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
      const quantitiesHtml = s.quantityTexts.length
        ? `<p class="text-sm text-stone-500 mb-2">Requested amounts: ${s.quantityTexts.map(escapeHtml).join(", ")}</p>`
        : "";
      return `
      <div class="admin-card">
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-bold">${escapeHtml(name)} <span class="text-sm text-stone-500">(${s.voterCount} suggestions)</span></h3>
          <div class="flex gap-2">
            <button class="btn-secondary text-sm" data-reject="${s.data.id}">Reject</button>
            <button class="btn-primary text-sm" data-approve="${s.data.id}">Approve &rarr; Item</button>
          </div>
        </div>
        ${quantitiesHtml}
        <p class="text-xs text-stone-400 mb-2">Will ask: "How much ${escapeHtml(name)} would you prefer?"</p>
        <form class="approve-form hidden space-y-2" data-approve-form="${s.data.id}">
          <select class="form-input text-sm" data-field="unitSelect" required>
            <option value="" disabled selected>Select unit…</option>
            <option value="KG">KG</option>
            <option value="Pack">Pack</option>
            <option value="Bottle">Bottle</option>
            <option value="__other__">Other (type below)</option>
          </select>
          <input type="text" class="form-input text-sm hidden" data-field="unitOther" placeholder="Custom unit" maxlength="20" />
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
    const select = form.querySelector('[data-field="unitSelect"]');
    const otherInput = form.querySelector('[data-field="unitOther"]');
    select.addEventListener("change", () => {
      const isOther = select.value === "__other__";
      otherInput.classList.toggle("hidden", !isOther);
      otherInput.required = isOther;
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const suggestionId = form.dataset.approveForm;
      const suggestion = suggestionsState.get(suggestionId);
      const unit = select.value === "__other__" ? otherInput.value.trim() : select.value;
      if (!unit) {
        alert("Please select or enter a unit.");
        return;
      }
      await approveSuggestion(suggestionId, suggestion.data.name, unit);
    });
  });
}

// ---------- Seed demo data ----------

const SEED_ITEMS = [
  { name: "Rice", nameAr: "أرز", question: "How much rice would you prefer?", questionAr: "كم كمية الأرز المفضلة لديك؟", unit: "KG", unitAr: "كجم" },
  { name: "Pasta", nameAr: "مكرونة", question: "How much pasta would you prefer?", questionAr: "كم كمية المكرونة المفضلة لديك؟", unit: "KG", unitAr: "كجم" },
  { name: "Oil", nameAr: "زيت", question: "How much oil would you prefer?", questionAr: "كم كمية الزيت المفضلة لديك؟", unit: "bottles", unitAr: "زجاجة" },
  { name: "Beans", nameAr: "فول", question: "How much beans would you prefer?", questionAr: "كم كمية الفول المفضلة لديك؟", unit: "packs", unitAr: "عبوة" },
];

el("seedDataBtn").addEventListener("click", async () => {
  el("seedDataBtn").disabled = true;
  el("seedDataBtn").textContent = "Seeding…";
  try {
    for (const item of SEED_ITEMS) {
      await addItemAsAdmin(item.name, item.question, item.unit, {
        nameAr: item.nameAr,
        questionAr: item.questionAr,
        unitAr: item.unitAr,
      });
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

el("adminAddItemForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = el("adminItemName").value.trim();
  const nameAr = el("adminItemNameAr").value.trim();
  const question = el("adminItemQuestion").value.trim();
  const questionAr = el("adminItemQuestionAr").value.trim();
  const unit = el("adminItemUnit").value.trim();
  const unitAr = el("adminItemUnitAr").value.trim();
  const errorEl = el("adminItemFormError");
  if (!name || !question || !unit) {
    errorEl.textContent = "Please fill in item name, question, and unit.";
    return;
  }
  await addItemAsAdmin(name, question, unit, { nameAr, questionAr, unitAr });
  el("adminItemName").value = "";
  el("adminItemNameAr").value = "";
  el("adminItemQuestion").value = "";
  el("adminItemQuestionAr").value = "";
  el("adminItemUnit").value = "";
  el("adminItemUnitAr").value = "";
  errorEl.textContent = "";
});
