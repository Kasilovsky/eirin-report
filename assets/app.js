/* ==========================================================================
   永遠亭 医療報告 — 前端逻辑
   数据由 crawler.py 生成，结构见 data/news.json（schema_version: 2）
   ========================================================================== */
(() => {
  "use strict";

  const DATA_URL = "data/news.json";
  const PAGE_SIZE = 20;
  const ISSUE_EPOCH = new Date(2026, 4, 26); // 第 1 號：令和八年五月二十六日

  const FOREWORDS = [
    "今日的藥材已備齊，請諸位自行取用。",
    "月都的醫者不只看結論，數據與出處同樣要緊。",
    "報告裡每一行都能回溯到原文，這是我唯一能給的保證。",
    "讀文獻先讀方法學，正如診病先診脈。",
    "勿因標題驚惶，先看樣本量與置信區間。",
    "竹林之外的動靜，我替諸位看著。",
    "若時間不允，讀摘要即可；若有餘裕，請翻原文。",
    "醫學沒有捷徑，但可以有索引。",
    "本報告只錄已刊之物，未刊之說不收。",
    "數字會說話，也會撒謊——請連同區間一起看。",
    "月有圓缺，證據亦然。",
    "今日無事，即為佳訊；若有，必如實相告。",
    "值得注意的我挑了出來，其餘的留在原處。",
    "一份報告勝過十條消息。",
    "處方的第一條，永遠是「出處在哪」。",
    "晨間先看療效，再看不良事件。",
    "文獻已歸檔，月末自可回查。",
    "不必謝我，這是本分。",
    "證據的份量不由聲量決定。",
    "把不確定說成確定，是醫者最常見的過失。"
  ];

  const state = {
    data: null,
    q: "",
    journals: new Set(),
    depts: new Set(),
    days: 7,
    sort: "date-desc",
    page: 1,
    digest: null,
    view: "digest",
    hideNoise: true,
  };

  /* 索引视图默认隐藏的低价值题录类型 */
  const NOISE_PUBTYPES = new Set([
    "Published Erratum",
    "Retraction of Publication",
    "Letter",
    "Comment",
    "Editorial",
    "Biography",
    "Historical Article",
    "News",
    "Obituary",
  ]);

  const el = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));

  /* ------------------------------------------------------------- 日期工具 --- */

  const pad = (n) => String(n).padStart(2, "0");

  function reiwaLabel(date) {
    return `令和${date.getFullYear() - 2018}年`;
  }

  function formatIssueDate(date) {
    return `${reiwaLabel(date)}（${date.getFullYear()}）${pad(date.getMonth() + 1)}月${pad(date.getDate())}日`;
  }

  function issueNumber(date) {
    const days = Math.floor((date - ISSUE_EPOCH) / 86400000);
    return `第 ${String(Math.max(days + 1, 1)).padStart(3, "0")} 號`;
  }

  function isoToday() {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function formatStamp(iso) {
    if (!iso) return "——";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "——";
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  /* --------------------------------------------------------------- 提示条 --- */

  let toastTimer = 0;
  function toast(message) {
    const node = el("toast");
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

  /* --------------------------------------------------------------- 主题 --- */

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("eirin-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#121719" : "#f7f4ec");
  }

  function initTheme() {
    const saved = localStorage.getItem("eirin-theme");
    if (saved === "dark" || saved === "light") {
      applyTheme(saved);
      return;
    }
    applyTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }

  /* --------------------------------------------------------------- 筛选 --- */

  function visibleArticles() {
    if (!state.data) return [];
    const articles = state.data.articles || [];

    let cutoff = "";
    if (state.days > 0) {
      const day = new Date();
      day.setDate(day.getDate() - state.days);
      cutoff = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
    }

    const keyword = state.q.trim().toLowerCase();
    const matched = articles.filter((article) => {
      if (cutoff && (!article.date || article.date < cutoff)) return false;
      if (state.hideNoise && (article.pubtypes || []).some((type) => NOISE_PUBTYPES.has(type))) return false;
      if (state.journals.size && !state.journals.has(article.journal_abbr)) return false;
      if (state.depts.size && !(article.departments || []).some((d) => state.depts.has(d))) return false;
      if (keyword) {
        const haystack = [
          article.title_zh, article.title_en, article.authors, article.pmid,
          article.doi, article.journal, article.citation,
        ].join(" ").toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      return true;
    });

    const sorted = matched.slice();
    if (state.sort === "date-asc") {
      sorted.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    } else if (state.sort === "journal") {
      sorted.sort((a, b) => (a.journal || "").localeCompare(b.journal || "", "zh-Hant")
        || (b.date || "").localeCompare(a.date || ""));
    } else {
      sorted.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    }
    return sorted;
  }

  /* --------------------------------------------------------------- 渲染 --- */

  function renderChips(containerId, items, selected, labelOf = (x) => x, limit = Infinity) {
    const container = el(containerId);
    const visible = items.slice(0, limit);
    const hidden = items.length - visible.length;

    const buttonHtml = visible.map((item) => {
      const value = typeof item === "string" ? item : item.value;
      const active = selected.has(value) ? "true" : "false";
      return `<button class="chip" type="button" data-value="${esc(value)}" aria-pressed="${active}">${esc(labelOf(item))}</button>`;
    }).join("");

    container.innerHTML = buttonHtml
      + (hidden > 0 ? `<button class="chip chip-more" type="button" data-more="1">＋ 其他 ${hidden} 項</button>` : "");

    container.querySelectorAll("button[data-value]").forEach((button) => {
      button.addEventListener("click", () => {
        const value = button.dataset.value;
        if (selected.has(value)) selected.delete(value);
        else selected.add(value);
        button.setAttribute("aria-pressed", selected.has(value) ? "true" : "false");
        state.page = 1;
        syncUrl();
        render();
      });
    });

    const moreBtn = container.querySelector("button[data-more]");
    if (moreBtn) {
      moreBtn.addEventListener("click", () => renderChips(containerId, items, selected, labelOf, Infinity));
    }
  }

  function renderMeta() {
    const data = state.data;
    const today = new Date();
    el("issueNo").textContent = issueNumber(today);
    el("issueDate").textContent = formatIssueDate(today);
    el("issueCount").textContent = `${data.count || (data.articles || []).length} 篇`;
    const journals = (data.journals || []).filter((j) => j.count > 0);
    el("issueSources").textContent = journals.length ? `${journals.length} 種期刊` : "PubMed";
    el("updatedAt").textContent = formatStamp(data.generated_at);

    const dayIndex = Math.floor(today / 86400000) % FOREWORDS.length;
    el("forewordText").textContent = FOREWORDS[dayIndex];
  }

  function renderPager(totalPages) {
    const pager = el("pager");
    if (totalPages <= 1) { pager.innerHTML = ""; return; }

    const page = state.page;
    const buttons = [];
    const push = (label, target, disabled = false, current = false) => {
      buttons.push(`<button type="button" data-page="${target}"${disabled ? " disabled" : ""}${current ? ' aria-current="page"' : ""}>${label}</button>`);
    };

    push("‹", page - 1, page <= 1);

    const windowStart = Math.max(1, page - 2);
    const windowEnd = Math.min(totalPages, page + 2);
    if (windowStart > 1) {
      push("1", 1);
      if (windowStart > 2) buttons.push('<span class="gap">…</span>');
    }
    for (let index = windowStart; index <= windowEnd; index += 1) push(String(index), index, false, index === page);
    if (windowEnd < totalPages) {
      if (windowEnd < totalPages - 1) buttons.push('<span class="gap">…</span>');
      push(String(totalPages), totalPages);
    }

    push("›", page + 1, page >= totalPages);
    pager.innerHTML = buttons.join("");
    pager.querySelectorAll("button[data-page]").forEach((button) => {
      button.addEventListener("click", () => {
        const target = Number(button.dataset.page);
        if (target >= 1 && target <= totalPages && target !== state.page) {
          state.page = target;
          syncUrl();
          render();
          el("entries").scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
  }

  function detailHtml(article) {
    const meta = [];
    if (article.authors) meta.push(["作者", esc(article.authors)]);
    if (article.journal) meta.push(["期刊", esc(article.journal)]);
    if (article.citation) meta.push(["引文", esc(article.citation)]);
    if (article.doi) meta.push(["DOI", `<code>${esc(article.doi)}</code>`]);
    meta.push(["PMID", `<code>${esc(article.pmid)}</code>`]);
    if (article.mesh && article.mesh.length) meta.push(["主題詞", esc(article.mesh.slice(0, 6).join(" / "))]);

    const summary = article.summary_en
      ? `<h4>原文摘要</h4><p class="detail-abstract">${esc(article.summary_en)}</p>`
      : `<h4>原文摘要</h4><p class="detail-abstract">該條目未附結構化摘要，請參閱原文。</p>`;

    return `
      <h4>提要</h4>
      <p class="detail-lead">${esc(article.summary_zh || "（暫無中文提要）")}</p>
      ${summary}
      <h4>著錄</h4>
      <dl class="detail-meta">${meta.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${value}</dd></div>`).join("")}</dl>
    `;
  }

  function articleHtml(article, index) {
    const hasZh = Boolean(article.title_zh);
    const mainTitle = hasZh ? article.title_zh : article.title_en;
    const subTitle = hasZh ? article.title_en : "";
    const depts = (article.departments || []).join(" · ");

    return `
      <li class="entry" data-pmid="${esc(article.pmid)}" data-lang="${hasZh ? "zh" : "en"}">
        <div class="entry-index" aria-hidden="true">${String(index).padStart(2, "0")}</div>
        <div class="entry-body">
          <div class="entry-kicker">
            <span class="entry-journal">${esc(article.journal || article.journal_abbr || "")}</span>
            ${article.study_type ? `<span class="entry-type">${esc(article.study_type)}</span>` : ""}
            <span class="entry-date">${esc(article.date || "日期未詳")}</span>
            ${depts ? `<span>· ${esc(depts)}</span>` : ""}
          </div>
          <h3 class="entry-title" tabindex="0" role="button" aria-expanded="false">
            <span class="entry-title-zh">${esc(mainTitle)}</span>
            ${subTitle ? `<span class="entry-title-en">${esc(subTitle)}</span>` : ""}
          </h3>
          <div class="entry-citation">${esc(article.citation || "")}</div>
          <div class="entry-actions">
            <button class="link-btn" type="button" data-act="toggle">展開摘要</button>
            <button class="link-btn" type="button" data-act="cite">複製引文</button>
            ${article.link ? `<a class="link-btn" href="${esc(article.link)}" target="_blank" rel="noopener">PubMed 原文 ↗</a>` : ""}
          </div>
          <div class="entry-detail">${detailHtml(article)}</div>
        </div>
      </li>`;
  }

  function renderEmpty() {
    el("entries").innerHTML = `
      <li class="empty">
        <strong>此範圍內沒有符合條件的文獻</strong>
        請放寬時間範圍、取消部分篩選，或清除搜尋關鍵字。
      </li>`;
    el("pager").innerHTML = "";
  }

  function render() {
    if (!state.data) return;
    const matched = visibleArticles();
    const totalPages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;

    const start = (state.page - 1) * PAGE_SIZE;
    const pageItems = matched.slice(start, start + PAGE_SIZE);

    el("resultSummary").innerHTML = matched.length
      ? `共 <strong>${matched.length}</strong> 篇 · 第 ${state.page}／${totalPages} 頁`
      : `共 <strong>0</strong> 篇`;

    if (!pageItems.length) {
      renderEmpty();
      return;
    }

    el("entries").innerHTML = pageItems.map((article, i) => articleHtml(article, start + i + 1)).join("");
    bindEntries();
    renderPager(totalPages);
  }

  function bindEntries() {
    el("entries").querySelectorAll(".entry").forEach((entry) => {
      const title = entry.querySelector(".entry-title");
      const toggleBtn = entry.querySelector('[data-act="toggle"]');
      const citeBtn = entry.querySelector('[data-act="cite"]');
      const pmid = entry.dataset.pmid;

      const toggle = () => {
        const open = entry.dataset.open !== "true";
        entry.dataset.open = String(open);
        title.setAttribute("aria-expanded", String(open));
        toggleBtn.textContent = open ? "收起摘要" : "展開摘要";
      };

      title.addEventListener("click", toggle);
      title.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      });
      toggleBtn.addEventListener("click", toggle);

      citeBtn.addEventListener("click", async () => {
        const article = (state.data.articles || []).find((item) => item.pmid === pmid);
        if (!article) return;
        const citation = buildCitation(article);
        const ok = await copyText(citation);
        toast(ok ? "引文已複製" : "複製失敗，請手動選取");
      });
    });
  }

  function buildCitation(article) {
    const authors = article.authors || "";
    const title = article.title_zh || article.title_en || "";
    const source = article.citation || article.journal || "";
    const doi = article.doi ? ` DOI: ${article.doi}.` : "";
    return `${authors}. ${title}[J]. ${source}.${doi} PMID: ${article.pmid}.`;
  }

  /* ----------------------------------------------------------- 导出功能 --- */

  function markdownOf(articles, title) {
    const lines = [`# ${title}`, ""];
    articles.forEach((article, index) => {
      lines.push(`## ${String(index + 1).padStart(2, "0")}　${article.journal_abbr || article.journal || ""}　${article.study_type || ""}`);
      lines.push("");
      if (article.title_zh) lines.push(`**${article.title_zh}**`, "");
      lines.push(article.title_en || "", "");
      if (article.summary_zh) lines.push(`> ${article.summary_zh}`, "");
      lines.push(`- 引文：${article.citation || "——"}`);
      lines.push(`- PMID：${article.pmid}${article.doi ? `　DOI：${article.doi}` : ""}`);
      lines.push(`- 科別：${(article.departments || []).join("、") || "綜合"}`, "");
    });
    lines.push("—— 永遠亭 医療部 · 八意永琳");
    return lines.join("\n");
  }

  function currentPageArticles() {
    const matched = visibleArticles();
    const start = (state.page - 1) * PAGE_SIZE;
    return matched.slice(start, start + PAGE_SIZE);
  }

  async function exportMarkdown() {
    const articles = currentPageArticles();
    if (!articles.length) { toast("本頁沒有可匯出的條目"); return; }
    const today = new Date();
    const md = markdownOf(articles, `永遠亭 医療報告 · ${issueNumber(today)}（${formatIssueDate(today)}）`);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `eirin-report-${isoToday()}-p${state.page}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast("已匯出本頁 Markdown");
  }

  /* 複製本頁索引速報（純文字，直接貼到聊天窗口） */
  async function copyPageDigest() {
    const articles = currentPageArticles();
    if (!articles.length) { toast("本頁沒有可複製的條目"); return; }

    const today = new Date();
    const lines = [
      `【永遠亭 医療報告】${issueNumber(today)} · ${formatIssueDate(today)}`,
      "",
    ];
    articles.forEach((article, index) => {
      lines.push(`${String(index + 1).padStart(2, "0")}｜${article.journal_abbr || article.journal || ""}｜${article.study_type || "研究"}`);
      lines.push(article.title_zh || article.title_en || "");
      if (article.title_zh) lines.push(article.title_en || "");
      lines.push(`　${article.citation || ""}`);
      lines.push(`　${article.link || ""}`, "");
    });
    lines.push("—— 永遠亭 医療部 · 八意永琳");

    const ok = await copyText(lines.join("\n"));
    toast(ok ? `已複製 ${articles.length} 條速報` : "複製失敗，請手動選取");
  }

  /* --------------------------------------------------------- URL 状态同步 --- */

  function syncUrl() {
    const params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    if (state.journals.size) params.set("journal", [...state.journals].join(","));
    if (state.depts.size) params.set("dept", [...state.depts].join(","));
    if (state.days !== 7) params.set("range", String(state.days));
    if (state.sort !== "date-desc") params.set("sort", state.sort);
    if (state.page > 1) params.set("page", String(state.page));
    if (state.view === "index") params.set("view", "index");
    const query = params.toString();
    history.replaceState(null, "", query ? `?${query}` : location.pathname);
  }

  function readUrl() {
    const params = new URLSearchParams(location.search);
    if (params.get("q")) state.q = params.get("q");
    if (params.get("journal")) params.get("journal").split(",").filter(Boolean).forEach((j) => state.journals.add(j));
    if (params.get("dept")) params.get("dept").split(",").filter(Boolean).forEach((d) => state.depts.add(d));
    if (params.get("range") !== null && params.get("range") !== "") state.days = Number(params.get("range")) || 0;
    if (params.get("sort")) state.sort = params.get("sort");
    if (params.get("page")) state.page = Math.max(1, Number(params.get("page")) || 1);
    if (params.get("view") === "index") state.view = "index";
  }

  /* 要目 / 文献索引 两个视图互斥显示，避免要目把检索区挤到下方 */
  function setView(view, { silent = false } = {}) {
    state.view = view === "index" ? "index" : "digest";
    const digestPanel = el("digestSection");
    const indexPanel = el("indexView");
    if (!digestPanel || !indexPanel) return;

    const isDigest = state.view === "digest";
    digestPanel.hidden = !isDigest;
    indexPanel.hidden = isDigest;
    el("tabDigest").setAttribute("aria-selected", String(isDigest));
    el("tabIndex").setAttribute("aria-selected", String(!isDigest));
    localStorage.setItem("eirin-view", state.view);
    if (!silent) syncUrl();
  }

  /* --------------------------------------------------------------- 初始化 --- */

  async function loadData() {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.articles)) throw new Error("資料格式不符");
    return data;
  }

  function wireControls() {
    el("tabDigest").addEventListener("click", () => setView("digest"));
    el("tabIndex").addEventListener("click", () => setView("index"));

    const hideNoise = el("hideNoise");
    if (hideNoise) {
      hideNoise.checked = state.hideNoise;
      hideNoise.addEventListener("change", () => {
        state.hideNoise = hideNoise.checked;
        localStorage.setItem("eirin-hide-noise", String(state.hideNoise));
        state.page = 1;
        syncUrl();
        render();
      });
    }

    el("q").addEventListener("input", (event) => {
      state.q = event.target.value;
      state.page = 1;
      syncUrl();
      render();
    });

    el("sortSelect").addEventListener("change", (event) => {
      state.sort = event.target.value;
      state.page = 1;
      syncUrl();
      render();
    });

    el("rangeChips").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-days]");
      if (!button) return;
      el("rangeChips").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false"));
      button.setAttribute("aria-pressed", "true");
      state.days = Number(button.dataset.days);
      state.page = 1;
      syncUrl();
      render();
    });

    el("resetBtn").addEventListener("click", () => {
      state.q = "";
      state.journals.clear();
      state.depts.clear();
      state.days = 7;
      state.sort = "date-desc";
      state.page = 1;
      el("q").value = "";
      el("sortSelect").value = "date-desc";
      el("rangeChips").querySelectorAll("button").forEach((b) => {
        b.setAttribute("aria-pressed", b.dataset.days === "7" ? "true" : "false");
      });
      syncUrl();
      bootChips();
      render();
    });

    el("themeToggle").addEventListener("click", () => {
      applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    });

    el("exportBtn").addEventListener("click", exportMarkdown);
    el("copyBtn").addEventListener("click", copyPageDigest);
    el("copyDigestBtn").addEventListener("click", copyDigest);

    el("topBtn").addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    document.addEventListener("keydown", (event) => {
      const active = document.activeElement;
      const tag = active ? active.tagName : "";
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (active && active.isContentEditable);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        el("q").focus();
        el("q").select();
      } else if (event.key === "Escape" && active === el("q")) {
        el("q").value = "";
        state.q = "";
        state.page = 1;
        syncUrl();
        render();
        el("q").blur();
      }
    });
  }

  function bootChips() {
    const data = state.data;
    const journalItems = (data.journals || [])
      .filter((j) => j.count > 0)
      .map((j) => ({ value: j.abbr, label: j.name || j.abbr }));
    renderChips("journalChips", journalItems, state.journals, (item) => item.label);

    const deptCount = new Map();
    (data.articles || []).forEach((article) => {
      (article.departments || []).forEach((dept) => {
        deptCount.set(dept, (deptCount.get(dept) || 0) + 1);
      });
    });
    const depts = [...deptCount.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hant"))
      .map(([name]) => name);
    renderChips("deptChips", depts, state.depts, (item) => item, 12);
  }

  /* ------------------------------------------------------------ 本期要目 --- */

  const DIGEST_URL = "data/digest/latest.json";
  const CONF_LABEL = { high: "高", medium: "中", low: "低" };

  async function loadDigest() {
    try {
      const response = await fetch(`${DIGEST_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return null;
      const data = await response.json();
      return Array.isArray(data.items) && data.items.length ? data : null;
    } catch {
      return null;
    }
  }

  function digestItemHtml(item, index) {
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

  function renderDigest(digest) {
    state.digest = digest;

    const note = el("digestNote");
    if (digest.degraded) {
      note.className = "digest-degraded";
      note.textContent = "本期未启用模型解读（缺少密钥或调用失败），以下仅为题录；摘要与原文请点开 PubMed 查看。";
    } else {
      note.className = "digest-note";
      note.textContent = `${digest.count} 條 · 由 ${digest.provider || "模型"} 依 PubMed 摘要整理，數字均取自原文；標記「證據等級：低」者表示摘要未給出結論。`;
    }

    el("digestList").innerHTML = (digest.items || [])
      .map((item, index) => digestItemHtml(item, index + 1))
      .join("");
  }

  function digestText() {
    const digest = state.digest;
    if (!digest) return "";
    const today = new Date();
    const lines = [`【永遠亭 医療報告】${issueNumber(today)} · ${formatIssueDate(today)}`, ""];
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
    if (!state.digest) { toast("本期尚無要目"); return; }
    const ok = await copyText(digestText());
    toast(ok ? "要目已複製，可直接貼到群裡" : "複製失敗，請手動選取");
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
    initTheme();
    initReaderMode();
    state.hideNoise = localStorage.getItem("eirin-hide-noise") !== "false";
    readUrl();
    wireControls();

    // 首屏视图：URL 参数优先，其次沿用上次选择
    const hasViewParam = new URLSearchParams(location.search).has("view");
    if (!hasViewParam && localStorage.getItem("eirin-view") === "index") {
      state.view = "index";
    }
    setView(state.view, { silent: true });

    try {
      state.data = await loadData();
    } catch (error) {
      el("entries").innerHTML = `
        <li class="empty">
          <strong>文獻索引未能載入</strong>
          無法取得 data/news.json（${esc(error.message)}）。請稍後重試，或參閱 <a href="feed.xml">RSS 訂閱源</a>。
        </li>`;
      el("resultSummary").textContent = "載入失敗";
      document.querySelector(".loading")?.remove();
      return;
    }

    el("q").value = state.q;
    el("sortSelect").value = state.sort;
    el("rangeChips").querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-pressed", String(Number(b.dataset.days) === state.days));
    });

    renderMeta();
    bootChips();
    render();
    syncUrl();

    const digest = await loadDigest();
    if (digest) {
      renderDigest(digest);
    } else if (state.view === "digest") {
      /* 没有要目数据时直接落到检索视图，避免空白 */
      setView("index", { silent: true });
    }

    if (state.data.failures && state.data.failures.length) {
      const note = document.createElement("div");
      note.className = "result-bar";
      note.innerHTML = `<span>本期部分期刊採集失敗：${esc(state.data.failures.join("；"))}</span><span>已保留既有數據</span>`;
      el("colophon")?.parentNode?.insertBefore(note, el("colophon"));
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {
        /* 离线缓存失败不影响主功能 */
      });
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
