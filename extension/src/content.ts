import { buildSnapshot } from "./context";
import type { BrowserAction } from "./types";

let overlay: { host: HTMLDivElement; cursor: HTMLDivElement; label: HTMLDivElement } | undefined;

function ensureOverlay() {
  if (overlay?.host.isConnected) return overlay;
  const host = document.createElement("div");
  host.id = "heybrowsy-agent-overlay";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    .frame{position:fixed;inset:0;box-shadow:inset 0 0 16px rgba(184,227,110,.7);animation:hbPulse 2s ease-in-out infinite}
    .status{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);padding:9px 14px;border:1px solid #b8e36e66;border-radius:13px;background:#151812f2;color:#eef0e8;font:600 12px/1.2 system-ui;box-shadow:0 12px 35px #0008;white-space:nowrap}
    .status:before{content:'✦';color:#b8e36e;margin-right:8px}.cursor{position:fixed;left:0;top:0;width:22px;height:28px;transform:translate3d(50vw,50vh,0);transition:transform 180ms cubic-bezier(.2,0,0,1);filter:drop-shadow(0 0 7px #b8e36e99)}
    .cursor svg{display:block}.cursor.clicking{animation:hbClick .34s ease-out}@keyframes hbClick{50%{scale:.72}}@keyframes hbPulse{50%{opacity:.55}}
    @media(prefers-reduced-motion:reduce){.frame{animation:none}.cursor{transition:none}}
  `;
  const frame = document.createElement("div"); frame.className = "frame";
  const label = document.createElement("div"); label.className = "status"; label.textContent = "heybrowsy is active in this tab group";
  const cursor = document.createElement("div"); cursor.className = "cursor";
  cursor.innerHTML = '<svg width="22" height="28" viewBox="0 0 22 28"><path d="M2 2v20l5-5 4 9 4-2-4-8h7z" fill="#151812" stroke="#eef0e8" stroke-width="3" stroke-linejoin="round"/><path d="M2 2v20l5-5 4 9 4-2-4-8h7z" fill="#b8e36e" transform="scale(.78) translate(2 2)"/></svg>';
  shadow.append(style, frame, label, cursor);
  (document.body || document.documentElement).appendChild(host);
  overlay = { host, cursor, label };
  return overlay;
}

function showAction(action: BrowserAction) {
  const ui = ensureOverlay();
  ui.label.textContent = `heybrowsy · ${action.type.replace("_", " ")}`;
  if (action.element_id) {
    const target = document.querySelector(`[data-heybrowsy-id="${CSS.escape(action.element_id)}"]`);
    if (target) {
      const rect = target.getBoundingClientRect();
      ui.cursor.style.transform = `translate3d(${Math.round(rect.left + rect.width / 2)}px,${Math.round(rect.top + rect.height / 2)}px,0)`;
    }
  } else if (action.type === "scroll") {
    ui.cursor.style.transform = `translate3d(${Math.round(innerWidth * .82)}px,${Math.round(innerHeight * .62)}px,0)`;
  }
  if (action.type === "click") {
    ui.cursor.classList.remove("clicking");
    requestAnimationFrame(() => ui.cursor.classList.add("clicking"));
  }
}

function endSession() { overlay?.host.remove(); overlay = undefined; }

function delay(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }

function looksTransient(snapshot: ReturnType<typeof buildSnapshot>) {
  const text = snapshot.visibleText.trim();
  return document.readyState === "loading" ||
    (snapshot.elements.length === 0 && (text.length < 500 || /^(navigating|loading|please wait|redirecting)\b/i.test(text)));
}

async function waitForStableSnapshot(options: { maxWaitMs?: number; minWaitMs?: number; previousFingerprint?: string } = {}) {
  const maxWaitMs = options.maxWaitMs ?? 8_000;
  const minWaitMs = options.minWaitMs ?? 350;
  const started = performance.now();
  let latest = buildSnapshot();
  let stableSince = performance.now();
  let changeObserved = !options.previousFingerprint || latest.fingerprint !== options.previousFingerprint;

  while (performance.now() - started < maxWaitMs) {
    await delay(250);
    const next = buildSnapshot();
    if (next.fingerprint !== latest.fingerprint) stableSince = performance.now();
    if (options.previousFingerprint && next.fingerprint !== options.previousFingerprint) changeObserved = true;
    latest = next;
    const elapsed = performance.now() - started;
    const stableFor = performance.now() - stableSince;
    // Give an intercepted SPA click time to begin changing the document. Once
    // change is observed, wait for a quiet, hydrated DOM before returning it.
    const changeReady = changeObserved || elapsed >= 2_500;
    if (elapsed >= minWaitMs && changeReady && stableFor >= 750 && !looksTransient(latest)) return latest;
  }
  return latest;
}

function scrollContainer(action: BrowserAction) {
  if (action.element_id) {
    let current: HTMLElement | null = findTarget(action.element_id);
    while (current) {
      const style = getComputedStyle(current);
      if (/(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight + 20) return current;
      current = current.parentElement;
    }
  }
  const candidates = [...document.querySelectorAll<HTMLElement>("body *")].filter((element) => {
    const rect = element.getBoundingClientRect();
    const overflow = getComputedStyle(element).overflowY;
    return rect.width > 150 && rect.height > 120 && rect.bottom > 0 && rect.top < innerHeight &&
      /(auto|scroll)/.test(overflow) && element.scrollHeight > element.clientHeight + 40;
  });
  return candidates.sort((a, b) => {
    const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
    return (br.width * br.height) - (ar.width * ar.height);
  })[0];
}

function findTarget(id?: string): HTMLElement {
  const target = id ? document.querySelector(`[data-heybrowsy-id="${CSS.escape(id)}"]`) : null;
  if (!(target instanceof HTMLElement)) throw new Error(`Element ${id || "(missing)"} is unavailable; refresh context`);
  target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  return target;
}

async function execute(action: BrowserAction) {
  if (action.type === "read_page") return { ok: true, snapshot: await waitForStableSnapshot() };
  if (action.type === "navigate") { location.assign(action.url || ""); return { ok: true, navigated: true }; }
  const before = buildSnapshot();
  if (action.type === "scroll") {
    const amount = action.amount || Math.round(innerHeight * 0.72);
    const target = scrollContainer(action);
    const top = action.direction === "up" ? -amount : amount;
    if (target) target.scrollBy({ top, behavior: "smooth" });
    else scrollBy({ top, behavior: "smooth" });
  } else if (action.type === "click") {
    findTarget(action.element_id).click();
  } else if (action.type === "type") {
    const target = findTarget(action.element_id);
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)) throw new Error("Target is not editable");
    target.focus();
    const value = action.value || "";
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      setter?.call(target, value);
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    } else {
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(target);
      selection?.removeAllRanges(); selection?.addRange(range);
      if (!document.execCommand("insertText", false, value)) {
        target.textContent = value;
        target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      }
    }
    target.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (action.type === "select") {
    const target = findTarget(action.element_id);
    if (!(target instanceof HTMLSelectElement)) throw new Error("Target is not a select element");
    target.value = action.value || "";
    target.dispatchEvent(new Event("change", { bubbles: true }));
  }
  await delay(action.type === "click" ? 350 : 180);
  const snapshot = buildSnapshot();
  return { ok: true, navigated: snapshot.url !== before.url || undefined, snapshot };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "HB_PING") { sendResponse({ ok: true }); return; }
  if (message.type === "HB_SESSION_START") { ensureOverlay(); sendResponse({ ok: true }); return; }
  if (message.type === "HB_SESSION_END") { endSession(); sendResponse({ ok: true }); return; }
  if (message.type === "HB_SHOW_ACTION") { showAction(message.action); sendResponse({ ok: true }); return; }
  if (message.type === "HB_STABLE_SNAPSHOT" || message.type === "HB_SNAPSHOT") {
    waitForStableSnapshot().then((snapshot) => sendResponse({ ok: true, snapshot }));
    return true;
  }
  if (message.type === "HB_EXECUTE") {
    execute(message.action).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
});
