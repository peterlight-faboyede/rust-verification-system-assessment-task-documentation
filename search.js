(function () {
  "use strict";

  const DEBOUNCE_MS = 280;
  const MAX_RESULTS = 75;
  const HIGHLIGHT_MS = 5200;
  const HIGHLIGHT_STORAGE_KEY = "doc-search-highlight";
  const INDEX_URL = new URL("search-index.json", window.location.href).href;

  /** Skipped for matching so questions and filler don't block results */
  const STOP_WORDS = new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "if",
    "so",
    "as",
    "at",
    "by",
    "for",
    "in",
    "of",
    "on",
    "to",
    "from",
    "with",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "between",
    "under",
    "against",
    "about",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "having",
    "do",
    "does",
    "did",
    "doing",
    "done",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "shall",
    "can",
    "need",
    "ought",
    "it",
    "its",
    "this",
    "that",
    "these",
    "those",
    "i",
    "me",
    "my",
    "we",
    "us",
    "our",
    "you",
    "your",
    "he",
    "him",
    "his",
    "she",
    "her",
    "hers",
    "they",
    "them",
    "their",
    "what",
    "which",
    "who",
    "whom",
    "whose",
    "where",
    "when",
    "why",
    "how",
    "all",
    "any",
    "both",
    "each",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "no",
    "nor",
    "not",
    "only",
    "own",
    "same",
    "than",
    "too",
    "very",
    "just",
    "also",
    "again",
    "further",
    "then",
    "once",
    "here",
    "there",
    "because",
    "while",
    "although",
    "unless",
    "until",
    "whether",
    "either",
    "neither",
    "let",
    "like",
    "upon",
    "within",
    "without",
  ]);

  let highlightClearTimer = 0;

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function highlightTermsForQuery(query) {
    const { words, phrase } = searchTokens(query);
    const terms = [];
    if (phrase.length >= 2) terms.push(phrase);
    for (const w of words) {
      if (w.length >= 1) terms.push(w);
    }
    return [...new Set(terms)].sort((a, b) => b.length - a.length);
  }

  function clearSearchHighlights() {
    document.querySelectorAll("mark.doc-search-hit").forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    });
  }

  function highlightTermsInElement(root, query) {
    const terms = highlightTermsForQuery(query);
    if (terms.length === 0) return;
    const pattern = terms.map(escapeRegExp).join("|");
    if (!pattern) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !/\S/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        let el = node.parentElement;
        while (el) {
          if (el.id === "doc-search-overlay") return NodeFilter.FILTER_REJECT;
          if (el.classList && el.classList.contains("doc-search-hit")) return NodeFilter.FILTER_REJECT;
          if (el.closest && el.closest("script, style, noscript, #doc-search-overlay"))
            return NodeFilter.FILTER_REJECT;
          el = el.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    const re = new RegExp(`(${pattern})`, "gi");
    for (const textNode of textNodes) {
      const text = textNode.nodeValue;
      if (!re.test(text)) continue;
      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      let m;
      const splitRe = new RegExp(`(${pattern})`, "gi");
      while ((m = splitRe.exec(text)) !== null) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
        const mark = document.createElement("mark");
        mark.className = "doc-search-hit";
        mark.appendChild(document.createTextNode(m[0]));
        frag.appendChild(mark);
        lastIndex = m.index + m[0].length;
      }
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      const parent = textNode.parentNode;
      if (parent) parent.replaceChild(frag, textNode);
    }
  }

  function scheduleHighlight(id, query) {
    window.clearTimeout(highlightClearTimer);
    clearSearchHighlights();
    const raw = (query && String(query).trim()) || "";
    if (!raw || !id) return;
    const el = document.getElementById(id);
    if (!el) return;
    highlightTermsInElement(el, raw);
    highlightClearTimer = window.setTimeout(() => {
      clearSearchHighlights();
      highlightClearTimer = 0;
    }, HIGHLIGHT_MS);
  }

  function consumePendingHighlight() {
    try {
      const raw = sessionStorage.getItem(HIGHLIGHT_STORAGE_KEY);
      if (!raw) return;
      sessionStorage.removeItem(HIGHLIGHT_STORAGE_KEY);
      const data = JSON.parse(raw);
      if (!data || !data.id) return;
      const here = currentPageFile();
      if (data.page && data.page !== here) return;
      const run = () => scheduleHighlight(data.id, data.query || "");
      requestAnimationFrame(() => requestAnimationFrame(run));
    } catch (_) {}
  }

  /** @type {{ items: Array<Record<string, unknown>> } | null} */
  let indexData = null;
  let loadPromise = null;

  function currentPageFile() {
    const path = window.location.pathname || "";
    const seg = path.split("/").filter(Boolean).pop() || "index.html";
    return seg.includes(".") ? seg : "index.html";
  }

  function isHome() {
    const p = currentPageFile().toLowerCase();
    return p === "index.html" || p === "" || p === "index.htm";
  }

  function decodeEntities(html) {
    const t = document.createElement("textarea");
    t.innerHTML = html;
    return t.value;
  }

  function loadIndex() {
    if (indexData) return Promise.resolve(indexData);
    if (loadPromise) return loadPromise;
    const embedded =
      typeof window !== "undefined" &&
      window.__DOC_SEARCH_INDEX__ &&
      Array.isArray(window.__DOC_SEARCH_INDEX__.items);
    if (embedded) {
      indexData = window.__DOC_SEARCH_INDEX__;
      loadPromise = Promise.resolve(indexData);
      return loadPromise;
    }
    loadPromise = fetch(INDEX_URL)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data) => {
        indexData = data;
        return data;
      })
      .catch((e) => {
        console.warn("Doc search index failed", e);
        indexData = { items: [] };
        return indexData;
      });
    return loadPromise;
  }

  function tokenize(q) {
    return q
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);
  }

  /** Words used for AND match + phrase bonus; strips stop words, falls back if nothing left */
  function searchTokens(queryRaw) {
    const all = tokenize(queryRaw);
    if (all.length === 0) return { words: [], phrase: "" };
    const stripped = all.filter((w) => !STOP_WORDS.has(w));
    const words = stripped.length > 0 ? stripped : all;
    const phrase = words.join(" ");
    return { words, phrase };
  }

  function scoreItem(item, words, phrase) {
    const text = item.searchText;
    if (!text || words.length === 0) return 0;
    for (const w of words) {
      if (!text.includes(w)) return 0;
    }
    let score = 10;
    if (phrase.length >= 2 && text.includes(phrase)) score += 80;
    const st = (item.sectionTitle || "").toLowerCase();
    const su = (item.subsectionTitle || "").toLowerCase();
    const pt = (item.pageTitle || "").toLowerCase();
    for (const w of words) {
      if (pt.includes(w)) score += 12;
      if (st.includes(w)) score += 14;
      if (su.includes(w)) score += 16;
    }
    const sn = (item.snippet || "").toLowerCase();
    for (const w of words) {
      let i = 0;
      while ((i = sn.indexOf(w, i)) !== -1) {
        score += 2;
        i += w.length;
      }
    }
    return score;
  }

  function searchItems(items, queryRaw) {
    const { words, phrase } = searchTokens(queryRaw);
    if (words.length === 0) return [];
    const scored = [];
    for (const item of items) {
      const s = scoreItem(item, words, phrase);
      if (s > 0) scored.push({ item, score: s });
    }
    scored.sort((a, b) => b.score - a.score || String(a.item.anchor).localeCompare(String(b.item.anchor)));
    return scored.slice(0, MAX_RESULTS).map((x) => x.item);
  }

  function parseAnchor(anchor) {
    const [page, frag] = String(anchor).split("#");
    return { page: page || "", hash: frag ? `#${frag}` : "" };
  }

  function getSearchQuery() {
    return ((overlayInput && overlayInput.value) || "").trim();
  }

  function navigateToItem(item, query, opts) {
    const close = opts && opts.closeOverlay;
    const q = query !== undefined && query !== null ? String(query).trim() : getSearchQuery();
    const { page, hash } = parseAnchor(item.anchor);
    const here = currentPageFile();
    const id = hash.replace(/^#/, "");
    if (page && page === here) {
      window.location.hash = id || "";
      const afterScroll = () => {
        const el = id ? document.getElementById(id) : null;
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        scheduleHighlight(id, q);
      };
      requestAnimationFrame(() => requestAnimationFrame(afterScroll));
      if (close) closeOverlay();
    } else {
      if (id && q) {
        try {
          sessionStorage.setItem(
            HIGHLIGHT_STORAGE_KEY,
            JSON.stringify({ query: q, id, page: page || here }),
          );
        } catch (_) {}
      }
      if (close) closeOverlay();
      window.location.href = item.anchor;
    }
  }

  function breadcrumb(it) {
    const parts = [
      decodeEntities(String(it.pageTitle || "")),
      decodeEntities(String(it.sectionTitle || "")),
      decodeEntities(String(it.subsectionTitle || "")),
    ].filter(Boolean);
    return parts.join(" › ");
  }

  function headingLabel(tag) {
    const t = String(tag || "").toLowerCase();
    if (t === "section") return "Chapter section";
    if (t === "article") return "Article block";
    if (t === "h3" || t === "h4") return "Subsection";
    return "Block";
  }

  /** @type {HTMLElement | null} */
  let overlayEl = null;
  /** @type {HTMLInputElement | null} */
  let overlayInput = null;
  /** @type {HTMLInputElement | null} */
  let homeInput = null;
  let debounceTimer = 0;
  /** @type {Array<Record<string, unknown>>} */
  let matches = [];
  let matchIndex = 0;

  function setMatches(next) {
    matches = next;
    matchIndex = 0;
    updateNavUi();
  }

  function renderResults() {
    if (!overlayEl) return;
    const list = overlayEl.querySelector("[data-doc-search-list]");
    const status = overlayEl.querySelector("[data-doc-search-status]");
    if (!list || !status) return;
    list.innerHTML = "";
    const q = (overlayInput && overlayInput.value) || "";
    if (!q.trim()) {
      status.textContent = "Type to search across all chapters.";
      return;
    }
    if (matches.length === 0) {
      status.textContent = "No matches — try different words.";
      return;
    }
    status.textContent = `${matches.length} match${matches.length === 1 ? "" : "es"} · ${matchIndex + 1} of ${matches.length}`;

    matches.forEach((it, i) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "doc-search-result" + (i === matchIndex ? " is-active" : "");
      row.setAttribute("data-index", String(i));
      const bc = document.createElement("span");
      bc.className = "doc-search-result-bc";
      bc.textContent = breadcrumb(it);
      const meta = document.createElement("span");
      meta.className = "doc-search-result-meta";
      meta.textContent = `${headingLabel(it.headingTag)} · ${it.page}`;
      const sn = document.createElement("span");
      sn.className = "doc-search-result-snippet";
      sn.textContent = decodeEntities(String(it.snippet || "")).slice(0, 200);
      row.append(bc, meta, sn);
      row.addEventListener("click", () => {
        matchIndex = i;
        navigateToItem(it, getSearchQuery(), { closeOverlay: true });
      });
      list.appendChild(row);
    });
  }

  function updateNavUi() {
    if (!overlayEl) return;
    const prev = overlayEl.querySelector("[data-doc-search-prev]");
    const next = overlayEl.querySelector("[data-doc-search-next]");
    const go = overlayEl.querySelector("[data-doc-search-go]");
    const has = matches.length > 0;
    if (prev) prev.disabled = !has;
    if (next) next.disabled = !has;
    if (go) go.disabled = !has;
    const q = (overlayInput && overlayInput.value.trim()) || "";
    if (has && go) {
      const it = matches[matchIndex];
      const { page } = parseAnchor(it.anchor);
      go.textContent = page && page === currentPageFile() ? "Jump here" : "Open page";
    }
    renderResults();
  }

  function goNext() {
    if (matches.length === 0) return;
    matchIndex = (matchIndex + 1) % matches.length;
    updateNavUi();
    navigateToItem(matches[matchIndex], getSearchQuery(), { closeOverlay: true });
  }

  function goPrev() {
    if (matches.length === 0) return;
    matchIndex = (matchIndex - 1 + matches.length) % matches.length;
    updateNavUi();
    navigateToItem(matches[matchIndex], getSearchQuery(), { closeOverlay: true });
  }

  function goCurrent() {
    if (matches.length === 0) return;
    navigateToItem(matches[matchIndex], getSearchQuery(), { closeOverlay: true });
  }

  function syncHomeFromOverlay() {
    if (homeInput && overlayInput) homeInput.value = overlayInput.value;
  }

  function syncOverlayFromHome() {
    if (homeInput && overlayInput) overlayInput.value = homeInput.value;
  }

  function runSearchDebounced() {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      loadIndex().then((data) => {
        const q = (overlayInput && overlayInput.value) || "";
        const next = q.trim() ? searchItems(data.items || [], q) : [];
        setMatches(next);
      });
    }, DEBOUNCE_MS);
  }

  function openOverlay(fromHome) {
    if (!overlayEl) return;
    overlayEl.hidden = false;
    document.body.classList.add("doc-search-open");
    loadIndex().then(() => {
      if (fromHome) syncOverlayFromHome();
      overlayInput && overlayInput.focus();
      runSearchDebounced();
    });
  }

  function closeOverlay() {
    if (!overlayEl) return;
    overlayEl.hidden = true;
    document.body.classList.remove("doc-search-open");
    syncHomeFromOverlay();
  }

  function buildOverlay() {
    const root = document.createElement("div");
    root.id = "doc-search-overlay";
    root.className = "doc-search-overlay";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Search documentation");
    root.hidden = true;

    root.innerHTML = `
      <div class="doc-search-backdrop" data-doc-search-backdrop tabindex="-1"></div>
      <div class="doc-search-panel">
        <div class="doc-search-toolbar">
          <label class="doc-search-label" for="doc-search-input">Search</label>
          <input type="search" id="doc-search-input" class="doc-search-input" autocomplete="off" spellcheck="false" placeholder="e.g. RabbitMQ, lease, idempotency…" data-doc-search-input />
          <div class="doc-search-actions">
            <button type="button" class="doc-search-btn doc-search-btn-icon" data-doc-search-prev aria-label="Previous result">← Prev</button>
            <button type="button" class="doc-search-btn doc-search-btn-icon" data-doc-search-next aria-label="Next result">Next →</button>
            <button type="button" class="doc-search-btn doc-search-btn-primary" data-doc-search-go disabled>Jump</button>
            <button type="button" class="doc-search-btn" data-doc-search-close aria-label="Close search">Close</button>
          </div>
        </div>
        <p class="doc-search-status" data-doc-search-status>Type to search across all chapters.</p>
        <div class="doc-search-body">
          <div class="doc-search-list-wrap">
            <div class="doc-search-list" data-doc-search-list role="listbox" aria-label="Search results"></div>
          </div>
        </div>
        <p class="doc-search-kbd-hint"><kbd>/</kbd> open · <kbd>Esc</kbd> close · arrows when focused in list</p>
      </div>
    `;

    document.body.appendChild(root);
    overlayEl = root;
    overlayInput = root.querySelector("[data-doc-search-input]");

    root.querySelector("[data-doc-search-backdrop]")?.addEventListener("click", closeOverlay);
    root.querySelector("[data-doc-search-close]")?.addEventListener("click", closeOverlay);
    root.querySelector("[data-doc-search-prev]")?.addEventListener("click", goPrev);
    root.querySelector("[data-doc-search-next]")?.addEventListener("click", goNext);
    root.querySelector("[data-doc-search-go]")?.addEventListener("click", goCurrent);

    overlayInput?.addEventListener("input", () => {
      syncHomeFromOverlay();
      runSearchDebounced();
    });

    overlayInput?.addEventListener("keydown", (e) => {
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && matches.length) {
        e.preventDefault();
        if (e.key === "ArrowDown") goNext();
        else goPrev();
        const active = root.querySelector(".doc-search-result.is-active");
        active && active.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function buildHomeBar() {
    const hero = document.querySelector(".hub-hero");
    if (!hero) return;
    const wrap = document.createElement("div");
    wrap.className = "doc-search-home-wrap";
    wrap.innerHTML = `
      <label class="doc-search-home-label" for="doc-search-home-input">Search all documentation</label>
      <div class="doc-search-home-field">
        <span class="doc-search-home-icon" aria-hidden="true">⌕</span>
        <input type="search" id="doc-search-home-input" class="doc-search-home-input" autocomplete="off" spellcheck="false"
          placeholder="Search every chapter, section, and subsection…" />
      </div>
      <p class="doc-search-home-hint">Results update as you type. Use Next / Prev to move between hits anywhere in the docs.</p>
    `;
    hero.appendChild(wrap);
    homeInput = wrap.querySelector("#doc-search-home-input");
    homeInput?.addEventListener("focus", () => openOverlay(true));
    homeInput?.addEventListener("input", () => {
      if (overlayInput) overlayInput.value = homeInput.value;
      if (overlayEl && overlayEl.hidden) openOverlay(false);
      runSearchDebounced();
    });
    homeInput?.addEventListener("click", () => openOverlay(true));
  }

  function buildFab() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "doc-search-fab";
    btn.setAttribute("aria-label", "Search documentation");
    btn.setAttribute("title", "Search all docs · press /");
    btn.innerHTML = `
      <span class="doc-search-fab-inner">
        <svg class="doc-search-fab-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <span class="doc-search-fab-label">Search docs</span>
        <span class="doc-search-fab-shortcut"><kbd>/</kbd></span>
      </span>
    `;
    btn.addEventListener("click", () => openOverlay(false));
    document.body.appendChild(btn);
  }

  document.addEventListener("keydown", (e) => {
    const t = e.target;
    const tag = t && /** @type {HTMLElement} */ (t).tagName;
    const inField =
      tag === "INPUT" || tag === "TEXTAREA" || (t && /** @type {HTMLElement} */ (t).isContentEditable);
    if (e.key === "Escape" && overlayEl && !overlayEl.hidden) {
      e.preventDefault();
      closeOverlay();
      return;
    }
    if (e.key === "/" && !inField && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      openOverlay(false);
    }
  });

  function init() {
    buildOverlay();
    if (isHome()) buildHomeBar();
    else buildFab();
    consumePendingHighlight();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

