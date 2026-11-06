/* ==========================================================================
   竹林茶會 — 議題索引用
   只做「讀取公開 Issues + 跳轉 GitHub 發言」，不在前端保存任何憑證。
   ========================================================================== */
(() => {
  "use strict";

  const REPO = "Kasilovsky/eirin-report";
  const API = `https://api.github.com/repos/${REPO}/issues?state=all&per_page=30&sort=created&direction=desc`;

  const el = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));

  const pad = (n) => String(n).padStart(2, "0");

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "——";
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function applyTheme() {
    const saved = localStorage.getItem("eirin-theme");
    const dark = saved
      ? saved === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }

  function renderEmpty(message) {
    el("threads").innerHTML = `<li class="empty"><strong>${esc(message)}</strong>可到 GitHub 上直接查看。</li>`;
  }

  async function loadThreads() {
    el("threads").innerHTML = `<li class="loading">正在調閱議題…</li>`;
    try {
      const response = await fetch(API, {
        headers: { Accept: "application/vnd.github+json" },
        cache: "no-store",
      });
      if (response.status === 403 || response.status === 429) {
        renderEmpty("GitHub 介面暫時限流，請稍後再試。");
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const issues = await response.json();
      const threads = issues.filter((issue) => !issue.pull_request);

      if (!threads.length) {
        renderEmpty("目前尚無討論。");
        return;
      }

      el("threads").innerHTML = threads.map((issue) => {
        const labels = (issue.labels || [])
          .map((label) => `<span class="thread-tag">${esc(label.name)}</span>`)
          .join("");
        return `
          <li class="thread">
            <a class="thread-title" href="${esc(issue.html_url)}" target="_blank" rel="noopener">
              ${esc(issue.title)}
            </a>
            <div class="thread-meta">
              <span>#${esc(issue.number)}</span>
              <span>${esc(issue.user?.login || "anonym")}</span>
              <span>${esc(formatDate(issue.created_at))}</span>
              <span>${esc(issue.comments)} 則回覆</span>
              ${labels}
            </div>
          </li>`;
      }).join("");
    } catch (error) {
      renderEmpty(`議題未能載入（${error.message}）。`);
    }
  }

  function boot() {
    applyTheme();
    el("newThread").href = `https://github.com/${REPO}/issues/new`;
    el("refresh").addEventListener("click", loadThreads);
    loadThreads();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
