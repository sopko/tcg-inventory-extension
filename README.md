# TCG Listing Assistant — MVP

A local Chrome extension that imports CSV files exported from the TCGplayer Mobile App and enters those cards into the TCGplayer Seller Portal.

## What this MVP does

- Imports the TCGplayer Mobile App CSV schema.
- Reads `Product ID`, `Condition`, `Printing`, `Add to Quantity`, and market-price fields.
- Groups duplicate CSV rows by Product ID + target inventory row.
- Opens `https://store.tcgplayer.com/admin/product/manage/{Product ID}`.
- Maps all five card conditions in normal and foil printings to the exact
  `ConditionRow` used by TCGplayer. English, French, German, Italian, Japanese,
  and Spanish rows are supported when the CSV includes a `Language` column.
- Verifies the row's displayed condition label before changing price or quantity.
- Uses only a price contained in the user-selected CSV, a percentage of that CSV price, or a fixed price entered by the user.
- Does not read or collect pricing information displayed by the Seller Portal.
- Sets and verifies price and quantity, then waits for the user to review and explicitly confirm each Save.
- Offers an explicit automatic mode that uses only a CSV price, verifies the entered values, saves, and continues through the queue.
- Stores queue/progress locally with `chrome.storage.local`.
- Supports pause/resume/reset and records failures.

## Important MVP limitations

This is a first conversion of a private Playwright workflow into a Chrome extension. Test it with a small CSV and low-risk inventory first.

Condition-row IDs are based on the supplied TCGplayer inventory table. The
extension verifies each row label at runtime so a future TCGplayer mapping change
fails safely instead of editing the wrong condition.

The extension assumes you are already logged into the TCGplayer Seller Portal in Chrome. It never asks for or stores your TCGplayer password.

## Install locally

1. Unzip the project.
2. In Chrome, open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the `tcg-listing-assistant` folder.
6. Open and sign in to `https://store.tcgplayer.com/admin/product/catalog` normally.
7. Click the extension icon to open its side panel.
8. Choose a TCGplayer Mobile App CSV.
9. Start with a CSV containing **one card** for the first live test.
10. Click **Start Listing** and watch the Seller Portal page and side panel.

## Pricing modes

- **Market price from CSV**
- **CSV market price × percentage**
- **Fixed user-entered price**

The extension intentionally does not extract Seller Portal pricing data. In
review mode, every card pauses after its values are entered so the seller can
verify the row, price, and quantity before clicking **Confirm & Save This Card**.

## Listing modes

- **Review each card** pauses before every save.
- **Automatically list using CSV prices** accepts `Listing Price`, `Price`, or
  `TCG Market Price` (in that priority order), then saves and continues without
  per-card confirmation. It never substitutes a Seller Portal price.

## Files

- `manifest.json` — Manifest V3 configuration.
- `background.js` — queue/navigation orchestration.
- `content.js` — condition-row validation, form filling, and user-confirmed saving.
- `sidepanel.html` / `sidepanel.css` / `sidepanel.js` — local extension UI and CSV import.

## Next engineering steps after first live test

1. Verify which input events TCGplayer currently requires for price/quantity changes.
2. Add selector diagnostics and automated fixtures for additional TCGplayer product lines.
3. Add **Retry failed** and **Skip current** controls.
4. Add editable per-card price and quantity controls to the review screen.
5. Add a run summary and downloadable results CSV.
6. Add a safety cap for maximum listing price/quantity changes.
7. Add extension versioning and selector diagnostics so Seller Portal UI changes are easier to repair.
8. Only after the workflow is stable, migrate the UI to WXT/React and add licensing/accounts.
