/* ==========================================================================
   永遠亭 医療報告 — 要目独立页
   数据源：data/digest/latest.json（由 digest.py 生成）
   ========================================================================== */
(() => {
  "use strict";

  const BASE = document.documentElement.dataset.base || "";
  const DIGEST_URL = `${BASE}data/digest/latest.json`;

  const LANG = document.documentElement.lang === "en" ? "en" : "zh";
  const EN = LANG === "en";

  const CONF_LABEL = EN
    ? { high: "High", medium: "Medium", low: "Low" }
    : { high: "高", medium: "中", low: "低" };

  const STUDY_TYPE_EN = {
    "研究论文": "Research Article", "通信": "Correspondence", "述评": "Commentary",
    "Meta 分析": "Meta-analysis", "综述": "Review", "随机对照试验": "RCT",
    "病例报告": "Case Report", "评论": "Editorial", "观察性研究": "Observational Study",
    "系统综述": "Systematic Review", "II 期临床试验": "Phase II Trial",
    "临床试验": "Clinical Trial", "I 期临床试验": "Phase I Trial", "临床指南": "Guideline",
  };
  const typeLabel = (name) => (EN ? (STUDY_TYPE_EN[name] || name) : name);

  const T = EN ? {
    copy: "Copy digest",
    plain: "Plain mode",
    pro: "Pro mode",
    emptyTitle: "Digest not generated yet",
    emptyHint: (msg) => `Could not fetch data/digest/latest.json (${msg}). Please retry, or browse the <a href="./">full index</a>.`,
    noteDegraded: "Model interpretation is unavailable today (missing key or failed call). Only bibliographic records are shown; open PubMed for the abstract.",
    note: (n, provider) => `${n} items · organised by ${provider} from PubMed abstracts; figures are taken from the original text. An “evidence: low” tag means the abstract states no conclusion.`,
    copied: "Digest copied — paste it into your chat",
    copyFail: "Copy failed — please select manually",
    title: "Daily Digest · Eirin Medical Bulletin",
    proClinical: "Clinical note",
    proOriginal: "Original title",
    proChinese: "Chinese title",
    keyFinding: "Key finding",
    why: "Why it matters",
    evidence: "Evidence",
    pubMed: "PubMed ↗",
    conf: "Evidence",
  } : {
    copy: "複製要目",
    plain: "普通模式",
    pro: "專業模式",
    emptyTitle: "要目尚未生成",
    emptyHint: (msg) => `无法取得 data/digest/latest.json（${msg}）。请稍后重试，或直接查看 <a href="./?view=index">全部文獻</a>。`,
    noteDegraded: "本期未启用模型解读（缺少密钥或调用失败），以下仅为题录；摘要与原文请点开 PubMed 查看。",
    note: (n, provider) => `${n} 條 · 由 ${provider} 依 PubMed 摘要整理，數字均取自原文；標記「證據等級：低」者表示摘要未給出結論。`,
    copied: "要目已複製，可直接貼到群裡",
    copyFail: "複製失敗，請手動選取",
    title: "本期要目 · 永遠亭 医療報告",
    proClinical: "臨床備註",
    proOriginal: "原題",
    proChinese: "中文標題",
    keyFinding: "關鍵結果",
    why: "意義",
    evidence: "證據",
    pubMed: "PubMed 原文 ↗",
    conf: "證據等級",
  };

  const el = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));

  const pad = (n) => String(n).padStart(2, "0");

  function formatIssueDate(date) {
    if (EN) {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return `${months[date.getMonth()]} ${pad(date.getDate())}, ${date.getFullYear()}`;
    }
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
    const confidence = CONF_LABEL[item.confidence] || CONF_LABEL.medium;
    const tags = (item.tags || []).map((tag) => `<span>#${esc(tag)}</span>`).join("");

    const mainTitle = EN ? (item.title_en || item.title_zh || "") : (item.title_zh || item.title_en || "");
    const pro = [
      item.clinical_note ? `<p class="digest-row digest-pro"><b>${T.proClinical}</b>${esc(item.clinical_note)}</p>` : "",
      EN
        ? (item.title_zh ? `<p class="digest-row digest-pro"><b>${T.proChinese}</b>${esc(item.title_zh)}</p>` : "")
        : (item.title_en ? `<p class="digest-row digest-pro"><b>${T.proOriginal}</b>${esc(item.title_en)}</p>` : ""),
    ].join("");

    return `
      <li class="digest-item">
        <div class="digest-index" aria-hidden="true">${String(index).padStart(2, "0")}</div>
        <div>
          <div class="digest-kicker">
            <span class="j">${esc(item.journal || "")}</span>
            ${item.study_type ? `<span class="t">${esc(typeLabel(item.study_type))}</span>` : ""}
            <span>${esc(item.date || "")}</span>
            <span class="conf" data-level="${esc(item.confidence || "medium")}">${T.conf}: ${confidence}</span>
          </div>
          <h3 class="digest-title">${esc(mainTitle)}</h3>
          ${item.one_liner ? `<p class="digest-oneliner">${esc(item.one_liner)}</p>` : ""}
          ${item.key_finding ? `<p class="digest-row"><b>${T.keyFinding}</b>${esc(item.key_finding)}</p>` : ""}
          ${item.why_it_matters ? `<p class="digest-row"><b>${T.why}</b>${esc(item.why_it_matters)}</p>` : ""}
          ${pro}
          <div class="digest-foot">
            ${item.evidence ? `<span>${T.evidence}：${esc(item.evidence)}</span>` : ""}
            ${item.link ? `<a href="${esc(item.link)}" target="_blank" rel="noopener">${T.pubMed}</a>` : ""}
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
      note.textContent = T.noteDegraded;
    } else {
      note.className = "digest-note";
      note.textContent = T.note(data.count, data.provider || (EN ? "the model" : "模型"));
    }

    el("digestList").innerHTML = (data.items || []).map((item, i) => itemHtml(item, i + 1)).join("");
    if (window.EirinLang) window.EirinLang.apply();
    document.title = T.title;
  }

  function digestText() {
    if (!digest) return "";
    const today = new Date();
    const header = EN
      ? `[Eirin Medical Bulletin · Daily Digest] ${formatIssueDate(today)}`
      : `【永遠亭 医療報告 · 本期要目】${formatIssueDate(today)}`;
    const lines = [header, ""];
    (digest.items || []).forEach((item, index) => {
      lines.push(`${String(index + 1).padStart(2, "0")} | ${item.journal || ""} | ${typeLabel(item.study_type || "研究论文")}`);
      if (EN) {
        if (item.title_en) lines.push(item.title_en);
        if (item.title_zh) lines.push(item.title_zh);
      } else {
        if (item.title_zh) lines.push(item.title_zh);
        if (item.title_en) lines.push(item.title_en);
      }
      if (item.one_liner) lines.push(item.one_liner);
      if (item.key_finding) lines.push(item.key_finding);
      if (item.why_it_matters) lines.push(item.why_it_matters);
      lines.push(item.link || "", "");
    });
    lines.push(EN ? "— Eientei Central Design Bureau" : "—— E.C.D.B.");
    return lines.join("\n");
  }

  async function copyDigest() {
    if (!digest) { toast(EN ? "No digest yet" : "本期尚無要目"); return; }
    const ok = await copyText(digestText());
    toast(ok ? T.copied : T.copyFail);
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
    button.textContent = mode === "pro" ? T.plain : T.pro;
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
          <strong>${T.emptyTitle}</strong>
          ${T.emptyHint(esc(error.message))}
        </li>`;
      el("digestNote").textContent = EN
        ? "Generated automatically at 09:00 daily; no fabricated interpretation on failure."
        : "每日 09:00 自动生成；生成失败时不会伪造解读。";
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
