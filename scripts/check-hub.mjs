import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HUB_CSS = path.join(ROOT, "assets", "css", "hub.css");
const SITE = "https://jangtrinh.github.io";
const BANNED = /open[\s-]source/i;
const FONT = "Be Vietnam Pro";
const BODY = {
  dark: { bg: "rgb(9, 9, 11)", color: "rgb(244, 244, 245)" },
  light: { bg: "rgb(250, 250, 250)", color: "rgb(9, 9, 11)" },
};
const VIEWS = [
  { width: 1440, height: 900, name: "1440" },
  { width: 390, height: 844, name: "390" },
];
const B2_VIEWS = [
  { width: 360, height: 844 },
  { width: 375, height: 844 },
  { width: 390, height: 844 },
];
const CLASSIC_SCROLLBAR = 15;
const CLASSIC_SCROLLBAR_CSS = "html{overflow-y:scroll!important;scrollbar-color:auto!important}::-webkit-scrollbar{width:15px}::-webkit-scrollbar-thumb{background:CanvasText}";
const SCHEMES = ["dark", "light"];
const RULE_ORDER = ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "B1", "B2", "B3", "B4", "B5"];
const COMPUTED_BASELINE = path.join(ROOT, "tests", "baselines", "computed-styles.json");
const B5_PROPS = [
  "color",
  "background-color",
  "border-top-color",
  "border-top-width",
  "border-radius",
  "font-size",
  "font-weight",
  "letter-spacing",
  "padding-top",
  "padding-left",
];
const B5_COMMON = [
  "body",
  ".site",
  ".site .mark",
  ".site nav a",
  '.site nav a[aria-current="page"]',
  "h1",
  "main h2",
  "footer",
  "footer a",
];
const B5_PAGE = {
  "/": [
    ".eco-tag",
    ".eco-list li",
    ".eco-list img",
    ".eco-name h4",
    ".links a",
    "#products li",
    "#products img",
  ],
  "/videos/": [
    ".v",
    ".v h3",
    ".group-head small",
    ".v .len",
    ".v .p img",
    ".group-head h2",
  ],
};
const B5_PAGES = [
  { file: "index.html", key: "/" },
  { file: "videos/index.html", key: "/videos/" },
];
const FREEZE = "*{animation:none!important;transition:none!important}";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".map": "application/json",
};

function relPosix(abs) {
  return path.relative(ROOT, abs).split(path.sep).join("/");
}

