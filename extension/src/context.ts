import type { ElementRef, PageSnapshot } from "./types";

// Kept self-contained so the service worker can run it directly in the current
// top-level tab instead of trusting a possibly stale content-script listener.
export function buildSnapshot(): PageSnapshot {
  const maxText = 12_000;
  const maxElements = 180;
  const interactive = [
    "a[href]", "button", "input", "textarea", "select", "summary",
    "[role='button']", "[role='link']", "[role='checkbox']", "[role='menuitem']",
    "[role='option']", "[role='radio']", "[role='switch']", "[role='textbox']",
    "[contenteditable]:not([contenteditable='false'])", "[tabindex]",
  ].join(",");

  function visible(element: Element): element is HTMLElement {
    const node = element as HTMLElement;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 1 && rect.height > 1 && rect.bottom >= -100 && rect.right >= -100 &&
      rect.top <= innerHeight + 100 && rect.left <= innerWidth + 100 &&
      style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  }

  function nameOf(element: HTMLElement): string {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const label = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
      if (label) return label;
    }
    return (element.getAttribute("aria-label") || element.getAttribute("data-placeholder") || element.getAttribute("alt") ||
      (element as HTMLInputElement).placeholder || element.innerText || element.textContent || "")
      .replace(/\s+/g, " ").trim().slice(0, 240);
  }

  function hash(value: string): string {
    let result = 2166136261;
    for (let index = 0; index < value.length; index++) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
    return (result >>> 0).toString(36);
  }

  const elements: ElementRef[] = [];
  const candidates = [...document.querySelectorAll(interactive)].map((raw, index) => ({ raw, index }))
    .sort((a, b) => {
      const priority = ({ raw }: { raw: Element }) => {
        const node = raw as HTMLElement;
        const visibility = visible(raw) ? 10 : 0;
        if (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) || node.getAttribute("role") === "textbox") return visibility + 5;
        if (node.tagName === "BUTTON" || node.getAttribute("role") === "button") return visibility + 3;
        return visibility + 1;
      };
      return priority(b) - priority(a) || a.index - b.index;
    })
    .slice(0, maxElements);

  candidates.forEach(({ raw, index }) => {
    const element = raw as HTMLElement;
    const rect = element.getBoundingClientRect();
    const name = nameOf(element);
    const id = `hb_${index}_${hash(`${element.tagName}:${name}:${Math.round(rect.x)}:${Math.round(rect.y)}`)}`;
    element.dataset.heybrowsyId = id;
    elements.push({
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
    });
  });

  const visibleText = (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, maxText);
  const signature = `${location.href}|${document.title}|${visibleText.slice(0, 2000)}|${elements.map((element) => element.id).join(",")}`;
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
