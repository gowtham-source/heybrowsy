import type { BrowserAction, PageSnapshot } from "./types";

type BrowserSession = { tabId: number; groupId: number };
const SESSION_KEY = "heybrowsyBrowserSession";

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);

// Deliberately local to this entry point. Sharing this function with content.ts
// makes the bundler emit an imported chunk, but programmatically injected
// Chrome content scripts must be standalone classic scripts.
function captureSnapshotInPage(): PageSnapshot {
  const interactive = [
    "a[href]", "button", "input", "textarea", "select", "summary",
    "[role='button']", "[role='link']", "[role='checkbox']", "[role='menuitem']",
    "[role='option']", "[role='radio']", "[role='switch']", "[role='textbox']",
    "[contenteditable]:not([contenteditable='false'])", "[tabindex]",
  ].join(",");
  const hash = (value: string) => {
    let result = 2166136261;
    for (let index = 0; index < value.length; index++) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
    return (result >>> 0).toString(36);
  };
  const nameOf = (element: HTMLElement) => {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const label = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
      if (label) return label;
    }
    return (element.getAttribute("aria-label") || element.getAttribute("data-placeholder") || element.getAttribute("alt") ||
      (element as HTMLInputElement).placeholder || element.innerText || element.textContent || "")
      .replace(/\s+/g, " ").trim().slice(0, 240);
  };
  const visible = (element: Element) => {
    const node = element as HTMLElement;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 1 && rect.height > 1 && rect.bottom >= -100 && rect.right >= -100 &&
      rect.top <= innerHeight + 100 && rect.left <= innerWidth + 100 &&
      style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  };
  const elements = [...document.querySelectorAll(interactive)].map((raw, index) => ({ raw, index }))
    .sort((a, b) => {
      const priority = (raw: Element) => {
        const node = raw as HTMLElement;
        const visibility = visible(raw) ? 10 : 0;
        if (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) || node.getAttribute("role") === "textbox") return visibility + 5;
        return visibility + (node.tagName === "BUTTON" || node.getAttribute("role") === "button" ? 3 : 1);
      };
      return priority(b.raw) - priority(a.raw) || a.index - b.index;
    })
    .slice(0, 180)
    .map(({ raw, index }) => {
      const element = raw as HTMLElement;
      const rect = element.getBoundingClientRect();
      const name = nameOf(element);
      const id = `hb_${index}_${hash(`${element.tagName}:${name}:${Math.round(rect.x)}:${Math.round(rect.y)}`)}`;
      element.dataset.heybrowsyId = id;
      return {
        id,
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role") || (element.isContentEditable ? "textbox" : element.tagName.toLowerCase()),
        name,
        type: element.getAttribute("type") || undefined,
        value: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
          ? element.value.slice(0, 500) : element.isContentEditable ? (element.innerText || "").slice(0, 500) : undefined,
        href: element instanceof HTMLAnchorElement ? element.href : undefined,
        disabled: "disabled" in element && Boolean((element as HTMLButtonElement).disabled),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      };
    });
  const visibleText = (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 12_000);
  const elementState = elements.map((element) => `${element.id}:${element.value ?? ""}:${element.disabled ? 1 : 0}`).join(",");
  const signature = `${location.href}|${document.title}|${visibleText.slice(0, 2000)}|${scrollX}:${scrollY}|${elementState}`;
  return {
    url: location.href,
    title: document.title,
    visibleText,
    selectedText: getSelection()?.toString().slice(0, 3000) || "",
    elements,
    viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
    fingerprint: hash(signature),
  };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
});

function openBoundPanel(tabId: number) {
  // Start configuration and opening in the same user-gesture call stack.
  // Awaiting setOptions first makes Chrome reject sidePanel.open().
  void chrome.sidePanel.setOptions({ tabId, path: `sidepanel.html?tabId=${encodeURIComponent(tabId)}`, enabled: true });
  return chrome.sidePanel.open({ tabId });
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) void openBoundPanel(tab.id).catch((error) => console.error("Could not open heybrowsy", error));
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-side-panel") return;
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.id) void openBoundPanel(tab.id).catch((error) => console.error("Could not open heybrowsy", error));
  });
});

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active browser tab");
  return tab;
}

async function getSession(): Promise<BrowserSession | undefined> {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  return stored[SESSION_KEY] as BrowserSession | undefined;
}

async function setSession(session?: BrowserSession) {
  if (session) await chrome.storage.session.set({ [SESSION_KEY]: session });
  else await chrome.storage.session.remove(SESSION_KEY);
}

async function sessionTab() {
  const session = await getSession();
  if (session) {
    try {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (active?.id && active.groupId === session.groupId && active.id !== session.tabId) {
        await setSession({ ...session, tabId: active.id });
        return active;
      }
      return await chrome.tabs.get(session.tabId);
    }
    catch { await setSession(); }
  }
  return activeTab();
}

async function ensureContent(tabId: number) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "HB_PING" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return chrome.tabs.sendMessage(tabId, { type: "HB_PING" });
  }
}

async function notifyTab(tabId: number, message: Record<string, unknown>) {
  await ensureContent(tabId);
  return chrome.tabs.sendMessage(tabId, message);
}

