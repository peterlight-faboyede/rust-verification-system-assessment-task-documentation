/**
 * Wraps concrete tools (languages, frameworks, libraries, products) in prose — not protocols,
 * formats, or generic technical terms (e.g. tracing, REST, HTTP).
 */
(function () {
  "use strict";

  const SKIP_SELECTOR =
    "code, pre, kbd, samp, script, style, noscript, #doc-search-overlay, .stack-tag, .tech-name";

  const TERMS = [
    "tracing-subscriber",
    "utoipa-swagger-ui",
    "tower-http",
    "tower_governor",
    "libphonenumber",
    "tokio::task::JoinSet",
    "tokio::time::interval",
    "tokio::time::timeout",
    "tokio::spawn",
    "tokio-util",
    "tower::Service",
    "tower::Layer",
    "ca-certificates",
    "cargo-chef",
    "futures-util",
    "sqlx-cli",
    "SQLX_OFFLINE",
    "actix-web",
    "async-std",
    "serde_json",
    "PostgreSQL",
    "Swagger UI",
    "Kubernetes",
    "CloudWatch",
    "RabbitMQ",
    "OpenAPI",
    "TypeScript",
    "JavaScript",
    "Node.js",
    "Postgres",
    "Supabase",
    "distroless",
    "Bookworm",
    "Prometheus",
    "terraform",
    "Makefile",
    "Swagger",
    "GitHub",
    "GitLab",
    "Alpine",
    "Debian",
    "Docker",
    "Chrono",
    "Serde",
    "SQLx",
    "Axum",
    "Tokio",
    "Tower",
    "Hyper",
    "Utoipa",
    "Envy",
    "Secrecy",
    "Diesel",
    "Lapin",
    "Redis",
    "dotenvy",
    "validator",
    "phonenumber",
    "thiserror",
    "anyhow",
    "subtle",
    "rand",
    "Grafana",
    "nginx",
    "MySQL",
    "SQLite",
    "glibc",
    "Rust",
    "AWS",
    "RDS",
    "GCP",
    "Unix",
    "Linux",
    "musl",
    "Cargo",
    "npm",
  ];

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function termToSubpattern(t) {
    const e = escapeRegExp(t.trim());
    if (!e) return null;
    if (/^[A-Za-z0-9][\w.-]*$/.test(t)) {
      if (t.includes("-") || t.includes(".") || /^\d/.test(t)) {
        return `(?<![\\w.-])${e}(?![\\w.-])`;
      }
      return `\\b${e}\\b`;
    }
    return `(?<![A-Za-z0-9])${e}(?![A-Za-z0-9])`;
  }

  function buildPattern() {
    const seen = new Set();
    const unique = [];
    for (const t of TERMS) {
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      unique.push(t.trim());
    }
    unique.sort((a, b) => b.length - a.length);
    const parts = unique.map(termToSubpattern).filter(Boolean);
    return parts.join("|");
  }

  function wrapTechNames(root) {
    const pattern = buildPattern();
    if (!pattern) return;
    const re = new RegExp(`(${pattern})`, "gi");

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !/\S/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p || p.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    for (const textNode of textNodes) {
      const text = textNode.nodeValue;
      if (!re.test(text)) continue;
      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      let m;
      const splitRe = new RegExp(`(${pattern})`, "gi");
      while ((m = splitRe.exec(text)) !== null) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
        const span = document.createElement("span");
        span.className = "tech-name";
        span.setAttribute("translate", "no");
        span.appendChild(document.createTextNode(m[0]));
        frag.appendChild(span);
        lastIndex = m.index + m[0].length;
      }
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      const parent = textNode.parentNode;
      if (parent) parent.replaceChild(frag, textNode);
    }
  }

  function run() {
    const roots = document.querySelectorAll("main, header.site-header, header.hub-hero");
    roots.forEach((r) => wrapTechNames(r));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
