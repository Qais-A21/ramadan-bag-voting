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
items (Rice, Pasta, Oil, Beans) with their default quantity options, exactly as described in the
spec. You can edit/deactivate them afterwards, or just add your real items instead.

## 7. Deploy to Firebase Hosting (optional)

```bash
firebase deploy --only hosting
```

## How it works

- **Real-time sync:** `index.html`/`admin.html` attach Firestore `onSnapshot` listeners to the
  `items` collection, each item's `options` subcollection, each user's own vote doc, and
  `suggestions`. Any write from any device re-fires these listeners on every other connected
  device instantly — there is no polling and no manual refresh.
- **Anonymous identity:** on load, `js/firebase-init.js` signs the visitor in anonymously via
  Firebase Auth. That `uid` is stable for the browser/device (persisted by the Firebase SDK) and
  is used as the document ID for `votes/{itemId}/voters/{uid}`, which is what makes "one vote per
  item per device" structural rather than merely enforced in the UI.
- **No mutable vote counters, by design:** instead of a `voteCount` field that a client could try
  to overwrite directly, each vote is its own document
  (`votes/{itemId}/voters/{uid}`, one per user per item). Casting or changing a vote is a single
  `setDoc` write to that one document — already atomic, no transaction needed. Every connected
  client tallies the live `votes/{itemId}/voters` subcollection itself via `onSnapshot`, so
  results update in real time and there is simply no counter field left for anyone to tamper
  with (there's no `voteCount: 10000` attack possible, because `voteCount` doesn't exist).
  Suggestion popularity works the same way via `suggestions/{id}/voters`.
- **Security rules** (`firestore.rules`) only let a user create/update their *own* vote document
  (doc id = their uid), and only pointing at an option that actually exists for that item.
  Re-"suggesting" an item you already suggested becomes a Firestore *update* (since the voter doc
  already exists), which is explicitly disallowed — so duplicate suggestion-bumps are rejected
  structurally, not just by UI convention. Item/option creation is validated for required fields
  and length limits; only admins (presence of an `admins/{uid}` doc) can edit/delete items,
  options, or approve/reject suggestions.

## Firestore schema

```
items/{itemId}
  name, question, active, order, createdAt, createdBy
  options/{optionId}
    label, order

votes/{itemId}/voters/{uid}        (doc id = uid -> one vote per user per item)
  optionId, votedAt

suggestions/{suggestionId}        (doc id = slugified name, so duplicates merge)
  name, status ("pending" | "approved" | "rejected"), createdAt, createdBy
  voters/{uid}                    (doc id = uid -> one suggestion-bump per user)
    suggestedAt

admins/{uid}
  (presence of the doc = admin; managed manually via console)
```

Vote/suggestion counts are never stored — every client computes them live by counting documents
in the `voters` subcollections above.

## Known MVP trade-offs

- Arabic translations exist for all UI chrome; user-generated item/question/option text is stored
  as typed (no auto-translation), same as any real survey tool.
- There's no email verification/password-reset flow for admins — add/manage admin users and the
  `admins/{uid}` grant doc directly in the Firebase console, which is enough for a small trusted
  team.
- Order of newly added items/options uses a client timestamp (`Date.now()`), which is fine at
  this scale; admins can still deactivate/reorder by editing `order` in the console if needed.
