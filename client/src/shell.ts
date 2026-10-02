// The app shell around #root (client/index.html) is static HTML: the fixed footer and
// the "Other projects" line are English at build time. The app re-labels them in the
// UI language (SERBITO-355: under RU they stayed English).
import { renderCrossPromo } from "./crosspromo.js";
import { EN, t, type Lang, type StringKey } from "./i18n.js";

// Structural, not the DOM lib's types: also type-checked from the server workspace.
interface ShellEl {
  textContent: string | null;
  innerHTML: string;
  getAttribute(name: string): string | null;
}
interface ShellDoc {
  querySelectorAll(selector: string): Iterable<ShellEl>;
  querySelector(selector: string): ShellEl | null;
}

/** Put the shell's footer and cross-promo into `lang`. */
export function localizeShell(lang: Lang, doc: ShellDoc): void {
  for (const el of doc.querySelectorAll("[data-pp-i18n]")) {
    const key = el.getAttribute("data-pp-i18n");
    if (key && key in EN) el.textContent = t(lang, key as StringKey);
  }
  const promo = doc.querySelector(".pp-crosspromo");
  // Built from the constant project list and escaped (crosspromo.ts): no user input.
  if (promo) promo.innerHTML = renderCrossPromo(lang);
}