function oneLine(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function tokens(value) {
  return new Set(String(value || "").toLowerCase().split(/\s+/).filter(Boolean));
}

function tagAttrs(tag) {
  const attrs = {};
  const re = /([^\s=/"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;
  while ((match = re.exec(tag))) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function tagsOf(html, name) {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) || [];
}

function stripScripts(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

function eol(text) {
  return text.replace(/\r\n/g, "\n");
}

export function loadEnv() {
  const sitemap = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
  const locs = new Set();
  for (const match of sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) locs.add(match[1]);
  return {
    header: fs.readFileSync(path.join(ROOT, "scripts", "partials", "header.html"), "utf8"),
    footer: fs.readFileSync(path.join(ROOT, "scripts", "partials", "footer.html"), "utf8"),
    locs,
    llms: fs.readFileSync(path.join(ROOT, "llms.txt"), "utf8"),
    readme: fs.readFileSync(path.join(ROOT, "README.md"), "utf8"),
  };
}

function canonicalHrefOf(html) {
  for (const tag of tagsOf(html, "link")) {
    const attrs = tagAttrs(tag);
    if (tokens(attrs.rel).has("canonical") && attrs.href) return attrs.href.trim();
  }
  return null;
}

function canonicalPathOf(href) {
  try {
    const pathname = new URL(href).pathname || "/";
    return pathname === "" ? "/" : pathname;
  } catch {
    return null;
  }
}

function diskFromSiteUrl(url) {
  if (!url || url.origin !== SITE) return null;
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const abs = path.resolve(ROOT, pathname.replace(/^\/+/, ""));
  const root = path.resolve(ROOT);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

function marked(html, name) {
  const start = `<!-- hub:${name} -->`;
  const end = `<!-- /hub:${name} -->`;
  const open = html.indexOf(start);
  if (open < 0) return { error: "missing" };
  if (html.indexOf(start, open + start.length) !== -1) return { error: "duplicate" };
  const close = html.indexOf(end, open + start.length);
  if (close < 0) return { error: "missing" };
  return { inner: html.slice(open + start.length, close) };
}

function normHeader(text) {
  return eol(text).replaceAll(' aria-current="page"', "").trim();
}

function blankExtra(text) {
  return eol(text).replace(
    /<!-- hub:footer-extra -->[\s\S]*?<!-- \/hub:footer-extra -->/g,
    "<!-- hub:footer-extra --><!-- /hub:footer-extra -->",
  );
}

function extraInner(text) {
  const match = text.match(/<!-- hub:footer-extra -->([\s\S]*?)<!-- \/hub:footer-extra -->/);
  return match ? match[1] : null;
}

function extraAllowed(inner) {
  const anchors = inner.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
  for (const anchor of anchors) {
    const inside = anchor.replace(/^<a\b[^>]*>/i, "").replace(/<\/a>$/i, "");
    if (/<[a-z!/]/i.test(inside)) return false;
  }
  const rest = inner.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, "");
  return !/<[a-z!/]/i.test(rest);
}

function expectedCurrentHref(pathname) {
  if (pathname === "/") return "/#products";
  if (pathname === "/videos" || pathname === "/videos/") return "/videos/";
  return pathname || "";
}

function diffAt(left, right) {
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i++) if (left[i] !== right[i]) return i;
  return left.length === right.length ? -1 : n;
}

function jsonLdBlocks(html) {
  const blocks = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    const attrs = tagAttrs(`<script${match[1]}>`);
    if ((attrs.type || "").toLowerCase() === "application/ld+json") blocks.push(match[2]);
  }
  return blocks;
}

function countVideoObjects(node) {
  if (Array.isArray(node)) return node.reduce((sum, item) => sum + countVideoObjects(item), 0);
  if (!node || typeof node !== "object") return 0;
  const type = node["@type"];
  const types = Array.isArray(type) ? type : type == null ? [] : [type];
  let count = types.includes("VideoObject") ? 1 : 0;
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") count += countVideoObjects(value);
  }
  return count;
}

function countDataYt(html) {
  const tags = stripScripts(html).match(/<[^>]+>/g) || [];
  return tags.reduce((sum, tag) => sum + (/\sdata-yt\s*=/.test(tag) ? 1 : 0), 0);
}

function checkH1(html, add) {
  const href = canonicalHrefOf(html);
  const sheets = tagsOf(headOf(html), "link")
    .map(tagAttrs)
    .filter((attrs) => tokens(attrs.rel).has("stylesheet") && attrs.href);
  if (sheets.length === 0) {
    add("H1", "no stylesheet link to assets/css/hub.css");
    return;
  }
  if (!href) {
    add("H1", "no canonical URL to resolve the stylesheet");
    return;
  }
  const hit = sheets.some((attrs) => {
    let url;
    try {
      url = new URL(attrs.href, href);
    } catch {
      return false;
    }
    const disk = diskFromSiteUrl(url);
    return disk && path.resolve(disk) === path.resolve(HUB_CSS) && fs.existsSync(disk);
  });
  if (!hit) {
    add("H1", `stylesheet did not resolve to assets/css/hub.css (${sheets.map((attrs) => attrs.href).join(", ")})`);
  }
}

function headOf(html) {
  const match = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  return match ? match[1] : html;
}

function checkH2(html, add) {
  const visible = stripComments(stripScripts(html));
  if (/<style\b/i.test(visible)) add("H2", "style element");
  const tags = visible.match(/<[^>]+>/g) || [];
  if (tags.some((tag) => Object.prototype.hasOwnProperty.call(tagAttrs(tag), "style"))) {
    add("H2", "style attribute");
  }
}

function checkH4(html, env, add) {
  const header = marked(html, "header");
  const footer = marked(html, "footer");
  if (header.error) add("H4", `${header.error} hub:header markers`);
  if (footer.error) add("H4", `${footer.error} hub:footer markers`);
  if (!header.error) {
    const pageHeader = normHeader(header.inner);
    const partialHeader = eol(env.header).trim();
    const at = diffAt(pageHeader, partialHeader);
    if (at !== -1) add("H4", `header does not match scripts/partials/header.html at character ${at}`);
    const anchors = header.inner.match(/<a\b[^>]*>/gi) || [];
    const current = anchors.filter((tag) => /aria-current\s*=\s*"page"/i.test(tag));
    if (current.length !== 1) {
      add("H4", `header has ${current.length} aria-current="page"`);
    } else {
      const pathname = canonicalPathOf(canonicalHrefOf(html) || "");
      if (!pathname) {
        add("H4", "no canonical URL for aria-current");
      } else {
        const href = tagAttrs(current[0]).href || "";
        const want = expectedCurrentHref(pathname);
        if (href !== want) add("H4", `aria-current href "${href}" expected "${want}"`);
      }
    }
  }
  if (!footer.error) {
    const slot = extraInner(footer.inner);
    if (slot != null && !extraAllowed(slot)) {
      add("H4", "footer-extra contains markup other than text and links");
    }
    const pageFooter = blankExtra(footer.inner).trim();
    const partialFooter = blankExtra(env.footer).trim();
    const at = diffAt(pageFooter, partialFooter);
    if (at !== -1) add("H4", `footer does not match scripts/partials/footer.html at character ${at}`);
  }
}

function checkH5(html, add) {
  const head = headOf(html);
  const links = tagsOf(head, "link").map(tagAttrs);
  const metas = tagsOf(head, "meta").map(tagAttrs);
  if (!links.some((attrs) => tokens(attrs.rel).has("canonical") && attrs.href)) {
    add("H5", "missing canonical link");
  }
  const description = metas.find((attrs) => (attrs.name || "").toLowerCase() === "description");
  if (!description || !String(description.content || "").trim()) add("H5", "missing meta description");
  const themes = metas.filter((attrs) => (attrs.name || "").toLowerCase() === "theme-color");
  if (themes.length < 2 || themes.length > 3) {
    add("H5", `theme-color count ${themes.length}, expected 2 or 3`);
  }
  const media = new Set(themes.map((attrs) => (attrs.media || "").replace(/\s+/g, " ").trim().toLowerCase()));
  if (!media.has("(prefers-color-scheme: dark)")) add("H5", "missing theme-color for dark");
  if (!media.has("(prefers-color-scheme: light)")) add("H5", "missing theme-color for light");
  if (!links.some((attrs) => tokens(attrs.rel).has("icon"))) add("H5", "missing icon");
  const preloads = links.filter((attrs) => tokens(attrs.rel).has("preload") && (attrs.as || "").toLowerCase() === "font");
  if (preloads.length < 2) add("H5", `font preload count ${preloads.length}, expected at least 2`);
  const stripped = stripComments(stripScripts(html));
  const h1 = stripped.match(/<h1\b/gi) || [];
  if (h1.length !== 1) add("H5", `h1 count ${h1.length}, expected 1`);
  const body = stripped.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  const first = (body ? body[1] : stripped).match(/<a\b[^>]*>/i);
  if (!first) {
    add("H5", "no link in body");
  } else {
    const attrs = tagAttrs(first[0]);
    const href = attrs.href || "";
    if (!tokens(attrs.class).has("skip") || !href.startsWith("#")) {
      add("H5", `first link is not a skip link (href ${href || "missing"})`);
    }
  }
}

function checkH6(html, env, add) {
  const href = canonicalHrefOf(html);
  if (!href) {
    add("H6", "no canonical URL");
  } else {
    if (!env.locs.has(href)) add("H6", `canonical ${href} missing from sitemap.xml`);
    if (!env.llms.includes(href)) add("H6", `canonical ${href} missing from llms.txt`);
  }
  const blocks = jsonLdBlocks(html);
  let videoObjects = 0;
  blocks.forEach((block, index) => {
    try {
      videoObjects += countVideoObjects(JSON.parse(block));
    } catch (err) {
      add("H6", `JSON-LD block ${index + 1} does not parse: ${oneLine(err.message)}`);
    }
  });
  const cards = countDataYt(html);
  if (cards > 0 && cards !== videoObjects) {
    add("H6", `VideoObject count ${videoObjects} != data-yt count ${cards}`);
  }
}

function checkH7(html, add) {
  if (BANNED.test(html)) add("H7", "banned wording");
}

export function auditHtml(html, env) {
  const failures = [];
  const add = (rule, message) => failures.push({ rule, message });
  checkH1(html, add);
  checkH2(html, add);
  checkH4(html, env, add);
  checkH5(html, add);
  checkH6(html, env, add);
  checkH7(html, add);
  return failures;
}

function stripCssComments(css) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < css.length) {
        out += css[i];
        if (css[i] === "\\") {
          i += 1;
          if (i < css.length) out += css[i];
          i += 1;
          continue;
        }
        if (css[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? css.length : end + 2;
      out += " ";
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function endOfString(css, i) {
  const quote = css[i];
  i += 1;
  while (i < css.length) {
    if (css[i] === "\\") {
      i += 2;
      continue;
    }
    if (css[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

function exemptRanges(css) {
  const ranges = [];
  const stack = [];
  let i = 0;
  let preludeStart = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      i = endOfString(css, i);
      continue;
    }
    if (ch === "{") {
      stack.push({ prelude: css.slice(preludeStart, i), start: i + 1 });
      i += 1;
      preludeStart = i;
      continue;
    }
    if (ch === "}") {
      const top = stack.pop();
      if (top) {
        const name = top.prelude.replace(/\s+/g, " ").trim().toLowerCase();
        if (name === ":root" || name === "@font-face") ranges.push([top.start, i]);
      }
      i += 1;
      preludeStart = i;
      continue;
    }
    i += 1;
  }
  return ranges;
}

function covered(ranges, index) {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function inDeclarationValue(css, index) {
  for (let i = index - 1; i >= 0; i--) {
    const ch = css[i];
    if (ch === ":" || ch === ";" || ch === "{" || ch === "}") return ch === ":";
  }
  return false;
}

function isTokenFont(value) {
  const cleaned = value.replace(/\s*!important\s*$/i, "").trim();
  return /^(?:var\(--[A-Za-z0-9-]+\)\s*,\s*)*var\(--[A-Za-z0-9-]+\)\s*$/.test(cleaned);
}

export function auditCss(css, isHub) {
  const text = stripCssComments(css);
  const ranges = isHub ? exemptRanges(text) : [];
  const failures = [];
  const seen = new Set();
  const add = (message) => {
    if (failures.length >= 12) return;
    if (seen.has(message)) return;
    seen.add(message);
    failures.push({ rule: "H3", message });
  };
  const hex = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;
  const funcs = /\b(?:rgba?|hsla?)\(/gi;
  for (const re of [hex, funcs]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text))) {
      if (covered(ranges, match.index)) continue;
      if (!inDeclarationValue(text, match.index)) continue;
      add(`colour ${match[0]}`);
    }
  }
  const fonts = /(?:^|[^A-Za-z0-9_-])(font-family\s*:)/gi;
  let match;
  while ((match = fonts.exec(text))) {
    const propAt = match.index + match[0].length - match[1].length;
    if (covered(ranges, propAt)) continue;
    let end = propAt + "font-family".length;
    while (end < text.length && /\s/.test(text[end])) end += 1;
    if (text[end] !== ":") continue;
    end += 1;
    let value = "";
    while (end < text.length && text[end] !== ";" && text[end] !== "{" && text[end] !== "}") {
      value += text[end];
      end += 1;
    }
    value = value.trim();
    if (isHub && isTokenFont(value)) continue;
    add(`font-family ${value || "(empty)"}`);
    fonts.lastIndex = end;
  }
  return failures;
}

function readHtml(abs) {
  const html = fs.readFileSync(abs, "utf8");
  const canonicalHref = canonicalHrefOf(html);
  return {
    abs,
    rel: relPosix(abs),
    html,
    canonicalHref,
    canonicalPath: canonicalHref ? canonicalPathOf(canonicalHref) : null,
  };
}

function walkHtml(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "tests") continue;
    const abs = path.join(dir, name);
    // Reference fragments for H4, not pages.
    if (relPosix(abs) === "scripts/partials") continue;
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) walkHtml(abs, out);
    else if (name.endsWith(".html")) out.push(abs);
  }
}

function defaultCss() {
  const dir = path.join(ROOT, "assets", "css");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".css")).map((name) => path.join(dir, name)).sort();
}