async function captureSnapshot(tabId: number): Promise<PageSnapshot> {
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: captureSnapshotInPage,
  });
  const snapshot = execution?.result as PageSnapshot | undefined;
  if (!snapshot?.url || !snapshot.fingerprint) throw new Error("Could not capture the current top-level page");
  return snapshot;
}

function transientSnapshot(snapshot: PageSnapshot) {
  const text = snapshot.visibleText.trim();
  return snapshot.elements.length === 0 && (text.length < 500 || /^(navigating|loading|please wait|redirecting)\b/i.test(text));
}

async function captureStableSnapshot(tabId: number, options: { maxWaitMs?: number; previousFingerprint?: string } = {}) {
  const maxWaitMs = options.maxWaitMs ?? 8_000;
  const started = Date.now();
  let latest = await captureSnapshot(tabId);
  if (!options.previousFingerprint && !transientSnapshot(latest)) return latest;
  let stableSince = Date.now();
  let changed = !options.previousFingerprint || latest.fingerprint !== options.previousFingerprint;
  while (Date.now() - started < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const next = await captureSnapshot(tabId);
    if (next.fingerprint !== latest.fingerprint) stableSince = Date.now();
    if (options.previousFingerprint && next.fingerprint !== options.previousFingerprint) changed = true;
    latest = next;
    const elapsed = Date.now() - started;
    if (changed && !transientSnapshot(latest)) return latest;
    if (elapsed >= 1_500 && Date.now() - stableSince >= 600 && !transientSnapshot(latest)) return latest;
  }
  return latest;
}

async function attachBrowser(requestedTabId?: number) {
  const tab = requestedTabId ? await chrome.tabs.get(requestedTabId) : await activeTab();
  const tabId = tab.id!;
  let groupId = tab.groupId;
  if (groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    const currentGroup = await chrome.tabGroups.get(groupId);
    if (currentGroup.title !== "heybrowsy") {
      await chrome.tabs.ungroup([tabId]);
      groupId = chrome.tabGroups.TAB_GROUP_ID_NONE;
    }
  }
  if (groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) groupId = await chrome.tabs.group({ tabIds: [tabId] });
  await chrome.tabGroups.update(groupId, { title: "heybrowsy", color: "green", collapsed: false });
  await setSession({ tabId, groupId });
  await notifyTab(tabId, { type: "HB_SESSION_START" });
  const snapshot = await captureStableSnapshot(tabId);
  return { ok: true, snapshot, tabId, groupId };
}

chrome.tabs.onCreated.addListener((tab) => {
  if (!tab.id || !tab.openerTabId) return;
  void getSession().then(async (session) => {
    if (!session || tab.openerTabId !== session.tabId) return;
    await chrome.tabs.group({ groupId: session.groupId, tabIds: [tab.id!] });
    if (tab.active) await setSession({ ...session, tabId: tab.id! });
  }).catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void getSession().then((session) => session?.tabId === tabId ? setSession() : undefined);
});

async function waitForTab(tabId: number, timeoutMs = 15_000) {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(updatedId: number, info: { status?: string }) {
      if (updatedId === tabId && info.status === "complete") done();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "HB_ATTACH_BROWSER") {
    attachBrowser(Number.isInteger(message.tabId) ? message.tabId : undefined)
      .then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === "HB_RELEASE_BROWSER") {
    getSession().then(async (session) => {
      if (session) {
        try { await chrome.tabs.sendMessage(session.tabId, { type: "HB_SESSION_END" }); } catch { /* tab may be gone */ }
      }
      await setSession();
      return { ok: true };
    }).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === "HB_ACTIVE_SNAPSHOT") {
    sessionTab().then(async (tab) => ({ ok: true, snapshot: await captureStableSnapshot(tab.id!) }))
      .then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === "HB_BROWSER_ACTION") {
    const action = message.action as BrowserAction;
    sessionTab().then(async (tab) => {
      const tabId = tab.id!;
      await chrome.tabs.update(tabId, { active: true });
      if (action.type === "navigate" && action.url) {
        await chrome.tabs.update(tabId, { url: action.url });
        await waitForTab(tabId);
        await notifyTab(tabId, { type: "HB_SESSION_START" });
        return { ok: true, navigated: true, snapshot: await captureStableSnapshot(tabId) };
      }
      const before = await captureSnapshot(tabId);
      if (action.type === "read_page") {
        return { ok: true, snapshot: await captureStableSnapshot(tabId) };
      }
      await notifyTab(tabId, { type: "HB_SHOW_ACTION", action });
      try {
        const result = await chrome.tabs.sendMessage(tabId, { type: "HB_EXECUTE", action });
        if (!result?.ok) return result;
        const snapshot = await captureStableSnapshot(tabId, {
          maxWaitMs: action.type === "click" ? 10_000 : 3_500,
          previousFingerprint: before.fingerprint,
        });
        return { ...result, navigated: result.navigated || snapshot.url !== before.url || undefined, snapshot };
      } catch (error) {
        // A click can navigate before the content script replies. Treat that as a
        // successful navigation only when the tab actually starts loading.
        const current = await chrome.tabs.get(tabId);
        if (action.type !== "click" || current.status !== "loading") throw error;
        await waitForTab(tabId);
        await notifyTab(tabId, { type: "HB_SESSION_START" });
        return { ok: true, navigated: true, snapshot: await captureStableSnapshot(tabId) };
      }
    }).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
});
