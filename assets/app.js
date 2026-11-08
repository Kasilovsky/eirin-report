/* ==========================================================================
   永遠亭 医療報告 — 前端逻辑
   数据由 crawler.py 生成，结构见 data/news.json（schema_version: 2）
   ========================================================================== */
(() => {
  "use strict";

  const BASE = document.documentElement.dataset.base || "";
  const DATA_URL = `${BASE}data/news.json`;
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

  /* 刊首語可在 data/forewords.json 中調整；載入失敗時退回內建文案 */
  const FOREWORDS_EN = [
    "The latest evidence, gathered and indexed. Read what matters, then go to the source.",
    "A conclusion is only as good as the data behind it.",
    "I keep watch beyond the bamboo grove; you read what holds up.",
    "Sample size and confidence intervals first — the title can wait.",
    "Numbers speak, and sometimes lie. Read them together with their intervals.",
    "The moon waxes and wanes; so does evidence.",
    "When in doubt, let the source decide.",
    "Nothing here replaces the original article.",
    "Ten papers, one question: what actually changed?",
    "Read the methods as you would read a pulse.",
  ];

  let forewords = EN ? FOREWORDS_EN : FOREWORDS;

  async function loadForewords() {
    try {
      const response = await fetch(`${BASE}data/forewords.json?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      const list = EN
        ? (Array.isArray(data) ? null : data?.index_en)
        : (Array.isArray(data) ? data : data?.index);
      if (Array.isArray(list) && list.length) forewords = list.filter((t) => typeof t === "string" && t.trim());
    } catch {
      /* 保持內建兜底 */
    }
  }

  /* ======================================================================
     語言：頁面 <html lang="en"> 時為英文模式（/en/ 站點），否則中文
     ====================================================================== */
  const LANG = document.documentElement.lang === "en" ? "en" : "zh";
  const EN = LANG === "en";

  const T = EN ? {
    issue: "Issue",
    articles: "articles",
    journals: "journals",
    updated: "Updated",
    expand: "Abstract",
    collapse: "Collapse",
    cite: "Copy citation",
    pubMed: "PubMed ↗",
    emptyTitle: "No matching articles in this range",
    emptyHint: "Try a wider date range, fewer filters, or clear the search keyword.",
    result: (n, page, pages) => `${n} articles · page ${page}/${pages}`,
    resultZero: "0 articles",
    loadedFail: "Failed to load index",
    loadedFailHint: (msg) => `Could not fetch data/news.json (${msg}). Please retry, or use the RSS feed.`,
    copied: (n) => `Copied ${n} entries`,
    copyFail: "Copy failed — please select manually",
    citeCopied: "Citation copied",
    citeFail: "Copy failed — please select manually",
    exportEmpty: "Nothing on this page to export",
    exportDone: "Exported this page as Markdown",
    noAbstract: "No structured abstract for this entry — see the original article.",
    abstract: "Abstract",
    lead: "Summary",
    authors: "Authors",
    journal: "Journal",
    citation: "Citation",
    mesh: "MeSH",
    metaHeading: "Metadata",
    dateUnknown: "date unknown",
    seal: "Eientei Central Design Bureau",
  } : {
    issue: "第",
    articles: "篇",
    journals: "種期刊",
    updated: "更新於",
    expand: "展開摘要",
    collapse: "收起摘要",
    cite: "複製引文",
    pubMed: "PubMed 原文 ↗",
    emptyTitle: "此範圍內沒有符合條件的文獻",
    emptyHint: "請放寬時間範圍、取消部分篩選，或清除搜尋關鍵字。",
    result: (n, page, pages) => `共 <strong>${n}</strong> 篇 · 第 ${page}／${pages} 頁`,
    resultZero: "共 <strong>0</strong> 篇",
    loadedFail: "文獻索引未能載入",
    loadedFailHint: (msg) => `無法取得 data/news.json（${msg}）。請稍後重試，或參閱 <a href="feed.xml">RSS 訂閱源</a>。`,
    copied: (n) => `已複製 ${n} 條速報`,
    copyFail: "複製失敗，請手動選取",
    citeCopied: "引文已複製",
    citeFail: "複製失敗，請手動選取",
    exportEmpty: "本頁沒有可匯出的條目",
    exportDone: "已匯出本頁 Markdown",
    noAbstract: "該條目未附結構化摘要，請參閱原文。",
    abstract: "原文摘要",
    lead: "提要",
    authors: "作者",
    journal: "期刊",
    citation: "引文",
    mesh: "主題詞",
    metaHeading: "著錄",
    dateUnknown: "日期未詳",
    seal: "E.C.D.B.",
  };

  /* 科別與研究類型：資料層是中文，英文模式需要映射 */
  const DEPT_EN = {
    "循环器": "Cardiology", "综合": "General", "妇产": "Obstetrics & Gynecology",
    "公共卫生": "Public Health", "肿瘤": "Oncology", "呼吸器": "Pulmonology",
    "神经": "Neurology", "皮肤": "Dermatology", "内分泌/代谢": "Endocrinology",
    "外科": "Surgery", "肾脏/泌尿": "Nephrology & Urology", "消化器": "Gastroenterology",
    "感染": "Infectious Disease", "血液": "Hematology", "老年医学": "Geriatrics",
    "遗传/基因": "Genetics", "免疫/风湿": "Immunology & Rheumatology", "儿科": "Pediatrics",
    "麻醉/重症": "Anesthesia & Critical Care", "疫苗": "Vaccines", "移植": "Transplantation",
    "精神": "Psychiatry", "骨科": "Orthopedics", "药学": "Pharmacology", "眼科": "Ophthalmology",
  };

  const STUDY_TYPE_EN = {
    "研究论文": "Research Article", "通信": "Correspondence", "述评": "Commentary",
    "Meta 分析": "Meta-analysis", "综述": "Review", "随机对照试验": "RCT",
    "病例报告": "Case Report", "评论": "Editorial", "观察性研究": "Observational Study",
    "系统综述": "Systematic Review", "II 期临床试验": "Phase II Trial",
    "临床试验": "Clinical Trial", "I 期临床试验": "Phase I Trial", "临床指南": "Guideline",
  };

  const deptLabel = (name) => (EN ? (DEPT_EN[name] || name) : name);
  const typeLabel = (name) => (EN ? (STUDY_TYPE_EN[name] || name) : name);

  const state = {
    data: null,
    q: "",
    journals: new Set(),
    depts: new Set(),
    days: 7,
    sort: "date-desc",
    page: 1,
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
    if (EN) {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return `${months[date.getMonth()]} ${pad(date.getDate())}, ${date.getFullYear()}`;
    }
    return `${reiwaLabel(date)}（${date.getFullYear()}）${pad(date.getMonth() + 1)}月${pad(date.getDate())}日`;
  }

  function issueNumber(date) {
    const days = Math.floor((date - ISSUE_EPOCH) / 86400000);
    const n = String(Math.max(days + 1, 1)).padStart(3, "0");
    return EN ? `No. ${n}` : `第 ${n} 號`;
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
    const totalCount = data.count || (data.articles || []).length;
    el("issueCount").textContent = EN ? `${totalCount} articles` : `${totalCount} 篇`;
    const journals = (data.journals || []).filter((j) => j.count > 0);
    el("issueSources").textContent = journals.length
      ? (EN ? `${journals.length} journals` : `${journals.length} 種期刊`)
      : "PubMed";
    el("updatedAt").textContent = formatStamp(data.generated_at);

    const fallback = EN ? FOREWORDS_EN : FOREWORDS;
    const list = forewords.length ? forewords : fallback;
    const fwParam = new URLSearchParams(location.search).get("fw");
    const index = fwParam !== null && Number.isInteger(Number(fwParam))
      ? Math.abs(Number(fwParam)) % list.length
      : Math.floor(today / 86400000) % list.length;
    el("forewordText").textContent = list[index];
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
    if (article.authors) meta.push([T.authors, esc(article.authors)]);
    if (article.journal) meta.push([T.journal, esc(article.journal)]);
    if (article.citation) meta.push([T.citation, esc(article.citation)]);
    if (article.doi) meta.push(["DOI", `<code>${esc(article.doi)}</code>`]);
    meta.push(["PMID", `<code>${esc(article.pmid)}</code>`]);
    if (article.mesh && article.mesh.length) meta.push([T.mesh, esc(article.mesh.slice(0, 6).join(" / "))]);

    if (EN) {
      const abstract = article.summary_en
        ? `<h4>${T.abstract}</h4><p class="detail-abstract">${esc(article.summary_en)}</p>`
        : `<h4>${T.abstract}</h4><p class="detail-abstract">${T.noAbstract}</p>`;
      return `
        ${abstract}
        <h4>${T.metaHeading}</h4>
        <dl class="detail-meta">${meta.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${value}</dd></div>`).join("")}</dl>
      `;
    }

    const summary = article.summary_en
      ? `<h4>${T.abstract}</h4><p class="detail-abstract">${esc(article.summary_en)}</p>`
      : `<h4>${T.abstract}</h4><p class="detail-abstract">${T.noAbstract}</p>`;

    return `
      <h4>${T.lead}</h4>
      <p class="detail-lead">${esc(article.summary_zh || "（暫無中文提要）")}</p>
      ${summary}
      <h4>${T.metaHeading}</h4>
      <dl class="detail-meta">${meta.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${value}</dd></div>`).join("")}</dl>
    `;
  }

  function articleHtml(article, index) {
    const hasZh = Boolean(article.title_zh);
    const mainTitle = EN ? article.title_en : (hasZh ? article.title_zh : article.title_en);
    const subTitle = EN ? (hasZh ? article.title_zh : "") : (hasZh ? article.title_en : "");
    const depts = (article.departments || []).map(deptLabel).join(" · ");

    return `
      <li class="entry" data-pmid="${esc(article.pmid)}" data-lang="${hasZh ? "zh" : "en"}">
        <div class="entry-index" aria-hidden="true">${String(index).padStart(2, "0")}</div>
        <div class="entry-body">
          <div class="entry-kicker">
            <span class="entry-journal">${esc(article.journal || article.journal_abbr || "")}</span>
            ${article.study_type ? `<span class="entry-type">${esc(typeLabel(article.study_type))}</span>` : ""}
            <span class="entry-date">${esc(article.date || T.dateUnknown)}</span>
            ${depts ? `<span>· ${esc(depts)}</span>` : ""}
          </div>
          <h3 class="entry-title" tabindex="0" role="button" aria-expanded="false">
            <span class="entry-title-zh">${esc(mainTitle)}</span>
            ${subTitle ? `<span class="entry-title-en">${esc(subTitle)}</span>` : ""}
          </h3>
          <div class="entry-citation">${esc(article.citation || "")}</div>
          <div class="entry-actions">
            <button class="link-btn" type="button" data-act="toggle">${T.expand}</button>
            <button class="link-btn" type="button" data-act="cite">${T.cite}</button>
            ${article.link ? `<a class="link-btn" href="${esc(article.link)}" target="_blank" rel="noopener">${T.pubMed}</a>` : ""}
          </div>
          <div class="entry-detail">${detailHtml(article)}</div>
        </div>
      </li>`;
  }

  function renderEmpty() {
    el("entries").innerHTML = `
      <li class="empty">
        <strong>${T.emptyTitle}</strong>
        ${T.emptyHint}
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
      ? T.result(matched.length, state.page, totalPages)
      : T.resultZero;

    if (!pageItems.length) {
      renderEmpty();
    if (window.EirinLang) window.EirinLang.apply();
      return;
    }

    el("entries").innerHTML = pageItems.map((article, i) => articleHtml(article, start + i + 1)).join("");
    bindEntries();
    renderPager(totalPages);
    if (window.EirinLang) window.EirinLang.apply();
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
        toggleBtn.textContent = open ? T.collapse : T.expand;
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
        toast(ok ? T.citeCopied : T.citeFail);
      });
    });
  }

  function buildCitation(article) {
    const authors = article.authors || "";
    const title = EN ? (article.title_en || article.title_zh || "") : (article.title_zh || article.title_en || "");
    const source = article.citation || article.journal || "";
    const doi = article.doi ? ` DOI: ${article.doi}.` : "";
    return `${authors}. ${title}[J]. ${source}.${doi} PMID: ${article.pmid}.`;
  }

  /* ----------------------------------------------------------- 导出功能 --- */

  function markdownOf(articles, title) {
    const lines = [`# ${title}`, ""];
    articles.forEach((article, index) => {
      lines.push(`## ${String(index + 1).padStart(2, "0")}　${article.journal_abbr || article.journal || ""}　${typeLabel(article.study_type || "")}`);
      lines.push("");
      if (EN) {
        lines.push(`**${article.title_en || article.title_zh || ""}**`, "");
        if (article.summary_en) lines.push(`> ${article.summary_en}`, "");
        lines.push(`- Citation: ${article.citation || "——"}`);
        lines.push(`- PMID: ${article.pmid}${article.doi ? `  DOI: ${article.doi}` : ""}`);
        lines.push(`- Specialty: ${(article.departments || []).map(deptLabel).join(", ") || "General"}`, "");
      } else {
        if (article.title_zh) lines.push(`**${article.title_zh}**`, "");
        lines.push(article.title_en || "", "");
        if (article.summary_zh) lines.push(`> ${article.summary_zh}`, "");
        lines.push(`- 引文：${article.citation || "——"}`);
        lines.push(`- PMID：${article.pmid}${article.doi ? `　DOI：${article.doi}` : ""}`);
        lines.push(`- 科別：${(article.departments || []).join("、") || "綜合"}`, "");
      }
    });
    lines.push(`—— ${T.seal}`);
    return lines.join("\n");
  }

  function currentPageArticles() {
    const matched = visibleArticles();
    const start = (state.page - 1) * PAGE_SIZE;
    return matched.slice(start, start + PAGE_SIZE);
  }

  async function exportMarkdown() {
    const articles = currentPageArticles();
    if (!articles.length) { toast(T.exportEmpty); return; }
    const today = new Date();
    const digestTitle = EN
      ? `Eirin Medical Bulletin · ${issueNumber(today)} (${formatIssueDate(today)})`
      : `永遠亭 医療報告 · ${issueNumber(today)}（${formatIssueDate(today)}）`;
    const md = markdownOf(articles, digestTitle);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `eirin-report-${isoToday()}-p${state.page}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast(T.exportDone);
  }

  /* 複製本頁索引速報（純文字，直接貼到聊天窗口） */
  async function copyPageDigest() {
    const articles = currentPageArticles();
    if (!articles.length) { toast(T.exportEmpty); return; }

    const today = new Date();
    const header = EN
      ? `[Eirin Medical Bulletin] ${issueNumber(today)} · ${formatIssueDate(today)}`
      : `【永遠亭 医療報告】${issueNumber(today)} · ${formatIssueDate(today)}`;
    const lines = [header, ""];
    articles.forEach((article, index) => {
      lines.push(`${String(index + 1).padStart(2, "0")} | ${article.journal_abbr || article.journal || ""} | ${typeLabel(article.study_type || "研究论文")}`);
      lines.push(EN ? (article.title_en || article.title_zh || "") : (article.title_zh || article.title_en || ""));
      if (EN) {
        if (article.title_zh) lines.push(article.title_zh);
      } else if (article.title_zh) {
        lines.push(article.title_en || "");
      }
      lines.push(`　${article.citation || ""}`);
      lines.push(`　${article.link || ""}`, "");
    });
    lines.push(`—— ${T.seal}`);

    const ok = await copyText(lines.join("\n"));
    toast(ok ? T.copied(articles.length) : T.copyFail);
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
    renderChips("deptChips", depts, state.depts, (item) => deptLabel(item), 12);
  }

  async function boot() {
    initTheme();
    state.hideNoise = localStorage.getItem("eirin-hide-noise") !== "false";
    readUrl();
    wireControls();

    try {
      state.data = await loadData();
    } catch (error) {
      el("entries").innerHTML = `
        <li class="empty">
          <strong>${T.loadedFail}</strong>
          ${T.loadedFailHint(esc(error.message))}
        </li>`;
      el("resultSummary").textContent = EN ? "Failed" : "載入失敗";
      document.querySelector(".loading")?.remove();
      return;
    }

    el("q").value = state.q;
    el("sortSelect").value = state.sort;
    el("rangeChips").querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-pressed", String(Number(b.dataset.days) === state.days));
    });

    await loadForewords();
    renderMeta();
    bootChips();
    render();
    syncUrl();

    if (state.data.failures && state.data.failures.length) {
      const note = document.createElement("div");
      note.className = "result-bar";
      note.innerHTML = EN
        ? `<span>Some journals failed this run: ${esc(state.data.failures.join("; "))}</span><span>Previous data kept</span>`
        : `<span>本期部分期刊採集失敗：${esc(state.data.failures.join("；"))}</span><span>已保留既有數據</span>`;
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