function parseArgs(argv) {
  const opts = {
    static: false,
    browser: false,
    expectFail: false,
    updateBaselines: false,
    b4Target: null,
    files: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--static") opts.static = true;
    else if (arg === "--browser") opts.browser = true;
    else if (arg === "--expect-fail") opts.expectFail = true;
    else if (arg === "--update-baselines") opts.updateBaselines = true;
    else if (arg === "--b4-target") {
      const value = argv[++i];
      if (!value) {
        console.error("check-hub: --b4-target needs a path");
        process.exit(2);
      }
      opts.b4Target = normTarget(value);
    } else if (arg.startsWith("--")) {
      console.error(`check-hub: unknown option ${arg}`);
      process.exit(2);
    } else opts.files.push(arg);
  }
  if (opts.expectFail) {
    opts.runStatic = true;
    opts.runBrowser = true;
  } else if (opts.static && opts.browser) {
    opts.runStatic = true;
    opts.runBrowser = true;
  } else if (opts.static) {
    opts.runStatic = true;
    opts.runBrowser = false;
  } else if (opts.browser) {
    opts.runStatic = false;
    opts.runBrowser = true;
  } else {
    opts.runStatic = true;
    opts.runBrowser = true;
  }
  return opts;
}

function normTarget(value) {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return new URL(value).pathname || "/";
  }
  return value.startsWith("/") ? value : `/${value}`;
}

