# CGM Sensor Pre-Order — Diabuddies of Karnataka

A pre-order form for CGM sensors, run by volunteers so the Type 1 community in
Karnataka can buy at slightly better prices. People order and pay by UPI, then
collect in person at the next Type One Run / group meetup. No profit is made.

**Live site:** https://chanangad.github.io/cgm-sensor-orders/

---

## How it fits together

```
Browser (GitHub Pages)                Google account
┌──────────────────────┐              ┌──────────────────────────────┐
│ index.html           │   POST/JSONP │ Apps Script web app (/exec)  │
│ script.js  ──────────┼─────────────►│  • records the order         │
│ config.js            │              │  • stores the screenshot     │
│ styles.css           │◄─────────────┤  • verifies the screenshot   │
└──────────────────────┘   orders,    │  • triggers the email        │
                           stats      └───────┬──────────┬───────────┘
                                              │          │
                                     Orders sheet    Drive folder
                                                         │
                                              separate email web app
                                              (different Google account)
```

There is no build step and no framework. The site is plain HTML/CSS/JS served
straight from the repo.

| File | What it is |
| --- | --- |
| `index.html` | The whole page |
| `config.js` | **Everything you normally change**: dates, prices, payee, script URL |
| `script.js` | Form logic, submission, order list |
| `styles.css` | Design system (tokens at the top) and all styling |
| `google-apps-script.js` | A **copy** of the backend. The running code lives in Apps Script |
| `*.png` | Logo and the UPI QR codes |

