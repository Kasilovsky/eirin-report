/* ==========================================================================
   永遠亭 医療報告 — 要目独立页
   数据源：data/digest/latest.json（由 digest.py 生成）
   ========================================================================== */
(() => {
  "use strict";

  const DIGEST_URL = "data/digest/latest.json";
  const CONF_LABEL = { high: "高", medium: "中", low: "低" };

  const el = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));

  const pad = (n) => String(n).padStart(2, "0");

  function formatIssueDate(date) {
    return `令和${date.getFullYear() - 2018}年（${date.getFullYear()}）${pad(date.getMonth() + 1)}月${pad(date.getDate())}日`;
  }

  let toastTimer = 0;
  function toast(message) {
    const node = el("toast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("show"), 1800);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    }
  }

  /* --------------------------------------------------------------- 主體 --- */

  let digest = null;

  function itemHtml(item, index) {
    const confidence = CONF_LABEL[item.confidence] || "中";
    const tags = (item.tags || []).map((tag) => `<span>#${esc(tag)}</span>`).join("");
    const pro = [
      item.clinical_note ? `<p class="digest-row digest-pro"><b>臨床備註</b>${esc(item.clinical_note)}</p>` : "",
      item.title_en ? `<p class="digest-row digest-pro"><b>原題</b>${esc(item.title_en)}</p>` : "",
    ].join("");

    return `
      <li class="digest-item">
        <div class="digest-index" aria-hidden="true">${String(index).padStart(2, "0")}</div>
        <div>
          <div class="digest-kicker">
            <span class="j">${esc(item.journal || "")}</span>
            ${item.study_type ? `<span class="t">${esc(item.study_type)}</span>` : ""}
            <span>${esc(item.date || "")}</span>
            <span class="conf" data-level="${esc(item.confidence || "medium")}">證據等級：${confidence}</span>
          </div>
          <h3 class="digest-title">${esc(item.title_zh || item.title_en || "")}</h3>
          ${item.one_liner ? `<p class="digest-oneliner">${esc(item.one_liner)}</p>` : ""}
          ${item.key_finding ? `<p class="digest-row"><b>關鍵結果</b>${esc(item.key_finding)}</p>` : ""}
          ${item.why_it_matters ? `<p class="digest-row"><b>意義</b>${esc(item.why_it_matters)}</p>` : ""}
          ${pro}
          <div class="digest-foot">
            ${item.evidence ? `<span>證據：${esc(item.evidence)}</span>` : ""}
            ${item.link ? `<a href="${esc(item.link)}" target="_blank" rel="noopener">PubMed 原文 ↗</a>` : ""}
            ${tags}
          </div>
        </div>
      </li>`;
  }

  function render(data) {
    digest = data;
    const today = new Date();
    el("digestDate").textContent = formatIssueDate(today);

    const note = el("digestNote");
    if (data.degraded) {
      note.className = "digest-degraded";
      note.textContent = "本期未启用模型解读（缺少密钥或调用失败），以下仅为题录；摘要与原文请点开 PubMed 查看。";
    } else {
      note.className = "digest-note";
      note.textContent = `${data.count} 條 · 由 ${data.provider || "模型"} 依 PubMed 摘要整理，數字均取自原文；標記「證據等級：低」者表示摘要未給出結論。`;
    }

    el("digestList").innerHTML = (data.items || []).map((item, i) => itemHtml(item, i + 1)).join("");
    if (window.EirinLang) window.EirinLang.apply();
    document.title = `本期要目 · 永遠亭 医療報告`;
  }

  function digestText() {
    if (!digest) return "";
    const today = new Date();
    const lines = [`【永遠亭 医療報告 · 本期要目】${formatIssueDate(today)}`, ""];
    (digest.items || []).forEach((item, index) => {
      lines.push(`${String(index + 1).padStart(2, "0")}｜${item.journal || ""}｜${item.study_type || "研究"}`);
      if (item.title_zh) lines.push(item.title_zh);
      if (item.one_liner) lines.push(item.one_liner);
      if (item.key_finding) lines.push(item.key_finding);
      if (item.why_it_matters) lines.push(item.why_it_matters);
      lines.push(item.link || "", "");
    });
    lines.push("—— 永遠亭 医療部 · 八意永琳");
    return lines.join("\n");
  }

  async function copyDigest() {
    if (!digest) { toast("本期尚無要目"); return; }
    const ok = await copyText(digestText());
    toast(ok ? "要目已複製，可直接貼到群裡" : "複製失敗，請手動選取");
  }

  function applyTheme() {
    const saved = localStorage.getItem("eirin-theme");
    const dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }

  function initReaderMode() {
    const saved = localStorage.getItem("eirin-reader");
    const mode = saved === "pro" ? "pro" : "plain";
    document.body.dataset.reader = mode;
    const button = el("readerModeBtn");
    if (!button) return;
    button.setAttribute("aria-pressed", String(mode === "pro"));
    button.textContent = mode === "pro" ? "普通模式" : "專業模式";
    button.addEventListener("click", () => {
      const next = document.body.dataset.reader === "pro" ? "plain" : "pro";
      document.body.dataset.reader = next;
      localStorage.setItem("eirin-reader", next);
      button.setAttribute("aria-pressed", String(next === "pro"));
      button.textContent = next === "pro" ? "普通模式" : "專業模式";
    });
  }

  async function boot() {
    applyTheme();
    initReaderMode();
    el("copyDigestBtn").addEventListener("click", copyDigest);

    try {
      const response = await fetch(`${DIGEST_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.items) || !data.items.length) throw new Error("本期尚无要目");
      render(data);
    } catch (error) {
      el("digestList").innerHTML = `
        <li class="empty">
          <strong>要目尚未生成</strong>
          无法取得 data/digest/latest.json（${esc(error.message)}）。请稍后重试，或直接查看 <a href="./?view=index">全部文獻</a>。
        </li>`;
      el("digestNote").textContent = "每日 09:00 自动生成；生成失败时不会伪造解读。";
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