function resolveArg(file) {
  const abs = path.resolve(file);
  if (fs.existsSync(abs)) return abs;
  const fromRoot = path.resolve(ROOT, file);
  if (fs.existsSync(fromRoot)) return fromRoot;
  return abs;
}

function collect(opts) {
  if (opts.files.length === 0) {
    const html = [];
    walkHtml(ROOT, html);
    html.sort();
    return { html: html.map(readHtml), css: defaultCss() };
  }
  const html = [];
  const css = [];
  for (const file of opts.files) {
    const abs = resolveArg(file);
    if (!fs.existsSync(abs)) {
      console.error(`check-hub: file not found: ${file}`);
      process.exit(1);
    }
    if (abs.endsWith(".html")) html.push(readHtml(abs));
    else if (abs.endsWith(".css")) css.push(abs);
    else {
      console.error(`check-hub: skip ${file} (not html or css)`);
    }
  }
  return { html, css };
}

function staticFailures(bundle, env) {
  const failures = [];
  for (const page of bundle.html) {
    for (const item of auditHtml(page.html, env)) {
      failures.push({ file: page.rel, rule: item.rule, message: item.message });
    }
  }
  for (const abs of bundle.css) {
    const text = fs.readFileSync(abs, "utf8");
    for (const item of auditCss(text, path.basename(abs) === "hub.css")) {
      failures.push({ file: relPosix(abs), rule: item.rule, message: item.message });
    }
  }
  if (BANNED.test(env.llms)) failures.push({ file: "llms.txt", rule: "H7", message: "banned wording" });
  if (BANNED.test(env.readme)) failures.push({ file: "README.md", rule: "H7", message: "banned wording" });
  return failures;
}

function pageNames(pages) {
  const names = [];
  for (const page of pages) {
    const name = page.canonicalPath || page.rel;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

export function judge(failedRules, spec) {
  const got = [...failedRules];
  if (!spec) {
    if (got.length === 0) return { ok: false, line: "expect mismatch: unlisted file passed every rule" };
    return { ok: true, line: `expect ok (unlisted, failed ${got.join(", ")})` };
  }
  const mustFail = spec.fail || [];
  const mustPass = spec.pass || [];
  const missing = mustFail.filter((rule) => !failedRules.has(rule));
  const badPass = mustPass.filter((rule) => failedRules.has(rule));
  if (missing.length || badPass.length) {
    const bits = [];
    if (missing.length) bits.push(`did not fail ${missing.join(", ")}`);
    if (badPass.length) bits.push(`failed but must pass ${badPass.join(", ")}`);
    return {
      ok: false,
      line: `expect mismatch: ${bits.join("; ")} (failed ${got.join(", ") || "nothing"})`,
    };
  }
  const passNote = mustPass.length ? `; pass ${mustPass.join(", ")}` : "";
  return { ok: true, line: `expect ok (fail ${mustFail.join(", ")}${passNote})` };
}

function sortFailures(list) {
  return [...list].sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    const order = RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule);
    if (order) return order;
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });
}

function printReport(failures, pages, expectMode, expectMap) {
  const sorted = sortFailures(failures);
  for (const item of sorted) console.log(`${item.file}:${item.rule}:${item.message}`);
  const pageLabel = pages.length ? pages.join(", ") : "none";
  if (!expectMode) {
    if (sorted.length === 0) {
      console.log(`check-hub: OK (pages: ${pageLabel})`);
      process.exit(0);
    }
    console.log(`check-hub: ${sorted.length} failure(s)`);
    process.exit(1);
  }
  let mismatches = 0;
  const byFile = new Map();
  for (const item of sorted) {
    if (!byFile.has(item.file)) byFile.set(item.file, new Set());
    byFile.get(item.file).add(item.rule);
  }
  const listed = new Set(Object.keys(expectMap));
  for (const file of expectMap.__order) {
    const got = byFile.get(file) || new Set();
    const result = judge(got, expectMap[file]);
    console.log(`${file}: ${result.line}`);
    if (!result.ok) mismatches += 1;
  }
  for (const [file, rules] of byFile) {
    if (listed.has(file) || expectMap.__order.includes(file)) continue;
    mismatches += rules.size;
  }
  if (mismatches === 0) {
    console.log(`check-hub: OK (pages: ${pageLabel})`);
    process.exit(0);
  }
  console.log(`check-hub: ${mismatches} failure(s)`);
  process.exit(1);
}

function loadExpect(order) {
  const abs = path.join(ROOT, "tests", "fixtures", "expect.json");
  let data;
  try {
    data = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (err) {
    console.error(`check-hub: cannot read tests/fixtures/expect.json: ${oneLine(err.message)}`);
    process.exit(1);
  }
  data.__order = order;
  return data;
}

function chromeExecutable() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (fs.existsSync("/usr/bin/google-chrome")) return "/usr/bin/google-chrome";
  if (fs.existsSync("/usr/bin/chromium")) return "/usr/bin/chromium";
  return "/usr/bin/google-chrome";
}

async function loadChromium() {
  let mod;
  try {
    mod = await import("playwright-core");
  } catch {
    console.error("check-hub: playwright-core is not installed. Run: npm install --no-save --no-audit --no-fund playwright-core");
    process.exit(1);
  }
  const chromium = mod.chromium || mod.default?.chromium;
  if (!chromium) {
    console.error("check-hub: playwright-core is installed but did not export chromium");
    process.exit(1);
  }
  return chromium;
}

