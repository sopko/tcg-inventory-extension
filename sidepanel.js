const STATE_KEY = "tcgListingState";
const csvInput = document.querySelector("#csvFile");
const fileSummary = document.querySelector("#fileSummary");
const queueEl = document.querySelector("#queue");
const statusBadge = document.querySelector("#statusBadge");
const progressText = document.querySelector("#progressText");
const progressBar = document.querySelector("#progressBar");
const lastMessage = document.querySelector("#lastMessage");
const startBtn = document.querySelector("#startBtn");
const pauseBtn = document.querySelector("#pauseBtn");
const resumeBtn = document.querySelector("#resumeBtn");
const resetBtn = document.querySelector("#resetBtn");
const marketPercentInput = document.querySelector("#marketPercent");
const fixedPriceInput = document.querySelector("#fixedPrice");
const reviewCard = document.querySelector("#reviewCard");
const reviewDetails = document.querySelector("#reviewDetails");
const confirmSaveBtn = document.querySelector("#confirmSaveBtn");
const pricingCard = document.querySelector("#pricingCard");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (quoted && next === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(field); field = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && next === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function normalize(value) { return String(value ?? "").trim().toLowerCase(); }

function parseCsvPrice(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const CONDITION_ALIASES = {
  "near mint": "Near Mint",
  nearmint: "Near Mint",
  nm: "Near Mint",
  "lightly played": "Lightly Played",
  lightlyplayed: "Lightly Played",
  lp: "Lightly Played",
  "moderately played": "Moderately Played",
  moderatelyplayed: "Moderately Played",
  mp: "Moderately Played",
  "heavily played": "Heavily Played",
  heavilyplayed: "Heavily Played",
  hp: "Heavily Played",
  damaged: "Damaged",
  dmg: "Damaged",
};

const CONDITION_ROW_IDS = {
  "Near Mint|Normal|English": 1,
  "Lightly Played|Normal|English": 36,
  "Moderately Played|Normal|English": 34,
  "Heavily Played|Normal|English": 35,
  "Damaged|Normal|English": 33,
  "Near Mint|Foil|English": 3,
  "Lightly Played|Foil|English": 70,
  "Moderately Played|Foil|English": 68,
  "Heavily Played|Foil|English": 69,
  "Damaged|Foil|English": 67,
};

for (const [language, firstRowId] of Object.entries({
  French: 120,
  German: 130,
  Italian: 140,
  Japanese: 150,
  Spanish: 190,
})) {
  const grades = ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged"];
  grades.forEach((grade, index) => {
    CONDITION_ROW_IDS[`${grade}|Normal|${language}`] = firstRowId + index;
    CONDITION_ROW_IDS[`${grade}|Foil|${language}`] = firstRowId + 5 + index;
  });
}

function normalizeCondition(value) {
  const condition = CONDITION_ALIASES[normalize(value)];
  if (!condition) throw new Error(`Unsupported condition: ${value || "(blank)"}`);
  return condition;
}

function normalizePrinting(value) {
  const printing = normalize(value);
  if (!printing || printing === "normal" || printing === "non-foil" || printing === "nonfoil") return "Normal";
  if (printing === "foil") return "Foil";
  throw new Error(`Unsupported printing: ${value}`);
}

function normalizeLanguage(value) {
  const language = String(value || "English").trim();
  const supported = ["English", "French", "German", "Italian", "Japanese", "Spanish"];
  const match = supported.find((item) => normalize(item) === normalize(language));
  if (!match) throw new Error(`Unsupported language: ${language}`);
  return match;
}

function conditionRow(condition, printing, language) {
  const normalizedCondition = normalizeCondition(condition);
  const normalizedPrinting = normalizePrinting(printing);
  const normalizedLanguage = normalizeLanguage(language);
  const key = `${normalizedCondition}|${normalizedPrinting}|${normalizedLanguage}`;
  const rowId = CONDITION_ROW_IDS[key];
  if (!rowId) throw new Error(`No TCGplayer inventory row is mapped for ${key}.`);

  return {
    selector: `#ConditionRow_${rowId}`,
    label: `${normalizedCondition}${normalizedPrinting === "Foil" ? " Foil" : ""}${normalizedLanguage === "English" ? "" : ` - ${normalizedLanguage}`}`,
    condition: normalizedCondition,
    printing: normalizedPrinting,
    language: normalizedLanguage,
  };
}

function selectedPricingMode() {
  return document.querySelector('input[name="pricing"]:checked')?.value || "csv";
}

function selectedListingMode() {
  return document.querySelector('input[name="listingMode"]:checked')?.value || "review";
}

function refreshListingModeUi() {
  const automatic = selectedListingMode() === "automaticCsv";
  pricingCard.hidden = automatic;
  startBtn.textContent = automatic ? "Start Automatic Listing" : "Start Listing";
}

function buildJobs(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("The CSV does not contain inventory rows.");
  const headers = rows[0].map((h) => h.replace(/^\uFEFF/, "").trim());
  const required = ["Product ID", "Product Name", "Condition", "Printing", "Add to Quantity"];
  const missing = required.filter((h) => !headers.includes(h));
  if (missing.length) throw new Error(`Missing expected columns: ${missing.join(", ")}`);

  const objects = rows.slice(1).map((values, index) => {
    const obj = { __row: index + 2 };
    headers.forEach((h, i) => obj[h] = values[i] ?? "");
    return obj;
  });

  const groups = new Map();
  const listingMode = selectedListingMode();
  const pricingMode = listingMode === "automaticCsv" ? "csv" : selectedPricingMode();
  const marketPercent = Number.parseFloat(marketPercentInput.value) || 95;
  const fixedPrice = Number.parseFloat(fixedPriceInput.value);
  if (pricingMode === "fixed" && (!Number.isFinite(fixedPrice) || fixedPrice <= 0)) {
    throw new Error("Enter a valid fixed price before importing the CSV.");
  }

  for (const row of objects) {
    const productID = Number.parseInt(String(row["Product ID"]).trim(), 10);
    if (!Number.isFinite(productID)) throw new Error(`Row ${row.__row} has an invalid Product ID.`);
    const quantity = Math.max(1, Number.parseInt(String(row["Add to Quantity"] || "1"), 10) || 1);
    const csvPriceValue = row["Listing Price"] || row["Price"] || row["TCG Market Price"] || "";
    const parsedCsvPrice = parseCsvPrice(csvPriceValue);
    if (listingMode === "automaticCsv" && parsedCsvPrice === null) {
      throw new Error(`Row ${row.__row} has no valid Listing Price, Price, or TCG Market Price.`);
    }
    let targetRow;
    try {
      targetRow = conditionRow(row["Condition"], row["Printing"], row["Language"]);
    } catch (error) {
      throw new Error(`Row ${row.__row}: ${error.message}`);
    }
    const key = `${productID}|${targetRow.selector}`;

    if (groups.has(key)) {
      const existing = groups.get(key);
      if (listingMode === "automaticCsv" && parseCsvPrice(existing.csvMarketPrice) !== parsedCsvPrice) {
        throw new Error(`Rows ${existing.sourceRows.join(", ")} and ${row.__row} target the same card and condition but have different prices.`);
      }
      existing.quantity += quantity;
      existing.sourceRows.push(row.__row);
    } else {
      groups.set(key, {
        id: crypto.randomUUID(),
        productID,
        tcgplayerId: row["TCGplayer Id"] || "",
        productLine: row["Product Line"] || "",
        setName: row["Set Name"] || "",
        productName: row["Product Name"] || `Product ${productID}`,
        number: row["Number"] || "",
        condition: targetRow.condition,
        printing: targetRow.printing,
        language: targetRow.language,
        csvMarketPrice: csvPriceValue,
        quantity,
        conditionRowSelector: targetRow.selector,
        conditionRowLabel: targetRow.label,
        pricingMode,
        marketPercent,
        fixedPrice: pricingMode === "fixed" ? fixedPrice : null,
        autoSave: listingMode === "automaticCsv",
        sourceRows: [row.__row],
        status: "pending",
        error: "",
      });
    }
  }

  return [...groups.values()];
}

async function getState() {
  const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (!response?.ok) throw new Error(response?.error || "Could not read extension state.");
  return response.state;
}

async function refresh() {
  const state = await getState();
  const jobs = state.jobs || [];
  const done = jobs.filter((j) => j.status === "completed" || j.status === "failed").length;
  statusBadge.textContent = state.status || "idle";
  progressText.textContent = `${done} / ${jobs.length}`;
  progressBar.max = Math.max(1, jobs.length);
  progressBar.value = done;
  lastMessage.textContent = state.lastMessage || "";
  fileSummary.textContent = jobs.length ? `${jobs.length} listing jobs loaded.` : "No file loaded.";

  startBtn.disabled = !jobs.length || state.status === "running";
  pauseBtn.disabled = state.status !== "running";
  resumeBtn.disabled = state.status !== "paused";

  const preparedJob = state.preparedResult ? jobs[state.currentIndex] : null;
  reviewCard.hidden = !preparedJob;
  confirmSaveBtn.disabled = !preparedJob || state.status !== "running";
  reviewDetails.innerHTML = preparedJob ? `
    <strong>${escapeHtml(preparedJob.productName)}</strong><br>
    ${escapeHtml(preparedJob.condition)} · ${escapeHtml(preparedJob.printing)}${preparedJob.language !== "English" ? ` · ${escapeHtml(preparedJob.language)}` : ""}<br>
    Price: $${escapeHtml(state.preparedResult.price)} · Quantity: ${escapeHtml(state.preparedResult.quantity)}
  ` : "";

  queueEl.innerHTML = jobs.map((job, index) => {
    const active = index === state.currentIndex && state.status === "running";
    const icon = job.status === "completed" ? "✓" : job.status === "failed" ? "✕" : active ? "◌" : "○";
    const error = job.error ? `<div class="jobError">${escapeHtml(job.error)}</div>` : "";
    return `<div class="job">
      <div>${icon}</div>
      <div>
        <div class="jobTitle">${escapeHtml(job.productName)}</div>
        <div class="jobMeta">${escapeHtml(job.setName)} · ${escapeHtml(job.condition)} · ${escapeHtml(job.printing)}${job.language && job.language !== "English" ? ` · ${escapeHtml(job.language)}` : ""} · Qty ${job.quantity}</div>
        ${error}
      </div>
      <div class="jobStatus">${active ? "running" : job.status}</div>
    </div>`;
  }).join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

csvInput.addEventListener("change", async () => {
  try {
    const file = csvInput.files?.[0];
    if (!file) return;
    const jobs = buildJobs(await file.text());
    const response = await chrome.runtime.sendMessage({ type: "LOAD_JOBS", jobs });
    if (!response?.ok) throw new Error(response?.error || "Could not load jobs.");
    fileSummary.textContent = `${file.name}: ${jobs.length} listing jobs.`;
    await refresh();
  } catch (error) {
    fileSummary.textContent = `Error: ${error.message}`;
  }
});

document.querySelectorAll('input[name="listingMode"]').forEach((input) => {
  input.addEventListener("change", refreshListingModeUi);
});

startBtn.addEventListener("click", async () => { await chrome.runtime.sendMessage({ type: "START" }); await refresh(); });
pauseBtn.addEventListener("click", async () => { await chrome.runtime.sendMessage({ type: "PAUSE" }); await refresh(); });
resumeBtn.addEventListener("click", async () => { await chrome.runtime.sendMessage({ type: "RESUME" }); await refresh(); });
resetBtn.addEventListener("click", async () => { await chrome.runtime.sendMessage({ type: "RESET" }); csvInput.value = ""; await refresh(); });
confirmSaveBtn.addEventListener("click", async () => {
  confirmSaveBtn.disabled = true;
  const response = await chrome.runtime.sendMessage({ type: "CONFIRM_SAVE" });
  if (!response?.ok) lastMessage.textContent = response?.error || "Could not save the current card.";
  await refresh();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STATE_KEY]) refresh().catch(console.error);
});

refreshListingModeUi();
refresh().catch((error) => { lastMessage.textContent = error.message; });
