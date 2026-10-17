# Rascal Co. — Order Website

An ordering website for **Rascal Co.**, a small-batch bakehouse in Singapore run by a friend.
Customers order the **Starter Box** for Sunday collection or delivery, pay by **PayNow**, upload their
payment screenshot, and the order lands in a Google Sheet, ready to check against the bank.

## Why this exists

Rascal Co. bakes in small batches and sells through Instagram. Orders used to come in by hand,
and payments had to be matched one chat at a time. I reached out to my friend to offer some help,
and this project is the result: a site that looks as good as the bakes, works well on a phone
(where almost every order happens), and does the admin work automatically. The whole thing is free
to host and run.

Built by Tai Rong as a personal side project to support a friend's business.

---

## What it does

**For customers**
- A mobile-first, single-page site. Its visual style is inspired by Ekaterina Tsygankova's
  *Scandibakes* concept on Behance.
- A scroll animation that opens the Starter Box into its four bakes, with quantities shown on each photo.
- An order form: name, phone, WhatsApp or Telegram, number of boxes (1–20), self-collection or
  delivery (with a split Singapore address), a time slot and notes.
- Live pricing: S$26 per box, plus S$15 delivery, which is free when the boxes come to more than S$90.
- A **PayNow QR code that fills in the exact amount and the order reference**, so customers can't
  mistype either one. On a phone, the UEN, amount and reference each have a Copy button.
- A screenshot upload. The image is shrunk on the phone before sending (about 150 KB, plus a 20 KB preview).
- A thank-you popup that summarises the order.
- A **Friday 6pm cut-off**. After that, orders roll over to the following Sunday. The cut-off is
  checked again when the order is sent, and again in the script.
- A **WhatsApp backup**. If the order can't be saved, the customer can send it on WhatsApp with
  every detail already typed out.

**For the business**
- Each order becomes a row in Google Sheets, with tick boxes for **Paid** and **Done**.
- The screenshot is saved privately to Google Drive, linked from the row, and shown as a preview.
- An email arrives for every order, with the screenshot attached.
- Duplicate submissions are ignored. Totals are recalculated by the script, so the browser is never trusted.

---

## How it fits together

```
 Customer's phone                     Google (free)
┌──────────────────────┐   order    ┌──────────────────────────┐
│ index.html on Netlify│──────────▶│ Apps Script web app      │
│  · form + checks     │  JSON     │  (Code.gs)               │
│  · PayNow QR         │◀──────────│   ├─ Google Sheet: row   │
│  · screenshot resize │  ok / err │   ├─ Google Drive: image │
└──────────────────────┘           │   └─ Gmail: order email  │
          │ if it can't save       └──────────────────────────┘
          ▼
   WhatsApp message with the order typed out
```

There is no server or database to look after. Netlify hosts the page, and Google Apps Script receives the orders.

---

## Files

```
site/                     ← upload this folder to Netlify
  index.html              the whole website (styles and scripts included)
  favicon.ico             browser tab icon
  site.webmanifest        home-screen icon settings for Android
  images/
    box.png               the open box (top of the page and centre of the scroll story)
    cookie.jpg            brown butter chocolate chip cookie
    muffin.jpg            blueberry streusel muffin
    matcha.jpg            matcha financier
    lemon.jpg             lemon basil cake
    favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png
apps-script/
  Code.example.gs         the order script. Fill in SPREADSHEET_ID and NOTIFY_EMAIL,
                          then paste it into Apps Script.
README.md                 this file
.gitignore                keeps customer data, test copies and junk files out of the repo
```

> **Keep private:** the real Sheet ID, the notification email, order exports, payment screenshots
> and bank statements. They belong in Google, not in this repository.

---

## Deploying