> `google-apps-script.js` is only a copy. Pushing it to GitHub does **not**
> deploy it — see [Deploying the backend](#deploying-the-backend).

---

## Everyday tasks

### Opening and closing orders

Click the faint gear at the top right of the page, flip the toggle, and enter
the admin password. The state lives server-side in the `ORDERS_ENABLED` script
property, so it applies to everyone immediately.

Anything other than an explicit `true` means closed — deploying the backend can
never reopen orders by itself.

### Starting a new order round

In `config.js`:

```js
DELIVERY_CYCLE: 'July 2026',        // the collection month
NEXT_RUN_DATE: '12th',              // day of the run, shown as "12th July 2026"
ORDER_CLOSES_DATE: "4th July '26",  // shown under the header
```

Then bump the `?v=` number on the `config.js` tag in `index.html` (see
[Caching](#caching)) and push.

### Changing who collects the money

Set `ACTIVE_PAYEE` in `config.js` to one of the keys in `PAYEES`. The name
shown on the page, the UPI ID, the copy button, the QR image and the name
checked against payment screenshots all follow from that one line.

```js
ACTIVE_PAYEE: 'coordinator-a',

PAYEES: {
    'coordinator-a': { name: 'Full Name', upiId: 'someone@bank', qrImage: 'a.png' },
    'coordinator-b': { name: 'Full Name', upiId: '',             qrImage: 'b.png' },
    ...
}
```

(The real names, UPI IDs and QR files are in `config.js`.)

A payee needs a name **plus at least one of** a UPI ID or a QR image. With only
a QR the page shows the QR alone. With neither, the page refuses to show
payment details and blocks ordering rather than displaying a placeholder UPI ID
that would send real money nowhere.

When the *set* of volunteers changes (not when you switch between them), also
update `PAYEES` and `DEFAULT_PAYEE_KEY` in the Apps Script — the backend keeps
its own copy of the names so an order cannot claim its own payee.

### Changing prices

Update `SENSORS` in `config.js`, and mirror the numbers in `PRICES` in the Apps
Script. The backend only uses them to flag orders whose total does not match the
quantities; it never overrides what the customer was shown.

### Caching

GitHub Pages serves HTML with `max-age=600`, and browsers hold on to the JS and
CSS. **Whenever you change `config.js`, `script.js` or `styles.css`, bump the
`?v=` number on its tag in `index.html`**, or returning visitors will keep
running the old file — including old prices.

---

## Deploying

### The website

GitHub Pages serves the **`ui-update`** branch. Pushing to it publishes the
site; the build takes a minute or two.

```bash
git push origin ui-update
```

### Deploying the backend

Editing and saving in the Apps Script editor changes **nothing** on the live
site. The `/exec` URL serves the last *deployed version*.

1. Paste `google-apps-script.js` over the whole script and save.
2. First time only: **Services → + → Drive API** (this powers the OCR).
3. **Deploy → Manage deployments → pencil on the existing deployment →
   Version: New version → Deploy.**

Always edit the **existing** deployment. Creating a *new* deployment issues a
different `/exec` URL, and the site keeps talking to the old one.

Confirm what is actually live:

```bash
curl -sL "$(grep -o "https://script.google.com[^']*" config.js)"
```

It returns the deployed `build` string, which should match `BUILD` at the top
of `google-apps-script.js`.

---

## The orders sheet

One row per order, appended by the backend. Columns 1–14 are the order itself;
the rest is bookkeeping added later.

| # | Column | Notes |
| --- | --- | --- |
| 1–5 | Timestamp, Name, Parent/Guardian, Phone, Email | As submitted |
| 6–9 | Items Summary, Linx Qty, VitaTok Qty, Patch Qty | |
| 10 | Total Sensors | Linx + VitaTok only, patches excluded |
| 11–12 | Pickup, Total Amount | |
| 13 | Payment Proof URL | Drive link. **Not** publicly shared |
| 14 | Transaction ID | Filled from the UTR read off the screenshot |
| 15 | Order ID | Unguessable id used to de-duplicate retries |
| 16 | Flags | `AMOUNT_MISMATCH` if the total disagrees with the quantities |
| 17 | Screenshot Hash | MD5 of the image, used to spot reused screenshots |
| 18–19 | Verification, Payee | See below |
| 20–24 | The per-check columns | See below |

Rows typed in by hand are fine. A row with a name and a quantity but no
timestamp or summary still shows up correctly on the site; a completely blank
row is ignored and not counted.

---

## Payment screenshot verification

After an order is recorded, the backend runs the screenshot through Drive's OCR
and compares it with the order. **It is advisory only — an order is never
rejected on the strength of OCR**, because the person has already paid by the
time it runs. Findings go in the sheet for a human to look at.

Filter **Verification = REVIEW** to see everything needing attention, or filter
one check's column to see a single kind of problem.

| Column | Values |
| --- | --- |
| **Verification** | `OK` · `REVIEW` · `OCR UNAVAILABLE` · `CHECK FAILED` |
| **Amount Check** | `OK` · `MISMATCH` · `NOT FOUND` |
| **Payee Check** | `OK` · `PARTIAL` · `NOT FOUND` · `UNKNOWN PAYEE` |
| **Date Check** | `OK` · `TOO OLD` · `FUTURE` · `NO DATE` |
| **Duplicate Of** | `ROW 92` — blank when the screenshot is new |
| **Verification Notes** | The readable sentence, e.g. *same screenshot as row 92; amount 11700 not found on screenshot* |

What the less obvious values mean:

- **Amount `MISMATCH`** — a rupee figure was read and it disagreed with the
  order total. **`NOT FOUND`** — no figure could be read at all, which usually
  means a photo of a screen, a crop, or an unfamiliar app layout rather than a
  wrong payment.
- **Payee `PARTIAL`** — some words of the payee's name matched but not all.
  Often OCR noise; worth a glance. **`UNKNOWN PAYEE`** — the order named a
  payee that is not in the backend's list, so no name check was possible. An
  order cannot supply its own expected payee name.
- **Date `NO DATE`** — no date was found on the screenshot. Not a problem in
  itself; plenty of apps show only a time. `TOO OLD` uses
  `SCREENSHOT_MAX_AGE_DAYS` (10).
- **Duplicate Of** — the same image bytes were already submitted. This is an
  exact match, so it has no false positives and is the strongest signal here.
- **`OCR UNAVAILABLE`** — verification could not run; the reason is in
  Verification Notes. **`CHECK FAILED`** — something else threw.

Turn the whole thing off with `VERIFY_SCREENSHOTS = false` in the Apps Script.

---

## Settings reference

### Script properties (Apps Script → Project Settings)

| Property | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Required to flip the orders toggle |
| `ORDERS_ENABLED` | `true` opens orders. Anything else means closed |
| `EMAIL_WEBAPP_URL` | `/exec` URL of the separate email-sending web app |
| `EMAIL_TOKEN` | Optional shared secret for that web app |

### Tunables at the top of the Apps Script

| Name | Default | Purpose |
| --- | --- | --- |
| `VERIFY_SCREENSHOTS` | `true` | Master switch for OCR verification |
| `SCREENSHOT_MAX_AGE_DAYS` | `10` | Older screenshots get `TOO OLD` |
| `MAX_SUBMISSIONS_PER_MINUTE` | `20` | Throttle on the public endpoint |
| `MAX_SCREENSHOT_BYTES` | `10 MB` | Larger uploads are rejected |
| `DEFAULT_PAYEE_KEY` | a `PAYEES` key | Used only for orders from a cached old page |
| `BUILD` | date string | Echoed by the web app so a deploy can be confirmed |

---

## Privacy

- The public endpoint returns **only** name, time and what was ordered. Phone
  numbers, emails, amounts and payment-proof links never leave the sheet.
- Payment screenshots are stored in Drive **without** link sharing.
- Order names are escaped everywhere they are displayed and in the
  confirmation email.

---

## Troubleshooting

**A change to the site isn't showing.** Bump the `?v=` on the file's tag in
`index.html`. GitHub Pages also caches HTML for ten minutes.

**A backend change isn't taking effect.** Check the `build` value returned by
the web app URL. If it doesn't match `BUILD` in the file, the deployment wasn't
updated — edit the *existing* deployment and pick **New version**.

**Verification says `OCR UNAVAILABLE`.** Read Verification Notes:

- *add Drive API under Services* — the Advanced Drive Service isn't enabled.
- *permission to call …* — the deployment needs re-authorising for a scope.
- Anything else is the raw error; the Debug tab of the sheet has more.

**Someone says their order vanished.** Search the Debug tab for their Order ID.
Duplicate submissions are recorded once on purpose, and an order placed while
orders were closed is refused server-side.

**Recent Orders looks empty.** Rows entered by hand with no timestamp and no
items summary show name-only until the backend rebuilds them from the quantity
columns. Fully blank rows are ignored.
