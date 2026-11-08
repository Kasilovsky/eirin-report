/* ==========================================================================
   永遠亭 医療報告 — 語言切換（簡 / 繁）

   頁面源碼是繁體；預設顯示簡體（把頁面上的繁體統一轉為簡體）。
   資料層（文獻標題、要目解讀）本身就是簡體，重複轉換無害。

   選「繁體」時不轉換、也不載入轉換庫（省流量），保持源碼原樣。
   選擇記在 localStorage，切換時重載一次。
   ========================================================================== */
(() => {
  "use strict";

  const STORAGE_KEY = "eirin-lang";
  const HANS = "zh-Hans";
  const HANT = "zh-Hant";
  const LIB_URL = "assets/opencc-t2cn.js?v=20261107f";

  const current = localStorage.getItem(STORAGE_KEY) === HANT ? HANT : HANS;

  let converter = null;
  let loadPromise = null;

  /** 只為簡體模式載入轉換庫（107 KB） */
  function ensureOpenCC() {
    if (window.OpenCC && typeof window.OpenCC.Converter === "function") return Promise.resolve();
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = LIB_URL;
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return loadPromise;
  }

  function getConverter() {
    if (converter) return converter;
    if (window.OpenCC && typeof window.OpenCC.Converter === "function") {
      converter = window.OpenCC.Converter({ from: "tw", to: "cn" });
    }
    return converter;
  }

  function convertNode(node) {
    const text = node.nodeValue;
    if (!text || !/[\u3400-\u9fff]/.test(text)) return;
    const next = converter(text);
    if (next !== text) node.nodeValue = next;
  }

  function walk(root) {
    if (!getConverter()) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(convertNode);

    if (root.querySelectorAll) {
      root.querySelectorAll("[placeholder], [title], [alt]").forEach((el) => {
        ["placeholder", "title", "alt"].forEach((attr) => {
          const value = el.getAttribute(attr);
          if (value && /[\u3400-\u9fff]/.test(value)) {
            el.setAttribute(attr, converter(value));
          }
        });
      });
    }
  }

  /** 對整頁或指定元素套用目前語言。可重複呼叫（冪等）。 */
  async function apply(root = document.body) {
    if (current !== HANS) return;
    try {
      await ensureOpenCC();
    } catch {
      return;
    }
    walk(root);
  }

  function toggle() {
    localStorage.setItem(STORAGE_KEY, current === HANS ? HANT : HANS);
    location.reload();
  }

  function createToggle() {
    if (document.getElementById("langToggle")) return;
    const button = document.createElement("button");
    button.id = "langToggle";
    button.type = "button";
    button.className = "lang-toggle";
    button.textContent = current === HANS ? "簡體" : "繁體";
    button.title = current === HANS ? "切換為繁體" : "切換為簡體";
    button.setAttribute("aria-label", button.title);
    button.addEventListener("click", toggle);
    document.body.appendChild(button);
  }

  function boot() {
    createToggle();
    apply();
  }

  window.EirinLang = { current, apply, toggle };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
