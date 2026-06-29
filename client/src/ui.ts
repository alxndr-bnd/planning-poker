// UI version gate.
//
// v1 is what every user sees today. v2 is a preview that only someone who knows the
// flag can reach: visit the site once with `?ui=v2` and it sticks (saved in
// localStorage), so the whole session — lobby and room — renders the v2 variant.
// Everyone else keeps v1. `?ui=v1` turns the preview back off.
//
// NOTE: this is the *UI* flag (`?ui=v2`). It is unrelated to the WebSocket edge-gate
// query (`?v=2`) that Cloudflare's WAF requires on /ws — keep them distinct.
//
// THE FLIP: to release v2 to everyone in one go, set UI_V2_DEFAULT = true and ship.
// v2 then becomes the default; anyone can still force the old UI with `?ui=v1`.
const KEY = "pp_ui_v2";
const UI_V2_DEFAULT = false;

export function resolveUiV2(): boolean {
  try {
    const q = new URLSearchParams(location.search).get("ui");
    if (q === "v2") localStorage.setItem(KEY, "1");
    else if (q === "v1") localStorage.setItem(KEY, "0");
    const saved = localStorage.getItem(KEY);
    if (saved === "1") return true;
    if (saved === "0") return false;
  } catch {
    /* localStorage / URL unavailable — fall through to the default */
  }
  return UI_V2_DEFAULT;
}