### Website (Netlify)
1. Open the site on [app.netlify.com](https://app.netlify.com) and go to **Deploys**.
2. Drag the **whole `site` folder** onto the drop area. Uploading `index.html` on its own
   means the photos won't show.
3. To undo, choose any earlier deploy and click **Publish deploy**.

### Order script (Google Apps Script)
1. Open the order Sheet, then go to **Extensions → Apps Script** and paste in `apps-script/Code.example.gs`.
   Fill in `SPREADSHEET_ID` (or leave it as `''` if the script lives inside the Sheet) and `NOTIFY_EMAIL`. Save.
2. **First time only:** go to **Deploy → New deployment → Web app**. Set *Execute as* to **Me** and
   *Who has access* to **Anyone**. Copy the `/exec` link into `SCRIPT_URL` in `index.html`.
3. **Every update after that:** go to **Deploy → Manage deployments**, click the pencil, choose
   **Version: New version** and **Deploy**. This keeps the same link, so the website doesn't need changing.
4. Check it: open the `/exec` link and it should say *"Rascal Co order endpoint v6 is running"*.
   Then run **`testOrder`** in the editor; the log should show `{"ok":true}`. Delete the test row afterwards.

### Testing locally
```bash
cd site
python3 -m http.server 8000
# open http://localhost:8000
```
To test without touching real orders, point `SCRIPT_URL` at a separate test deployment and set
`SHEET_NAME`, `FOLDER_NAME` and `NOTIFY_EMAIL` to test values in that copy of the script.

---

## Changing things

Line numbers move as the file changes, so search `index.html` for the text shown.

| To change | Where | Search for |
|---|---|---|
| Price, delivery fee, free-delivery threshold, max boxes, WhatsApp number | `index.html` | `var PRICE = 26` |
| The same prices, as the script checks them | `Code.gs` (`apps-script/Code.example.gs` in this repo), top settings | `PRICE`, `DELIVERY_FEE`, `FREE_DELIVERY_OVER`, `MAX_BOXES` |
| Order cut-off (default Friday 6pm) | `index.html` **and** `Code.gs` (inside `applyCutoff_`) | `CUTOFF_DAY = 5, CUTOFF_HOUR = 18` |
| Time slots | `index.html` | `<option>10am to 12pm` |
| PayNow UEN or payee name | `index.html` | `PAYNOW_UEN` |
| Where orders are saved | `index.html` | `var SCRIPT_URL` |
| Contact details, Instagram, collection postal code | `index.html` | `+65 8813 6672`, `instagram.com`, `S670542` |
| Which Sheet, tab, Drive folder and email the script uses | `Code.gs`, top settings | `SPREADSHEET_ID`, `SHEET_NAME`, `FOLDER_NAME`, `NOTIFY_EMAIL` |

> If you change prices or the cut-off, change them in **both** files, then redeploy both.

**Photos:** replace a file in `site/images/` with a new one of **the same name**, then upload the folder again.
For the four bake circles, use a roughly square photo with the bake in the centre. Keep each file under
about 500 KB so the page loads fast on mobile data.

---

## The order Sheet

| Column | Contents |
|---|---|
| A Received | When the order arrived (set the Sheet's time zone to GMT+8 under **File → Settings**) |
| B Reference | `RC-MMDD-XXXX`. MMDD is the Sunday, and the same reference appears in the PayNow payment. |
| C–F | Name, phone, contact method, Telegram username |
| G–L | Boxes, collection or delivery, Sunday date, time slot, address, notes |
| M Total (S$) | Calculated by the script |
| N Paid / O Done | Tick boxes for you |
| P Payment screenshot | Link to the private file in Drive |
| Q Screenshot preview | A preview picture of the payment screenshot |

**Matching payments:** each PayNow payment carries the order's `RC-` reference. Compare the Sheet
against your bank transactions and tick **Paid**. Orders placed after the cut-off are moved to the
next Sunday, and their Notes start with `[Moved from …]`.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| The site says *"We could not record your order (…)"* | The text in brackets is the reason. Also check Apps Script → **Executions**. |
| *"Unexpected reply from the order script"* | The deployment's access isn't set to **Anyone**, or `SCRIPT_URL` is wrong. |
| Orders appear far down the Sheet | Something is typed further down column B. Clear everything below the last order. |
| No preview picture | Check the Executions log for that order; it says how the picture was placed. The "View screenshot" link always works. |
| Changes don't show on the live site | Upload the whole folder again, then hard-refresh (**Cmd + Shift + R**). |

---

## Credits

- Design direction inspired by **Scandibakes, Corporate website** by Ekaterina Tsygankova (Behance).
- Fonts: **Instrument Serif** and **Figtree** (Google Fonts).
- QR codes: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase (MIT), included in `index.html`.
- Photos: Rascal Co.
- Built with the help of Claude.
