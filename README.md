# Ramadan Bag — Voting Platform

Real-time, mobile-first voting app so beneficiaries can vote on what goes into the Ramadan bag
(and quantities). Built as plain HTML/CSS/JS + Firebase (no build step / no Node.js required to run).

## Stack

- Vanilla JS (ES modules), Tailwind via CDN
- Firebase Authentication (Anonymous for visitors, Email/Password for admins)
- Firebase Firestore with real-time `onSnapshot` listeners
- English/Arabic i18n with RTL support

## 1. Create a Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) and create a project.
2. **Build > Authentication > Get started.** Enable the **Anonymous** sign-in provider and the
   **Email/Password** provider (used for admins only).
3. **Build > Firestore Database > Create database.** Start in production mode (the rules file
   below locks it down).
4. **Project settings > General > Your apps > Add app > Web (`</>`).** Register the app and copy
   the `firebaseConfig` object.

## 2. Configure the app

Paste your config into `js/firebase-config.js`:

```js
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
};
```

## 3. Deploy security rules & indexes

Using the [Firebase CLI](https://firebase.google.com/docs/cli) (`npm install -g firebase-tools`,
or `npx firebase-tools` if you don't want a global install):

```bash
firebase login
firebase use --add        # pick your project
firebase deploy --only firestore:rules,firestore:indexes
```

If you don't have Node/npm available, you can instead paste the contents of `firestore.rules`
directly into **Firestore > Rules** in the console, and manually create the two composite
indexes listed in `firestore.indexes.json` under **Firestore > Indexes** (the app will also show
a direct "create index" link in the browser console the first time a query needs one).

## 4. Run it locally

Opening `index.html` directly via `file://` will **not** work because ES modules require HTTP.
Serve the folder with any static server, for example:

```bash
# Python (usually preinstalled)
python -m http.server 5500

# or, if you install Node later
npx serve .

# or Firebase Hosting's local emulator
npx firebase-tools emulators:start --only hosting
```

Then open `http://localhost:5500`.

## 5. Create your first admin

1. In Firebase console **Authentication > Users > Add user**, create an admin with an email +
   password.
2. Copy that user's **UID**.
3. In **Firestore > Data**, create a document at `admins/<that UID>` with any field (e.g.
   `email: "you@example.com"`). Its existence is what grants admin rights — the rules only check
   that the document exists.
4. Open `admin.html`, log in with that email/password.

## 6. Seed the demo data

In `admin.html`, click **"Seed Rice / Pasta / Oil / Beans"** once. This creates the four starter
items (Rice, Pasta, Oil, Beans), each with its own unit (KG / bottles / packs) and Arabic
translation. You can edit/deactivate them afterwards, or just add your real items instead.

## 7. Deploy to Firebase Hosting (optional)

```bash
firebase deploy --only hosting
```

## How it works

- **Free-form quantity voting:** instead of picking from a preset list of options, a visitor types
  the quantity they want (e.g. `4`) next to the item's fixed unit label (e.g. `KG`) and submits.
  There's no preset "options" list to manage at all — the distribution shown under each item
  (and in the "Current Preferences" summary) is built live from whatever quantities people have
  actually typed in.
- **Real-time sync:** `index.html`/`admin.html` attach Firestore `onSnapshot` listeners to the
  `items` collection, each item's `votes/{itemId}/voters` subcollection, and `suggestions`. Any
  write from any device re-fires these listeners on every other connected device instantly —
  there is no polling and no manual refresh.
- **Anonymous identity:** on load, `js/firebase-init.js` signs the visitor in anonymously via
  Firebase Auth. That `uid` is stable for the browser/device (persisted by the Firebase SDK) and
  is used as the document ID for `votes/{itemId}/voters/{uid}`, which is what makes "one answer per
  item per device" structural rather than merely enforced in the UI.
- **No mutable vote counters, by design:** each vote is its own document
  (`votes/{itemId}/voters/{uid}`, one per user per item) holding the `quantity` that user typed.
  Submitting or changing an answer is a single `setDoc` write to that one document — already
  atomic, no transaction needed. Every connected client tallies the live
  `votes/{itemId}/voters` subcollection itself via `onSnapshot`, grouping by the exact quantity
  value, so there is no counter field anywhere for a client to tamper with. Suggestion popularity
  works the same way via `suggestions/{id}/voters`.
- **Security rules** (`firestore.rules`) only let a user create/update their *own* vote document
  (doc id = their uid), and only with a `quantity` that's a number within a sane range
  (`0 < quantity <= 1000`) — so a client can't submit garbage or absurd values. Re-"suggesting" an
  item you already suggested becomes a Firestore *update* (since the voter doc already exists),
  which is explicitly disallowed — so duplicate suggestion-bumps are rejected structurally, not
  just by UI convention. Item creation is validated for required fields and length limits; only
  admins (presence of an `admins/{uid}` doc) can edit/delete items or approve/reject suggestions.

## Firestore schema

```
items/{itemId}
  name, nameAr?, question, questionAr?, unit, unitAr?, active, order, createdAt, createdBy

votes/{itemId}/voters/{uid}        (doc id = uid -> one answer per user per item)
  quantity, votedAt

suggestions/{suggestionId}        (doc id = slugified name, so duplicates merge)
  name, status ("pending" | "approved" | "rejected"), createdAt, createdBy
  voters/{uid}                    (doc id = uid -> one suggestion-bump per user)
    suggestedAt

admins/{uid}
  (presence of the doc = admin; managed manually via console)
```

Vote/suggestion counts are never stored — every client computes them live by counting/grouping
documents in the `voters` subcollections above. The `*Ar` fields are optional; when present the
page shows them while in Arabic mode, falling back to the English field otherwise.

## Known MVP trade-offs

- Arabic translations exist for all UI chrome, and admin-created items can carry real
  `nameAr`/`questionAr`/`unitAr` translations (the seeded Rice/Pasta/Oil/Beans do). Items added by
  the public via "+ Add Item" are stored as typed, with no auto-translation, same as any real
  survey tool.
- There's no email verification/password-reset flow for admins — add/manage admin users and the
  `admins/{uid}` grant doc directly in the Firebase console, which is enough for a small trusted
  team.
- Order of newly added items uses a client timestamp (`Date.now()`), which is fine at this scale.
- Quantities accept any positive number up to 1000 in steps of 0.5 on the input control; the
  security rules independently enforce the same upper bound server-side.
