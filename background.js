const SELL_URL = "https://store.tcgplayer.com/admin/product/manage/";
const CATALOG_URL = "https://store.tcgplayer.com/admin/product/catalog";
const STATE_KEY = "tcgListingState";

const defaultState = {
  status: "idle", // idle | running | paused | complete
  tabId: null,
  currentIndex: 0,
  jobs: [],
  preparedResult: null,
  lastMessage: "",
};

async function getState() {
  const data = await chrome.storage.local.get(STATE_KEY);
  return { ...defaultState, ...(data[STATE_KEY] || {}) };
}

async function setState(patch) {
  const state = await getState();
  const next = { ...state, ...patch };
  await chrome.storage.local.set({ [STATE_KEY]: next });
  return next;
}

async function getActiveTcgTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const active = tabs[0];
  if (active?.url?.startsWith("https://store.tcgplayer.com/")) return active;

  const tcgTabs = await chrome.tabs.query({ url: "https://store.tcgplayer.com/*" });
  return tcgTabs[0] || null;
}

async function startNextJob() {
  const state = await getState();
  if (state.status !== "running") return;

  if (state.currentIndex >= state.jobs.length) {
    await setState({ status: "complete", preparedResult: null, lastMessage: "All jobs complete." });
    return;
  }

  const job = state.jobs[state.currentIndex];
  let tabId = state.tabId;

  if (!tabId) {
    const existing = await getActiveTcgTab();
    if (existing) tabId = existing.id;
  }

  if (!tabId) {
    const tab = await chrome.tabs.create({ url: `${SELL_URL}${job.productID}`, active: true });
    tabId = tab.id;
  } else {
    try {
      await chrome.tabs.update(tabId, { url: `${SELL_URL}${job.productID}`, active: true });
    } catch {
      const tab = await chrome.tabs.create({ url: `${SELL_URL}${job.productID}`, active: true });
      tabId = tab.id;
    }
  }

  await setState({ tabId, preparedResult: null, lastMessage: `Opening ${job.productName || job.productID}…` });
}

async function failCurrentJob(errorMessage) {
  const state = await getState();
  const jobs = [...state.jobs];
  const job = jobs[state.currentIndex];
  if (!job) return;

  jobs[state.currentIndex] = {
    ...job,
    status: "failed",
    error: errorMessage,
    completedAt: new Date().toISOString(),
  };

  await setState({
    jobs,
    currentIndex: state.currentIndex + 1,
    preparedResult: null,
    lastMessage: `Failed: ${job.productName || job.productID}`,
  });

  await startNextJob();
}

async function completeCurrentJob() {
  const state = await getState();
  const jobs = [...state.jobs];
  const job = jobs[state.currentIndex];
  if (!job) return;

  jobs[state.currentIndex] = {
    ...job,
    status: "completed",
    result: state.preparedResult,
    error: "",
    completedAt: new Date().toISOString(),
  };

  await setState({
    jobs,
    currentIndex: state.currentIndex + 1,
    preparedResult: null,
    lastMessage: `Listed: ${job.productName || job.productID}`,
  });

  await startNextJob();
}

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "GET_STATE") {
      sendResponse({ ok: true, state: await getState() });
      return;
    }

    if (message.type === "LOAD_JOBS") {
      const state = await setState({
        status: "idle",
        currentIndex: 0,
        jobs: message.jobs,
        preparedResult: null,
        lastMessage: `${message.jobs.length} jobs loaded.`,
      });
      sendResponse({ ok: true, state });
      return;
    }

    if (message.type === "START") {
      const state = await getState();
      if (!state.jobs.length) throw new Error("No CSV jobs are loaded.");
      await setState({ status: "running", lastMessage: "Starting…" });
      await startNextJob();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "PAUSE") {
      await setState({ status: "paused", lastMessage: "Paused." });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "RESUME") {
      await setState({ status: "running", lastMessage: "Resuming…" });
      await startNextJob();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "RESET") {
      await chrome.storage.local.set({ [STATE_KEY]: { ...defaultState } });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "JOB_PREPARED") {
      const state = await getState();
      const job = state.jobs[state.currentIndex];
      await setState({
        preparedResult: message.result,
        lastMessage: job?.autoSave ? "Values verified; saving automatically…" : "Values entered. Review and confirm this card.",
      });

      sendResponse({ ok: true });
      return;
    }

    if (message.type === "CONFIRM_SAVE") {
      const state = await getState();
      if (state.status !== "running" || !state.preparedResult || !state.tabId) {
        throw new Error("No prepared card is waiting for confirmation.");
      }
      const response = await chrome.tabs.sendMessage(state.tabId, { type: "CONFIRM_SAVE" });
      if (!response?.ok) throw new Error(response?.error || "The Seller Portal page could not save the card.");
      await setState({ lastMessage: "Save confirmed; waiting for Seller Portal…" });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "JOB_FAILED") {
      await failCurrentJob(message.error || "Unknown error");
      sendResponse({ ok: true });
      return;
    }
  })().catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;

  const state = await getState();
  if (state.status !== "running" || tabId !== state.tabId) return;

  const job = state.jobs[state.currentIndex];
  if (!job) return;

  const url = tab.url || "";

  if (url.startsWith(`${SELL_URL}${job.productID}`)) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "PROCESS_JOB", job });
    } catch (error) {
      // Content script can become ready just after tabs.onUpdated. Retry once.
      setTimeout(async () => {
        try {
          const current = await getState();
          if (current.status === "running" && current.currentIndex === state.currentIndex) {
            await chrome.tabs.sendMessage(tabId, { type: "PROCESS_JOB", job });
          }
        } catch (retryError) {
          await failCurrentJob(`Could not start page automation: ${retryError.message}`);
        }
      }, 1200);
    }
    return;
  }

  // The existing Playwright flow considers the save successful when TCGplayer
  // redirects back to the product catalog after Save.
  if (state.preparedResult && url.startsWith(CATALOG_URL)) {
    await completeCurrentJob();
  }
});
