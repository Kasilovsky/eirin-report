/* ==========================================================================
   竹林茶會
   - 公告：讀取 GitHub Issues（只顯示作者為 Kasilovsky 的）
   - 留言板：暫未開放（頁面僅顯示提示）
   ========================================================================== */
(() => {
  "use strict";

  const REPO = "Kasilovsky/eirin-report";
  const OWNER = "Kasilovsky";

  const BASE = document.documentElement.dataset.base || "";
  const LANG = document.documentElement.lang === "en" ? "en" : "zh";
  const EN = LANG === "en";

  const T = EN ? {
    loading: "Loading announcements…",
    rateLimited: "GitHub API is rate-limited — please try again later, or open GitHub directly.",
    empty: "No announcements yet. New ones appear here once published on GitHub.",
    loadFail: "Failed to load announcements",
    metaComments: (n) => `${n} replies`,
    foreword: "Words wanted, words spoken. Announcements are mine to make; suggestions are yours to send.",
    todo: "This feature is not ready yet. Thanks for your patience.",
    footerNote: "Announcements are hosted on GitHub Issues; the message board is not open yet.",
    back: "← Back to the bulletin · Daily Digest",
    pageTitle: "Bamboo Grove Salon · Eirin Medical Bulletin",
  } : {
    loading: "正在調閱公告…",
    rateLimited: "GitHub 介面暫時限流",
    empty: "暫無公告",
    loadFail: "公告未能載入",
    metaComments: (n) => `${n} 則回覆`,
    foreword: "有話想說，便去說。公告由我發，建議由你提。",
    todo: "該功能還未完善，敬請期待。",
    footerNote: "公告寄存於 GitHub Issues；留言板暫未開放。",
    back: "← 返回医療報告 · 本期要目",
    pageTitle: "竹林茶會 · 永遠亭 医療報告",
  };

  const el = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));

  const pad = (n) => String(n).padStart(2, "0");

  function formatDateTime(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "——";
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function applyTheme() {
    const saved = localStorage.getItem("eirin-theme");
    const dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }

  async function loadNotices() {
    const list = el("noticeList");
    if (!list) return;
    try {
      const response = await fetch(
        `https://api.github.com/repos/${REPO}/issues?state=all&per_page=40&sort=created&direction=desc`,
        { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" },
      );
      if (response.status === 403 || response.status === 429) {
        list.innerHTML = `<li class="empty"><strong>${esc(T.rateLimited)}</strong></li>`;
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const issues = await response.json();
      const notices = issues.filter((issue) => !issue.pull_request && issue.user?.login === OWNER);

      if (!notices.length) {
        list.innerHTML = `<li class="empty"><strong>${esc(T.empty)}</strong></li>`;
        return;
      }

      list.innerHTML = notices.map((issue) => `
        <li class="notice-item">
          <a class="notice-title" href="${esc(issue.html_url)}" target="_blank" rel="noopener">${esc(issue.title)}</a>
          <div class="notice-meta">
            <span>${esc(formatDateTime(issue.created_at))}</span>
            <span>${esc(T.metaComments(issue.comments))}</span>
          </div>
        </li>`).join("");
    } catch (error) {
      list.innerHTML = `<li class="empty"><strong>${esc(T.loadFail)}</strong>${esc(error.message)}</li>`;
    }
  }

  /* 討論頁刊首語可在 data/forewords.json 的 discuss 欄位調整 */
  async function loadForeword() {
    const node = el("forewordText");
    if (!node) return;
    try {
      const response = await fetch(`data/forewords.json?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      if (data && typeof data.discuss === "string" && data.discuss.trim()) {
        node.textContent = data.discuss;
        if (window.EirinLang) window.EirinLang.apply();
      }
    } catch {
      /* 保留頁面內靜態文案 */
    }
  }

  function boot() {
    applyTheme();
    document.title = T.pageTitle;

    const todo = document.querySelector(".board-todo");
    if (todo) todo.textContent = T.todo;

    const footerNote = document.querySelector("[data-footer-note]");
    if (footerNote) footerNote.textContent = T.footerNote;

    const backLink = document.querySelector("[data-back-link]");
    if (backLink) backLink.textContent = T.back;

    loadForeword();
    loadNotices();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
