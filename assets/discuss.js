/* ==========================================================================
   竹林茶會 — 公告（GitHub Issues）+ 匿名留言板（Cloudflare Worker）
   ========================================================================== */
(() => {
  "use strict";

  const REPO = "Kasilovsky/eirin-report";
  const OWNER = "Kasilovsky";

  /* 部署 Worker 后把地址填在这里；留空则留言板显示「尚未開通」，公告不受影响 */
  const API_BASE = "";

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

  let toastTimer = 0;
  function toast(message) {
    const node = el("toast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("show"), 2200);
  }

  /* ---------------------------------------------------------------- 公告 --- */

  async function loadNotices() {
    const list = el("noticeList");
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

  /* -------------------------------------------------------------- 留言板 --- */

  const state = {
    token: localStorage.getItem("eirin-token") || "",
    name: localStorage.getItem("eirin-name") || "",
    mode: "login",
  };

  function apiReady() {
    return Boolean(API_BASE);
  }

  function saveSession(token, name) {
    state.token = token;
    state.name = name;
    localStorage.setItem("eirin-token", token);
    localStorage.setItem("eirin-name", name);
  }

  function clearSession() {
    state.token = "";
    state.name = "";
    localStorage.removeItem("eirin-token");
    localStorage.removeItem("eirin-name");
  }

  function renderAuthState() {
    const authed = Boolean(state.token && state.name);
    el("chatAuth").hidden = authed;
    el("chatCompose").hidden = !authed;
    if (authed) el("chatWho").textContent = state.name;
  }

  async function loadMessages() {
    const list = el("chatList");
    if (!apiReady()) {
      list.innerHTML = `<li class="empty"><strong>留言板尚未開通</strong>後端還沒部署，公告區不受影響。</li>`;
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/api/messages?limit=50`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const messages = data.messages || [];

      if (!messages.length) {
        list.innerHTML = `<li class="empty"><strong>還沒有留言</strong>展開後登入或註冊，寫第一句。</li>`;
        return;
      }

      list.innerHTML = messages.map((item) => `
        <li class="chat-item">
          <div class="chat-meta">
            <strong>${esc(item.name)}</strong>
            <time>${esc(formatDateTime(item.createdAt))}</time>
          </div>
          <p class="chat-text">${esc(item.content)}</p>
        </li>`).join("");
    } catch (error) {
      list.innerHTML = `<li class="empty"><strong>留言未能載入</strong>${esc(error.message)}</li>`;
    }
  }

  async function doAuth() {
    if (!apiReady()) { toast("留言板尚未開通"); return; }

    const name = el("authName").value.trim();
    const secret = el("authSecret").value;
    if (!name || !secret) { toast("請填名字和密碼"); return; }

    el("authSubmit").disabled = true;
    try {
      if (state.mode === "register") {
        const response = await fetch(`${API_BASE}/api/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, password: secret }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        saveSession(data.token, data.name);
        toast("註冊成功，token 已保存在本機");
      } else {
        const response = await fetch(`${API_BASE}/api/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, password: secret }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        saveSession(data.token, data.name);
        toast("登入成功");
      }
      el("authSecret").value = "";
      renderAuthState();
      loadMessages();
    } catch (error) {
      toast(error.message);
    } finally {
      el("authSubmit").disabled = false;
    }
  }

  async function doPost() {
    if (!apiReady()) { toast("留言板尚未開通"); return; }
    const content = el("chatInput").value.trim();
    if (!content) { toast("先寫點什麼"); return; }

    el("chatSend").disabled = true;
    try {
      const response = await fetch(`${API_BASE}/api/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.token}`,
        },
        body: JSON.stringify({ content }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      el("chatInput").value = "";
      el("chatCount").textContent = "0 / 500";
      await loadMessages();
    } catch (error) {
      toast(error.message);
    } finally {
      el("chatSend").disabled = false;
    }
  }

  function wireChat() {
    el("chatToggle").addEventListener("click", () => {
      const body = el("chatBody");
      const open = body.hidden;
      body.hidden = !open;
      el("chatToggle").setAttribute("aria-expanded", String(open));
      el("chatToggle").textContent = open ? "收起" : "展開";
      if (open) loadMessages();
    });

    el("chatAuth").querySelectorAll("[data-auth]").forEach((button) => {
      button.addEventListener("click", () => {
        state.mode = button.dataset.auth;
        el("chatAuth").querySelectorAll("[data-auth]").forEach((b) => {
          b.setAttribute("aria-pressed", String(b === button));
        });
        el("authSubmit").textContent = state.mode === "register" ? "註冊" : "登入";
        el("authHint").textContent = state.mode === "register"
          ? "註冊後會得到一組 token 並保存在本機；密碼只以雜湊形式保存，不會收集郵箱或手機。"
          : "用名字和密碼登入；忘記密碼只能重新註冊。";
      });
    });

    el("authSubmit").addEventListener("click", doAuth);
    el("chatSend").addEventListener("click", doPost);

    el("chatLogout").addEventListener("click", () => {
      clearSession();
      renderAuthState();
      toast("已登出");
    });

    el("chatInput").addEventListener("input", (event) => {
      el("chatCount").textContent = `${event.target.value.length} / 500`;
    });
  }

  function boot() {
    applyTheme();
    wireChat();
    renderAuthState();
    loadNotices();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