function startServer() {
  const root = path.resolve(ROOT);
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      const abs = path.resolve(root, pathname.replace(/^\/+/, ""));
      if (abs !== root && !abs.startsWith(root + path.sep)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const type = MIME[path.extname(abs).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      fs.createReadStream(abs).pipe(res);
    } catch {
      res.writeHead(400);
      res.end("bad request");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function docPath(requestPath, canon) {
  if (requestPath === canon) return true;
  if (canon.endsWith("/") && requestPath === `${canon}index.html`) return true;
  if (canon.endsWith("/") && `${requestPath}/` === canon) return true;
  return false;
}

async function openDoc(context, origin, target, scheme, reducedMotion, fulfill) {
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  if (fulfill) {
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (docPath(url.pathname, fulfill.path)) {
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: fulfill.html,
        });
        return;
      }
      await route.continue();
    });
  }
  await page.setViewportSize({ width: target.width, height: target.height });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion });
  const pathname = target.path.startsWith("/") ? target.path : `/${target.path}`;
  await page.goto(origin + pathname, { waitUntil: "load" });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  return page;
}

function firstFamily(value) {
  const text = String(value || "").trim();
  if (text.startsWith('"') || text.startsWith("'")) {
    const quote = text[0];
    const end = text.indexOf(quote, 1);
    if (end > 1) return text.slice(1, end);
  }
  const comma = text.indexOf(",");
  return (comma === -1 ? text : text.slice(0, comma)).trim().replace(/^["']|["']$/g, "");
}

function normColor(value) {
  const match = String(value).replace(/\s+/g, "").match(/^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/i);
  if (!match) return String(value).trim();
  if (match[4] !== undefined && Number(match[4]) !== 1) return String(value).replace(/\s+/g, " ").trim();
  return `rgb(${match[1]}, ${match[2]}, ${match[3]})`;
}

async function snap(page) {
  const raw = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const links = [...document.querySelectorAll("a")].map((anchor) => {
      const box = anchor.getBoundingClientRect();
      const style = getComputedStyle(anchor);
      const text = (anchor.innerText || anchor.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      return {
        text: text.slice(0, 60),
        height: box.height,
        width: box.width,
        footer: Boolean(anchor.closest("footer")),
        skip: anchor.classList.contains("skip"),
        hidden: style.display === "none" || style.visibility === "hidden",
      };
    });
    return {
      fontFamily: body.fontFamily,
      backgroundColor: body.backgroundColor,
      color: body.color,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      links,
    };
  });
  return {
    font: firstFamily(raw.fontFamily),
    bg: normColor(raw.backgroundColor),
    color: normColor(raw.color),
    innerWidth: raw.innerWidth,
    scrollWidth: raw.scrollWidth,
    links: raw.links,
  };
}

function b1Problems(measured, scheme, home) {
  const expect = BODY[scheme];
  const problems = [];
  if (measured.font !== FONT) problems.push(`font "${measured.font}"`);
  if (measured.bg !== expect.bg) problems.push(`background ${measured.bg}`);
  if (measured.color !== expect.color) problems.push(`color ${measured.color}`);
  if (home && (measured.font !== home.font || measured.bg !== home.bg || measured.color !== home.color)) {
    problems.push("differs from /");
  }
  return problems;
}

function b3Offenders(snapShot) {
  const narrow = snapShot.innerWidth <= 1024;
  const bad = [];
  for (const link of snapShot.links) {
    if (link.skip || link.hidden || (link.width === 0 && link.height === 0)) continue;
    const tooSmall = narrow ? link.height < 44 : link.footer && link.height < 24;
    if (tooSmall) bad.push(link);
  }
  return bad;
}

function formatHeight(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

async function launchChrome(chromium, executablePath, classicScrollbar) {
  const options = { executablePath, args: ["--no-sandbox"] };
  if (classicScrollbar) options.ignoreDefaultArgs = ["--hide-scrollbars"];
  try {
    return await chromium.launch(options);
  } catch (err) {
    console.error(`check-hub: could not launch Chrome at ${executablePath}: ${oneLine(err.message)}`);
    process.exit(1);
  }
}

async function runB2(chromium, executablePath, origin, pages, failures) {
  const targets = pages.filter((page) => page.canonicalPath);
  if (targets.length === 0) return;
  const browser = await launchChrome(chromium, executablePath, true);
  try {
    const context = await browser.newContext({ deviceScaleFactor: 1 });
    for (const pageRecord of targets) {
      for (const scheme of SCHEMES) {
        for (const view of B2_VIEWS) {
          let page;
          try {
            page = await openDoc(
              context,
              origin,
              { path: pageRecord.canonicalPath, width: view.width, height: view.height },
              scheme,
              "reduce",
              { path: pageRecord.canonicalPath, html: pageRecord.html },
            );
            await page.addStyleTag({ content: CLASSIC_SCROLLBAR_CSS });
            const box = await page.evaluate(() => ({
              scrollWidth: document.documentElement.scrollWidth,
              clientWidth: document.documentElement.clientWidth,
            }));
            const expectedClient = view.width - CLASSIC_SCROLLBAR;
            if (box.clientWidth !== expectedClient) {
              failures.push({
                file: pageRecord.rel,
                rule: "B2",
                message: `classic scrollbar not forced at ${view.width} (${scheme}): clientWidth ${box.clientWidth}, expected ${expectedClient}`,
              });
              continue;
            }
            if (box.scrollWidth > box.clientWidth) {
              failures.push({
                file: pageRecord.rel,
                rule: "B2",
                message: `scrollWidth ${box.scrollWidth} > clientWidth ${box.clientWidth} at ${view.width} (${scheme}, classic scrollbar)`,
              });
            }
          } catch (err) {
            failures.push({
              file: pageRecord.rel,
              rule: "B2",
              message: `browser error at ${view.width} ${scheme}: ${oneLine(err.message)}`,
            });
          } finally {
            if (page) await page.close();
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
}

async function runBrowser(bundle, opts, failures) {
  if (bundle.html.length === 0 && !opts.updateBaselines) return;
  const chromium = await loadChromium();
  const executablePath = chromeExecutable();
  const browser = await launchChrome(chromium, executablePath, false);
  const server = await startServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  const homeCache = new Map();
  try {
    if (opts.updateBaselines) {
      await writeBaselines(context, origin);
      return;
    }
    const measureHome = async (scheme, view) => {
      const key = `${scheme}:${view.width}`;
      if (homeCache.has(key)) return homeCache.get(key);
      const page = await openDoc(
        context,
        origin,
        { path: "/", width: view.width, height: view.height },
        scheme,
        "reduce",
        null,
      );
      try {
        const measured = await snap(page);
        homeCache.set(key, measured);
        return measured;
      } finally {
        await page.close();
      }
    };
    for (const pageRecord of bundle.html) {
      if (!pageRecord.canonicalPath) {
        failures.push({ file: pageRecord.rel, rule: "B1", message: "no canonical URL" });
        continue;
      }
      for (const scheme of SCHEMES) {
        for (const view of VIEWS) {
          let home = null;
          if (pageRecord.canonicalPath !== "/") {
            try {
              home = await measureHome(scheme, view);
            } catch (err) {
              failures.push({
                file: pageRecord.rel,
                rule: "B1",
                message: `could not measure /: ${oneLine(err.message)}`,
              });
            }
          }
          let page;
          try {
            page = await openDoc(
              context,
              origin,
              { path: pageRecord.canonicalPath, width: view.width, height: view.height },
              scheme,
              "reduce",
              { path: pageRecord.canonicalPath, html: pageRecord.html },
            );
            const shot = await snap(page);
            const problems = b1Problems(shot, scheme, home);
            if (problems.length) {
              failures.push({
                file: pageRecord.rel,
                rule: "B1",
                message: `${scheme} ${view.name}: ${problems.join(", ")}`,
              });
            }
            const offenders = b3Offenders(shot);
            if (offenders.length) {
              const shown = offenders.slice(0, 4).map((link) => `"${link.text || "(empty)"}" ${formatHeight(link.height)}px`);
              const more = offenders.length > 4 ? ` (+${offenders.length - 4} more)` : "";
              failures.push({
                file: pageRecord.rel,
                rule: "B3",
                message: `${view.name} ${scheme}: ${shown.join(", ")}${more}`,
              });
            }
          } catch (err) {
            failures.push({
              file: pageRecord.rel,
              rule: "B1",
              message: `browser error at ${view.name} ${scheme}: ${oneLine(err.message)}`,
            });
          } finally {
            if (page) await page.close();
          }
        }
      }
      const spec = opts.expectMap ? opts.expectMap[pageRecord.rel] : null;
      const wantsB4 = opts.expectFail
        ? Boolean(spec && ([...(spec.fail || []), ...(spec.pass || [])].includes("B4")))
        : false;
      if (wantsB4) {
        const target = opts.b4Target || spec.b4Target || "/";
        await runB4(context, origin, {
          file: pageRecord.rel,
          target: normTarget(target),
          html: pageRecord.html,
          canonicalPath: pageRecord.canonicalPath,
        }, failures);
      }
      const wantsB5 = opts.expectFail
        ? Boolean(spec && ([...(spec.fail || []), ...(spec.pass || [])].includes("B5")))
        : false;
      if (wantsB5) {
        const target = normTarget(spec.b5Target || spec.b4Target || pageRecord.canonicalPath || "/");
        const pageKey = b5PageKey(target) || target;
        await runB5(context, origin, {
          file: pageRecord.rel,
          pageKey,
          target: pageKey,
          html: pageRecord.html,
          canonicalPath: pageRecord.canonicalPath,
        }, failures);
      }
    }
    if (!opts.expectFail && bundle.html.length) {
      const target = opts.b4Target || "/";
      await runB4(context, origin, {
        file: target === "/" ? "index.html" : target,
        target,
        html: null,
        canonicalPath: null,
      }, failures);
    }
    if (!opts.expectFail) {
      for (const pageRecord of bundle.html) {
        if (pageRecord.rel.startsWith("tests/")) continue;
        const pageKey = b5PageKey(pageRecord.canonicalPath);
        if (!pageKey) continue;
        await runB5(context, origin, {
          file: pageRecord.rel,
          pageKey,
          target: pageKey,
          html: null,
          canonicalPath: pageRecord.canonicalPath,
        }, failures);
      }
    }
    await runB2(chromium, executablePath, origin, bundle.html, failures);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

function b5PageKey(pathname) {
  if (pathname === "/videos") return "/videos/";
  if (pathname === "/" || pathname === "/videos/") return pathname;
  return null;
}

function b5Selectors(pageKey) {
  return B5_COMMON.concat(B5_PAGE[pageKey] || []);
}

function b5Fulfill(job) {
  if (!job.html) return null;
  if (job.canonicalPath !== job.target && b5PageKey(job.canonicalPath) !== job.pageKey) return null;
  return { path: job.target, html: job.html };
}

function readStylesInPage({ selectors, props }) {
  function roundPx(value) {
    return String(value).trim().replace(/-?\d*\.?\d+(?:e[+-]?\d+)?px/gi, (raw) => {
      const n = Number(raw.slice(0, -2));
      if (!Number.isFinite(n)) return raw;
      let text = n.toFixed(2);
      if (text === "-0.00") text = "0.00";
      return `${text}px`;
    });
  }

  const names = new Set();
  const takeRoot = (style) => {
    for (let i = 0; i < style.length; i++) {
      const name = style.item(i);
      if (name.startsWith("--")) names.add(name);
    }
  };
  const harvest = (rules) => {
    if (!rules) return;
    for (const rule of rules) {
      if (rule.type === CSSRule.IMPORT_RULE) {
        try {
          if (rule.styleSheet) harvest(rule.styleSheet.cssRules);
        } catch {
          continue;
        }
        continue;
      }
      if (rule.type === CSSRule.MEDIA_RULE) {
        const text = rule.conditionText || (rule.media && rule.media.mediaText) || "";
        if (/prefers-color-scheme/i.test(text)) harvest(rule.cssRules);
        continue;
      }
      if (rule.type !== CSSRule.STYLE_RULE) continue;
      const parts = String(rule.selectorText || "").split(",").map((part) => part.trim());
      if (!parts.includes(":root")) continue;
      takeRoot(rule.style);
    }
  };

  for (const sheet of document.styleSheets) {
    if (sheet.disabled) continue;
    try {
      if (sheet.href) {
        const url = new URL(sheet.href, location.href);
        if (url.origin !== location.origin) continue;
      }
      harvest(sheet.cssRules);
    } catch {
      continue;
    }
  }

  const rootStyle = getComputedStyle(document.documentElement);
  const tokens = {};
  for (const name of [...names].sort()) tokens[name] = roundPx(rootStyle.getPropertyValue(name));

  const picked = {};
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (!el) {
      picked[selector] = { absent: true };
      continue;
    }
    const style = getComputedStyle(el);
    const record = {};
    for (const prop of props) record[prop] = roundPx(style.getPropertyValue(prop));
    picked[selector] = record;
  }
  return { tokens, selectors: picked };
}

function showValue(value) {
  return value === undefined ? "missing" : JSON.stringify(value);
}

function diffSelector(name, base, actual) {
  const baseAbsent = !base || base.absent === true;
  const actualAbsent = !actual || actual.absent === true;
  if (baseAbsent || actualAbsent) {
    if (baseAbsent && actualAbsent) return [];
    return [`${name} baseline ${baseAbsent ? "absent" : "present"} actual ${actualAbsent ? "absent" : "present"}`];
  }
  const props = [];
  const seen = new Set();
  for (const prop of [...B5_PROPS, ...Object.keys(base), ...Object.keys(actual)]) {
    if (prop === "absent" || seen.has(prop)) continue;
    seen.add(prop);
    props.push(prop);
  }
  const diffs = [];
  for (const prop of props) {
    if (base[prop] !== actual[prop]) {
      diffs.push(`${name} ${prop} baseline ${showValue(base[prop])} actual ${showValue(actual[prop])}`);
    }
  }
  return diffs;
}

function diffComputed(pageKey, base, actual) {
  const diffs = [];
  const baseTokens = base.tokens || {};
  const actualTokens = actual.tokens || {};
  const tokenNames = new Set([...Object.keys(baseTokens), ...Object.keys(actualTokens)]);
  for (const name of [...tokenNames].sort()) {
    if (baseTokens[name] !== actualTokens[name]) {
      diffs.push(`${name} baseline ${showValue(baseTokens[name])} actual ${showValue(actualTokens[name])}`);
    }
  }
  const baseSels = base.selectors || {};
  const actualSels = actual.selectors || {};
  const seen = new Set();
  const selNames = [];
  for (const name of [...b5Selectors(pageKey), ...Object.keys(baseSels), ...Object.keys(actualSels)]) {
    if (seen.has(name)) continue;
    seen.add(name);
    selNames.push(name);
  }
  for (const name of selNames) diffs.push(...diffSelector(name, baseSels[name], actualSels[name]));
  return diffs;
}

function formatB5(pageKey, view, scheme, diffs) {
  const shown = diffs.slice(0, 8);
  const extra = diffs.length - shown.length;
  const more = extra > 0 ? ` (+${extra} more)` : "";
  return `${pageKey} ${view} ${scheme}: ${shown.join(", ")}${more}`;
}

async function measureComputed(context, origin, job, view, scheme) {
  const page = await openDoc(
    context,
    origin,
    { path: job.target, width: view.width, height: view.height },
    scheme,
    "reduce",
    b5Fulfill(job),
  );
  try {
    return await page.evaluate(readStylesInPage, {
      selectors: b5Selectors(job.pageKey),
      props: B5_PROPS,
    });
  } finally {
    await page.close();
  }
}

async function runB5(context, origin, job, failures) {
  if (!fs.existsSync(COMPUTED_BASELINE)) {
    failures.push({
      file: job.file,
      rule: "B5",
      message: "missing baseline tests/baselines/computed-styles.json; run node scripts/check-hub.mjs --update-baselines",
    });
    return;
  }
  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(COMPUTED_BASELINE, "utf8"));
  } catch (err) {
    failures.push({
      file: job.file,
      rule: "B5",
      message: `cannot read tests/baselines/computed-styles.json: ${oneLine(err.message)}`,
    });
    return;
  }
  const pageBase = baseline && typeof baseline === "object" ? baseline[job.pageKey] : null;
  if (!pageBase || typeof pageBase !== "object") {
    failures.push({
      file: job.file,
      rule: "B5",
      message: `${job.pageKey}: missing from tests/baselines/computed-styles.json; run node scripts/check-hub.mjs --update-baselines`,
    });
    return;
  }
  for (const view of VIEWS) {
    for (const scheme of SCHEMES) {
      let actual;
      try {
        actual = await measureComputed(context, origin, job, view, scheme);
      } catch (err) {
        failures.push({
          file: job.file,
          rule: "B5",
          message: `${job.pageKey} ${view.name} ${scheme}: ${oneLine(err.message)}`,
        });
        continue;
      }
      const cell = pageBase[view.name] && pageBase[view.name][scheme];
      if (!cell || typeof cell !== "object") {
        failures.push({
          file: job.file,
          rule: "B5",
          message: `${job.pageKey} ${view.name} ${scheme}: missing from tests/baselines/computed-styles.json; run node scripts/check-hub.mjs --update-baselines`,
        });
        continue;
      }
      const diffs = diffComputed(job.pageKey, cell, actual);
      if (diffs.length) {
        failures.push({
          file: job.file,
          rule: "B5",
          message: formatB5(job.pageKey, view.name, scheme, diffs),
        });
      }
    }
  }
}

async function writeBaselines(context, origin) {
  const dir = path.join(ROOT, "tests", "baselines");
  fs.mkdirSync(dir, { recursive: true });
  for (const scheme of SCHEMES) {
    for (const view of VIEWS) {
      const page = await openDoc(
        context,
        origin,
        { path: "/", width: view.width, height: view.height },
        scheme,
        "no-preference",
        null,
      );
      try {
        await page.addStyleTag({ content: FREEZE });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const name = `home-${view.name}-${scheme}.png`;
        await page.screenshot({ path: path.join(dir, name), fullPage: true });
        console.log(`check-hub: wrote tests/baselines/${name}`);
      } finally {
        await page.close();
      }
    }
  }
  const styles = {};
  for (const spec of B5_PAGES) {
    const job = {
      file: spec.file,
      pageKey: spec.key,
      target: spec.key,
      html: null,
      canonicalPath: spec.key,
    };
    styles[spec.key] = {};
    for (const view of VIEWS) {
      styles[spec.key][view.name] = {};
      for (const scheme of SCHEMES) {
        styles[spec.key][view.name][scheme] = await measureComputed(context, origin, job, view, scheme);
      }
    }
  }
  fs.writeFileSync(COMPUTED_BASELINE, `${JSON.stringify(styles, null, 2)}\n`);
  console.log("check-hub: wrote tests/baselines/computed-styles.json");
}

function writeOut(name, buffer) {
  const dir = path.join(ROOT, "tests", "_out");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), buffer);
}

async function runB4(context, origin, job, failures) {
  for (const scheme of SCHEMES) {
    for (const view of VIEWS) {
      const name = `home-${view.name}-${scheme}.png`;
      const fulfill = job.html && job.canonicalPath === job.target
        ? { path: job.canonicalPath, html: job.html }
        : null;
      let page;
      try {
        page = await openDoc(
          context,
          origin,
          { path: job.target, width: view.width, height: view.height },
          scheme,
          "no-preference",
          fulfill,
        );
        await page.addStyleTag({ content: FREEZE });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const actual = await page.screenshot({ fullPage: true });
        const baseline = path.join(ROOT, "tests", "baselines", name);
        if (!fs.existsSync(baseline)) {
          writeOut(name, actual);
          failures.push({
            file: job.file,
            rule: "B4",
            message: `missing baseline tests/baselines/${name}; run node scripts/check-hub.mjs --update-baselines`,
          });
          continue;
        }
        const expected = fs.readFileSync(baseline);
        const result = await page.evaluate(async ({ actualB64, expectedB64 }) => {
          async function bitmap(b64) {
            const response = await fetch(`data:image/png;base64,${b64}`);
            return createImageBitmap(await response.blob());
          }
          const left = await bitmap(actualB64);
          const right = await bitmap(expectedB64);
          if (left.width !== right.width || left.height !== right.height) {
            return { size: true, aw: left.width, ah: left.height, bw: right.width, bh: right.height };
          }
          const canvas = document.createElement("canvas");
          canvas.width = left.width;
          canvas.height = left.height;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(left, 0, 0);
          const leftData = ctx.getImageData(0, 0, left.width, left.height).data;
          ctx.clearRect(0, 0, left.width, left.height);
          ctx.drawImage(right, 0, 0);
          const rightData = ctx.getImageData(0, 0, right.width, right.height).data;
          // 8x8 area averages ignore cross-machine text anti-aliasing on glyph edges.
          const blockSize = 8;
          const cols = Math.ceil(left.width / blockSize);
          const rows = Math.ceil(left.height / blockSize);
          let diff = 0;
          const total = cols * rows;
          for (let row = 0; row < rows; row++) {
            const y0 = row * blockSize;
            const y1 = Math.min(y0 + blockSize, left.height);
            for (let col = 0; col < cols; col++) {
              const x0 = col * blockSize;
              const x1 = Math.min(x0 + blockSize, left.width);
              let leftR = 0;
              let leftG = 0;
              let leftB = 0;
              let rightR = 0;
              let rightG = 0;
              let rightB = 0;
              const count = (x1 - x0) * (y1 - y0);
              for (let y = y0; y < y1; y++) {
                let offset = (y * left.width + x0) * 4;
                for (let x = x0; x < x1; x++) {
                  leftR += leftData[offset];
                  leftG += leftData[offset + 1];
                  leftB += leftData[offset + 2];
                  rightR += rightData[offset];
                  rightG += rightData[offset + 1];
                  rightB += rightData[offset + 2];
                  offset += 4;
                }
              }
              if (
                Math.abs(leftR / count - rightR / count) > 16 ||
                Math.abs(leftG / count - rightG / count) > 16 ||
                Math.abs(leftB / count - rightB / count) > 16
              ) diff += 1;
            }
          }
          return { size: false, diff, total };
        }, { actualB64: actual.toString("base64"), expectedB64: expected.toString("base64") });
        if (result.size) {
          writeOut(name, actual);
          failures.push({
            file: job.file,
            rule: "B4",
            message: `${name} size ${result.aw}x${result.ah} != baseline ${result.bw}x${result.bh}`,
          });
        } else if (result.total > 0 && result.diff / result.total > 0.001) {
          writeOut(name, actual);
          const pct = ((result.diff / result.total) * 100).toFixed(3);
          failures.push({
            file: job.file,
            rule: "B4",
            message: `${name} differs by ${pct}% of blocks (limit 0.1%)`,
          });
        }
      } catch (err) {
        failures.push({
          file: job.file,
          rule: "B4",
          message: `${name}: ${oneLine(err.message)}`,
        });
      } finally {
        if (page) await page.close();
      }
    }
  }
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.updateBaselines) {
    await runBrowser({ html: [] }, { ...opts, updateBaselines: true }, []);
    return;
  }
  if (opts.expectFail && opts.files.length === 0) {
    console.error("check-hub: --expect-fail needs files");
    process.exit(2);
  }
  const bundle = collect(opts);
  const env = loadEnv();
  const failures = opts.runStatic ? staticFailures(bundle, env) : [];
  if (opts.expectFail) {
    opts.expectMap = loadExpect(bundle.html.map((page) => page.rel).concat(bundle.css.map(relPosix)));
  }
  if (opts.runBrowser) await runBrowser(bundle, opts, failures);
  printReport(failures, pageNames(bundle.html), opts.expectFail, opts.expectMap || { __order: [] });
}

if (invokedDirectly()) {
  main().catch((err) => {
    console.error(`check-hub: ${err.stack || err.message}`);
    process.exit(1);
  });
}
