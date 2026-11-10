const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parsePrice(value) {
  if (!value) return null;
  const cleaned = String(value).replace(/[$,\s]/g, "").trim();
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toCents(price) {
  return Math.round(price * 100);
}

async function waitForSelector(selector, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = document.querySelector(selector);
    if (el) return el;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

function normalizeRowLabel(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

async function waitForConditionRow(job, timeout = 30000) {
  const row = await waitForSelector(job.conditionRowSelector, timeout);
  const actualLabel = row.querySelector('span[data-bind="text: conditionName"]')?.textContent?.trim() || "";

  if (job.conditionRowLabel && normalizeRowLabel(actualLabel) !== normalizeRowLabel(job.conditionRowLabel)) {
    throw new Error(
      `Condition-row mismatch: ${job.conditionRowSelector} is "${actualLabel || "unlabeled"}", expected "${job.conditionRowLabel}".`
    );
  }

  return row;
}

function setInputValue(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  if (descriptor?.set) descriptor.set.call(input, value);
  else input.value = value;

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function processJob(job) {
  const row = await waitForConditionRow(job, 30000);
  const csvPrice = parsePrice(job.csvMarketPrice);
  let selectedPrice = null;
  if (job.pricingMode === "fixed") selectedPrice = parsePrice(job.fixedPrice);
  else if (job.pricingMode === "csvPercent" && csvPrice !== null) selectedPrice = csvPrice * (job.marketPercent / 100);
  else if (job.pricingMode === "csv") selectedPrice = csvPrice;
  if (selectedPrice === null) throw new Error("This job has no valid user-provided or CSV price.");

  const formattedPrice = selectedPrice.toFixed(2);
  const priceInput = row.querySelector('input[aria-label^="Marketplace price for"]');
  const quantityInput = row.querySelector('input[aria-label^="Quantity for"]');

  if (!priceInput) throw new Error(`Price input not found in ${job.conditionRowSelector}.`);
  if (!quantityInput) throw new Error(`Quantity input not found in ${job.conditionRowSelector}.`);

  setInputValue(priceInput, formattedPrice);
  setInputValue(quantityInput, String(job.quantity));
  quantityInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  quantityInput.blur();
  await delay(250);

  const enteredPrice = parsePrice(priceInput.value);
  const enteredQuantity = Number.parseInt(quantityInput.value, 10);

  if (enteredPrice === null || toCents(enteredPrice) !== toCents(selectedPrice)) {
    throw new Error(`Price input did not retain ${formattedPrice}. Current value: ${priceInput.value}`);
  }
  if (enteredQuantity !== job.quantity) {
    throw new Error(`Quantity input did not retain ${job.quantity}. Current value: ${quantityInput.value}`);
  }

  const result = {
    price: formattedPrice,
    quantity: job.quantity,
    conditionRowSelector: job.conditionRowSelector,
    priceSource: job.pricingMode,
  };

  const prepared = await chrome.runtime.sendMessage({ type: "JOB_PREPARED", result });
  if (!prepared?.ok) throw new Error(prepared?.error || "Could not save prepared job state.");
  if (job.autoSave) confirmSave();

}

function confirmSave() {
  const saveButton = [...document.querySelectorAll('input[value="Save"], button')]
    .find((el) => el.matches('input[value="Save"]') || el.textContent?.trim() === "Save");
  if (!saveButton) throw new Error("Save button was not found.");
  saveButton.scrollIntoView({ behavior: "instant", block: "center" });
  saveButton.click();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "PROCESS_JOB" && message.type !== "CONFIRM_SAVE") return;

  (async () => {
    try {
      if (message.type === "PROCESS_JOB") await processJob(message.job);
      else confirmSave();
      sendResponse({ ok: true });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await chrome.runtime.sendMessage({ type: "JOB_FAILED", error: messageText });
      sendResponse({ ok: false, error: messageText });
    }
  })();

  return true;
});
