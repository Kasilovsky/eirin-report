/* ==========================================================================
   竹林茶會
   - 公告：讀取 GitHub Issues（只顯示作者為 Kasilovsky 的）
   - 留言板：暫未開放（頁面僅顯示提示）
   ========================================================================== */
(() => {
  "use strict";

  const REPO = "Kasilovsky/eirin-report";
  const OWNER = "Kasilovsky";

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
        list.innerHTML = `<li class="empty"><strong>GitHub 介面暫時限流</strong>請稍後再試，或直接到 GitHub 查看。</li>`;
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const issues = await response.json();
      const notices = issues.filter((issue) => !issue.pull_request && issue.user?.login === OWNER);

      if (!notices.length) {
        list.innerHTML = `<li class="empty"><strong>暫無公告</strong>新的公告會在 GitHub 上發布後出現在這裡。</li>`;
        return;
      }

      list.innerHTML = notices.map((issue) => `
        <li class="notice-item">
          <a class="notice-title" href="${esc(issue.html_url)}" target="_blank" rel="noopener">${esc(issue.title)}</a>
          <div class="notice-meta">
            <span>${esc(formatDateTime(issue.created_at))}</span>
            <span>${esc(issue.comments)} 則回覆</span>
          </div>
        </li>`).join("");
    } catch (error) {
      list.innerHTML = `<li class="empty"><strong>公告未能載入</strong>${esc(error.message)}</li>`;
    }
  }

  function boot() {
    applyTheme();
    loadNotices();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
