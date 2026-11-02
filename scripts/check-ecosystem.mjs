import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BANNED = /open[\s-]source/i;
const TAG = "FREE · source-available";
const SHIELD_PHRASE = "source-available (PolyForm Shield";
const MCP_LOGO = "assets/logos/mcp-bridge-go.webp";
const GITHUB_ONLY = new Set([2, 11, 13, 18]);
const GROUPS = [
  { id: "tools", size: 10 },
  { id: "free-tools", size: 4 },
  { id: "built-with", size: 4 },
];
const SITEMAP_PAGE_N = [1, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 15, 16];
const SITEMAP_EXISTING = [
  "https://jangtrinh.github.io/",
  "https://jangtrinh.github.io/design-os-studio/",
  "https://jangtrinh.github.io/design-os/",
  "https://jangtrinh.github.io/design-os-figma-plugin/",
  "https://jangtrinh.github.io/design-os-svg-animation/",
  "https://jangtrinh.github.io/design-os-code2flow/",
  "https://jangtrinh.github.io/design-os-3d-blender/",
  "https://jangtrinh.github.io/videos/",
];
const NAV = [
  { href: "/#products", text: "Products" },
  { href: "/videos/", text: "Videos" },
  { href: "/#ecosystem", text: "Ecosystem" },
];

const failures = [];

function fail(ac, message) {
  failures.push(`${ac}: ${message}`);
}

function oneLine(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function linesOf(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function textOf(html) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
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

function classSet(attrs) {
  return new Set(String(attrs.class || "").split(/\s+/).filter(Boolean));
}

function readText(rel, ac) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    fail(ac, `cannot read ${rel}`);
    return null;
  }
}

function readJson(rel, ac) {
  const text = readText(rel, ac);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    fail(ac, `${rel} is not JSON`);
    return null;
  }
}

function sectionInner(html, id) {
  const open = new RegExp(`<section\\b[^>]*\\bid=["']${id}["'][^>]*>`, "i");
  const match = open.exec(html);
  if (!match) return null;
  const start = match.index + match[0].length;
  const re = /<\/?section\b[^>]*>/gi;
  re.lastIndex = start;
  let depth = 1;
  let found;
  while ((found = re.exec(html))) {
    depth += found[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, found.index);
  }
  return null;
}

function listsByClass(html, className) {
  const out = [];
  const re = /<ul\b([^>]*)>([\s\S]*?)<\/ul>/gi;
  let match;
  while ((match = re.exec(html))) {
    const attrs = tagAttrs(`<ul ${match[1]}>`);
    if (classSet(attrs).has(className)) out.push(match[2]);
  }
  return out;
}

function itemsOf(html) {
  return [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => match[1]);
}

function headingText(li) {
  const match = li.match(/<h([24])\b[^>]*>([\s\S]*?)<\/h\1>/i);
  return match ? textOf(match[2]) : "";
}

function paragraphs(li) {
  return [...li.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => textOf(match[1]));
}

function anchorsIn(html) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    const attrs = tagAttrs(`<a ${match[1]}>`);
    out.push({ href: attrs.href || "", text: textOf(match[2]) });
  }
  return out;
}

function linksHtml(li) {
  const re = /<div\b([^>]*)>([\s\S]*?)<\/div>/gi;
  let match;
  while ((match = re.exec(li))) {
    const attrs = tagAttrs(`<div ${match[1]}>`);
    if (classSet(attrs).has("links")) return match[2];
  }
  return "";
}

function tagText(li) {
  const re = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;
  let match;
  while ((match = re.exec(li))) {
    const attrs = tagAttrs(`<span ${match[1]}>`);
    if (classSet(attrs).has("eco-tag")) return textOf(match[2]);
  }
  return null;
}

function repoFromHref(href) {
  const match = /^https:\/\/github\.com\/jangtrinh\/([^/?#]+)$/.exec(href || "");
  return match ? match[1] : null;
}

function parseRow(li) {
  const links = anchorsIn(linksHtml(li));
  const repo = links.map((link) => repoFromHref(link.href)).find(Boolean) || null;
  return {
    name: headingText(li),
    paragraphs: paragraphs(li),
    links,
    imgs: [...li.matchAll(/<img\b[^>]*>/gi)].map((match) => tagAttrs(match[0])),
    repo,
    tag: tagText(li),
  };
}

function rowsIn(html, className) {
  if (html == null) return [];
  return listsByClass(html, className).map((list) => itemsOf(list).map(parseRow));
}

function groupOf(n) {
  if (n <= 10) return "tools";
  if (n <= 14) return "free-tools";
  return "built-with";
}

function descriptionOf(row) {
  return row.paragraphs.length === 1 ? row.paragraphs[0] : row.paragraphs.join(" ");
}

function isDesignOsName(name) {
  return name === "design-os" || name.startsWith("design-os-");
}

function logoSrcOk(src) {
  return typeof src === "string" && src.startsWith("assets/logos/") && !src.includes("..") && !src.includes("\\");
}

function logoFile(src) {
  if (!logoSrcOk(src)) return null;
  const abs = path.resolve(ROOT, src);
  const flat = path.join(path.resolve(ROOT, "assets/logos"), path.basename(abs));
  return abs === flat ? abs : null;
}

function expectedFlagshipLogo(row) {
  return row && row.name === "mcp-bridge-go" ? MCP_LOGO : row && row.logo;
}

function metaDescription(html) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attrs = tagAttrs(tag);
    if ((attrs.name || "").toLowerCase() === "description") return attrs.content ?? "";
  }
  return null;
}

function jsonLdTexts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    const attrs = tagAttrs(`<script ${match[1]}>`);
    if ((attrs.type || "").toLowerCase() === "application/ld+json") out.push(match[2]);
  }
  return out;
}

function softwareApps(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) softwareApps(item, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  const type = node["@type"];
  const types = Array.isArray(type) ? type : type == null ? [] : [type];
  if (types.includes("SoftwareApplication")) out.push(node);
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") softwareApps(value, out);
  }
  return out;
}

function markdownSection(text, heading) {
  const lines = linesOf(text);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break;
    body.push(lines[i]);
  }
  return body;
}

function markedHeader(html, rel) {
  const startMark = "<!-- hub:header -->";
  const endMark = "<!-- /hub:header -->";
  const start = html.indexOf(startMark);
  const end = html.indexOf(endMark);
  if (start < 0 || end < start) {
    fail("AC-E12", `${rel} missing header block`);
    return null;
  }
  return html.slice(start + startMark.length, end);
}

function checkNav(headerHtml, rel) {
  if (headerHtml == null) return;
  const nav = headerHtml.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i);
  if (!nav) {
    fail("AC-E12", `${rel} missing nav`);
    return;
  }
  const links = anchorsIn(nav[1]);
  if (links.length !== NAV.length) {
    fail("AC-E12", `${rel} nav has ${links.length} links, expected ${NAV.length}`);
  }
  const count = Math.min(links.length, NAV.length);
  for (let i = 0; i < count; i++) {
    if (links[i].text !== NAV[i].text || links[i].href !== NAV[i].href) {
      fail("AC-E12", `${rel} nav link ${i + 1} is "${links[i].text}" ${links[i].href}, expected "${NAV[i].text}" ${NAV[i].href}`);
    }
  }
}

function checkCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length !== 18) {
    fail("AC-E1", `tests/ecosystem.json has ${Array.isArray(catalog) ? catalog.length : "no"} rows, expected 18`);
    return false;
  }
  catalog.forEach((entry, index) => {
    const n = index + 1;
    const group = groupOf(n);
    const logo = entry && `assets/logos/${entry.repo}.webp`;
    if (!entry || entry.n !== n) fail("AC-E1", `tests/ecosystem.json entry ${index} n is ${entry && entry.n}, expected ${n}`);
    if (!entry || entry.group !== group) fail("AC-E1", `row ${n} group is ${entry && entry.group}, expected ${group}`);
    if (!entry || typeof entry.name !== "string" || entry.name === "") fail("AC-E1", `row ${n} missing name`);
    if (!entry || typeof entry.repo !== "string" || !entry.repo) fail("AC-E1", `row ${n} missing repo`);
    if (!entry || entry.logo !== logo) fail("AC-E8", `row ${n} logo is ${entry && entry.logo}, expected ${logo}`);
    const githubOnly = GITHUB_ONLY.has(n);
    if (!entry || (entry.docs == null) !== githubOnly) {
      fail("AC-E2", `row ${n} docs ${entry && entry.docs == null ? "empty" : "set"}, expected ${githubOnly ? "empty" : "a URL"}`);
    }
    if (entry && entry.docs != null && typeof entry.docs !== "string") fail("AC-E2", `row ${n} docs is not a URL`);
  });
  const docsCount = catalog.filter((entry) => entry && typeof entry.docs === "string").length;
  if (docsCount !== 14) fail("AC-E2", `${docsCount} Docs URLs in tests/ecosystem.json, expected 14`);
  return true;
}

function checkExclusions(exclusions) {
  if (exclusions == null) return [];
  if (!Array.isArray(exclusions)) {
    fail("AC-E1", "tests/ecosystem-exclusions.json is not an array");
    return [];
  }
  for (const entry of exclusions) {
    const repo = entry && entry.repo;
    const reason = entry && entry.reason;
    if (typeof repo !== "string" || repo === "") {
      fail("AC-E1", "exclusion entry missing repo");
      continue;
    }
    if (typeof reason !== "string" || reason.trim() === "") fail("AC-E1", `exclusion ${repo} has no reason`);
  }
  return exclusions;
}

function checkPageList(groups, catalog) {
  if (groups.length !== GROUPS.length) fail("AC-E1", `#ecosystem has ${groups.length} groups, expected ${GROUPS.length}`);
  const flat = [];
  GROUPS.forEach((group, index) => {
    const rows = groups[index] || [];
    if (rows.length !== group.size) fail("AC-E1", `group ${group.id} has ${rows.length} rows, expected ${group.size}`);
    flat.push(...rows);
  });
  for (let index = GROUPS.length; index < groups.length; index++) flat.push(...groups[index]);
  if (flat.length !== 18) fail("AC-E1", `#ecosystem has ${flat.length} rows, expected 18`);
  const count = Math.min(flat.length, catalog.length);
  for (let index = 0; index < count; index++) {
    const row = flat[index];
    const expected = catalog[index];
    if (!expected) continue;
    if (row.repo !== expected.repo || row.name !== expected.name) {
      fail("AC-E1", `row ${expected.n} is ${row.repo || "?"} "${row.name}", expected ${expected.repo} "${expected.name}"`);
    }
  }
  return flat;
}

function checkRowContent(flat, catalog) {
  const count = Math.min(flat.length, catalog.length);
  for (let index = 0; index < count; index++) {
    const row = flat[index];
    const expected = catalog[index];
    if (!expected || typeof expected.repo !== "string") continue;
    if (row.paragraphs.length !== 1) {
      fail("AC-E2", `row ${expected.n} has ${row.paragraphs.length} description paragraphs, expected 1`);
    }
    if (row.tag !== TAG) {
      fail("AC-E2", `row ${expected.n} tag is ${row.tag == null ? "missing" : `"${row.tag}"`}, expected "${TAG}"`);
    }
    const github = `https://github.com/jangtrinh/${expected.repo}`;
    const expectedHrefs = expected.docs ? [github, expected.docs] : [github];
    const hrefs = row.links.map((link) => link.href);
    const same = hrefs.length === expectedHrefs.length && hrefs.every((href, linkIndex) => href === expectedHrefs[linkIndex]);
    if (!same) fail("AC-E2", `row ${expected.n} links ${hrefs.join(" ") || "none"}, expected ${expectedHrefs.join(" ")}`);
    if (expected.docs == null && row.links.some((link) => link.text === "Docs")) {
      fail("AC-E2", `row ${expected.n} has a Docs link`);
    }
  }
}

function checkWording(sectionHtml, jsonLd, llmsEco, meta) {
  const parts = [
    ["section", sectionHtml],
    ["JSON-LD", jsonLd],
    ["llms.txt Ecosystem", llmsEco],
    ["meta description", meta],
  ];
  let joined = "";
  for (const [label, text] of parts) {
    if (text == null) {
      fail("AC-E3", `missing ${label}`);
      continue;
    }
    if (BANNED.test(text)) fail("AC-E3", `${label} matches /open[\\s-]source/i`);
    joined += `\n${text}`;
  }
  if (sectionHtml != null && !sectionHtml.includes("FREE")) fail("AC-E3", 'section missing "FREE"');
  if (sectionHtml != null && !sectionHtml.includes(SHIELD_PHRASE)) fail("AC-E3", `section missing "${SHIELD_PHRASE}"`);
  if (!joined.includes("FREE")) fail("AC-E3", 'missing "FREE"');
  if (!joined.includes(SHIELD_PHRASE)) fail("AC-E3", `missing "${SHIELD_PHRASE}"`);
}

function checkJsonLd(blocks) {
  if (!blocks || blocks.length === 0) {
    fail("AC-E7", "home JSON-LD missing");
    return;
  }
  const apps = [];
  for (const block of blocks) {
    try {
      apps.push(...softwareApps(JSON.parse(block)));
    } catch {
      fail("AC-E7", "home JSON-LD does not parse");
      return;
    }
  }
  if (apps.length !== 25) fail("AC-E7", `${apps.length} SoftwareApplication nodes, expected 25`);
  for (const app of apps) {
    if (app.isAccessibleForFree !== true) {
      fail("AC-E7", `${app.name || "SoftwareApplication"} isAccessibleForFree is not true`);
    }
  }
}

function checkLlmsCounts(llms) {
  if (llms == null) return;
  for (const [heading, expected] of [["## Products", 7], ["## Ecosystem", 18]]) {
    const body = markdownSection(llms, heading);
    if (!body) {
      fail("AC-E7", `llms.txt missing ${heading}`);
      continue;
    }
    const count = body.filter((line) => line.startsWith("- ")).length;
    if (count !== expected) fail("AC-E7", `llms.txt ${heading} has ${count} lines, expected ${expected}`);
  }
}

function checkImg(row, expectedSrc, label) {
  const imgs = row.imgs;
  if (imgs.length !== 1) fail("AC-E8", `${label} has ${imgs.length} img, expected 1`);
  for (const img of imgs) {
    if (!logoSrcOk(img.src || "")) fail("AC-E8", `${label} img src outside assets/logos/`);
  }
  if (imgs.length !== 1) return;
  const img = imgs[0];
  if (img.src !== expectedSrc) fail("AC-E8", `${label} img src ${img.src || "missing"}, expected ${expectedSrc}`);
  if (img.alt !== "") fail("AC-E8", `${label} img alt is ${img.alt == null ? "missing" : `"${img.alt}"`}`);
  const width = img.width || "";
  const height = img.height || "";
  if (!/^\d+$/.test(width) || !/^\d+$/.test(height) || Number(width) !== Number(height) || Number(width) === 0) {
    fail("AC-E8", `${label} img width ${width || "missing"} height ${height || "missing"}`);
  }
  const file = logoFile(img.src || "");
  if (!file || !fs.existsSync(file)) fail("AC-E8", `${label} logo file missing ${img.src || ""}`);
}

function checkMarks(flagshipLive, flagshipSnapshot, ecoLive, catalog, sources) {
  if (flagshipLive && flagshipSnapshot) {
    const count = Math.min(flagshipLive.length, flagshipSnapshot.length);
    for (let index = 0; index < count; index++) {
      const expected = expectedFlagshipLogo(flagshipSnapshot[index]);
      checkImg(flagshipLive[index], expected, flagshipSnapshot[index].name || `flagship ${index + 1}`);
    }
  }
  if (ecoLive && catalog) {
    const count = Math.min(ecoLive.length, catalog.length);
    for (let index = 0; index < count; index++) {
      const entry = catalog[index];
      if (!entry || typeof entry.repo !== "string") continue;
      checkImg(ecoLive[index], `assets/logos/${entry.repo}.webp`, `row ${entry.n}`);
    }
  }
  if (sources == null || !catalog) return;
  const names = catalog.filter((entry) => entry && entry.repo).map((entry) => `${entry.repo}.webp`);
  names.push("mcp-bridge-go.webp");
  const sourceLines = linesOf(sources);
  for (const fileName of names) {
    if (!sourceLines.some((line) => line.includes(fileName))) fail("AC-E8", `SOURCES.txt does not mention ${fileName}`);
  }
}

function checkEmptyMarks(productsHtml, ecosystemHtml) {
  if (productsHtml != null && productsHtml.includes("mark-empty")) fail("AC-E8", "#products contains mark-empty");
  if (ecosystemHtml != null && ecosystemHtml.includes("mark-empty")) fail("AC-E8", "#ecosystem contains mark-empty");
}

function checkLicenseMention(files) {
  const needle = "product-os-spec-driven";
  const license = "PolyForm Noncommercial License 1.0.0";
  for (const [rel, text] of files) {
    if (text == null) continue;
    linesOf(text).forEach((line, index) => {
      if (!line.includes(needle)) return;
      if (!line.includes(license) || line.includes("FREE")) {
        fail("AC-E9", `${rel}:${index + 1} names ${needle}`);
      }
    });
  }
}

function sameLinks(live, expected) {
  if (!Array.isArray(expected) || live.length !== expected.length) return false;
  return live.every((link, index) => link.href === expected[index].href && link.text === expected[index].text);
}

function checkFlagship(liveRows, snapshot) {
  if (snapshot == null) return;
  if (!Array.isArray(snapshot) || snapshot.length !== 7) {
    fail("AC-E10", "tests/flagship.json must list 7 rows");
    return;
  }
  const mcp = snapshot.find((row) => row && row.name === "mcp-bridge-go");
  if (!mcp || mcp.logo !== null) fail("AC-E10", "tests/flagship.json keeps mcp-bridge-go logo null");
  if (!liveRows) return;
  if (liveRows.length !== 7) fail("AC-E10", `#products has ${liveRows.length} rows, expected 7`);
  const count = Math.min(liveRows.length, snapshot.length);
  for (let index = 0; index < count; index++) {
    const live = liveRows[index];
    const expected = snapshot[index];
    if (!expected) continue;
    const label = expected.name || `row ${index + 1}`;
    if (live.name !== expected.name) fail("AC-E10", `flagship row ${index + 1} name is "${live.name}", expected "${expected.name}"`);
    if (descriptionOf(live) !== expected.description) fail("AC-E10", `${label} description differs`);
    if (!sameLinks(live.links, expected.links)) fail("AC-E10", `${label} links differ`);
    const logo = live.imgs.length === 1 ? live.imgs[0].src : null;
    const expectedLogo = expectedFlagshipLogo(expected);
    if (logo !== expectedLogo) fail("AC-E10", `${label} logo ${logo}, expected ${expectedLogo}`);
  }
}

function checkSitemap(xml, catalog) {
  if (xml == null || !catalog) return;
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => match[1]);
  const expected = new Set(SITEMAP_EXISTING);
  for (const n of SITEMAP_PAGE_N) {
    const entry = catalog.find((item) => item && item.n === n);
    if (!entry || typeof entry.docs !== "string") {
      fail("sitemap", `row ${n} has no Pages URL`);
      continue;
    }
    expected.add(entry.docs);
  }
  if (expected.size !== 21) fail("sitemap", `expected set has ${expected.size} URLs, expected 21`);
  const seen = new Set();
  const dupes = [];
  for (const loc of locs) {
    if (seen.has(loc)) dupes.push(loc);
    seen.add(loc);
  }
  if (dupes.length) fail("sitemap", `duplicate ${dupes.join(", ")}`);
  for (const loc of expected) if (!seen.has(loc)) fail("sitemap", `missing ${loc}`);
  for (const loc of seen) if (!expected.has(loc)) fail("sitemap", `unexpected ${loc}`);
}

function jqString(text) {
  const trimmed = String(text).trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function gh(args) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    throw new Error(oneLine(err.stderr || err.message));
  }
}

function checkLicenseGate(catalog) {
  for (const entry of catalog) {
    if (!entry || typeof entry.repo !== "string") continue;
    let visibility;
    try {
      visibility = jqString(gh(["repo", "view", `jangtrinh/${entry.repo}`, "--json", "visibility", "-q", ".visibility"]));
    } catch (err) {
      fail("AC-E11", `${entry.repo} visibility ${err.message}`);
      continue;
    }
    if (visibility !== "PUBLIC") fail("AC-E11", `${entry.repo} visibility ${visibility}, expected PUBLIC`);
    let license;
    try {
      license = gh(["api", `repos/jangtrinh/${entry.repo}/contents/LICENSE`, "-H", "Accept: application/vnd.github.raw"]);
    } catch (err) {
      fail("AC-E11", `${entry.repo} LICENSE ${err.message}`);
      continue;
    }
    if (!license.includes("PolyForm Shield License 1.0.0")) {
      fail("AC-E11", `${entry.repo} LICENSE missing PolyForm Shield License 1.0.0`);
    }
  }
}

function checkPublicDesignOs(names, pageRepos, exclusions) {
  const excluded = new Set(exclusions.filter((entry) => entry && typeof entry.repo === "string").map((entry) => entry.repo));
  for (const name of names) {
    if (!isDesignOsName(name)) continue;
    if (pageRepos.has(name) || excluded.has(name)) continue;
    fail("AC-E1", `public repo ${name} is not on the page or in tests/ecosystem-exclusions.json`);
  }
}

async function checkLiveLinks(rows) {
  const urls = [];
  const seen = new Set();
  for (const row of rows) {
    for (const link of row.links) {
      if (!link.href || link.href === "/videos/" || seen.has(link.href)) continue;
      seen.add(link.href);
      urls.push(link.href);
    }
  }
  const results = await Promise.all(urls.map(async (url) => {
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      });
      await response.arrayBuffer();
      return response.status === 200 ? null : `${url} status ${response.status}`;
    } catch (err) {
      return `${url} ${oneLine(err.message)}`;
    }
  }));
  for (const message of results) if (message) fail("AC-E2", message);
}

async function runOnline(catalog, exclusions, ecoRows, flagshipRows) {
  if (catalog) checkLicenseGate(catalog);
  let names = [];
  try {
    names = gh(["repo", "list", "jangtrinh", "--visibility", "public", "--limit", "300", "--json", "name", "-q", ".[].name"])
      .split(/\n/)
      .map((line) => jqString(line))
      .filter(Boolean);
  } catch (err) {
    fail("AC-E1", `gh repo list ${err.message}`);
  }
  const pageRepos = new Set();
  for (const row of [...(flagshipRows || []), ...(ecoRows || [])]) if (row.repo) pageRepos.add(row.repo);
  checkPublicDesignOs(names, pageRepos, exclusions || []);
  if (ecoRows) await checkLiveLinks(ecoRows);
}

function parseArgs(argv) {
  let online = false;
  for (const arg of argv) {
    if (arg === "--online") online = true;
    else {
      console.log(`check-ecosystem: unknown argument ${arg}`);
      process.exit(1);
    }
  }
  return online;
}

function report() {
  for (const line of failures) console.log(line);
  if (failures.length === 0) {
    console.log("check-ecosystem: OK");
    process.exit(0);
  }
  console.log(`check-ecosystem: ${failures.length} failure(s)`);
  process.exit(1);
}

async function main() {
  const online = parseArgs(process.argv.slice(2));
  const indexHtml = readText("index.html", "AC-E1");
  const llms = readText("llms.txt", "AC-E7");
  const sitemap = readText("sitemap.xml", "sitemap");
  const readme = readText("README.md", "AC-E9");
  const sources = readText("assets/logos/SOURCES.txt", "AC-E8");
  const videosHtml = readText("videos/index.html", "AC-E12");
  const headerPartial = readText("scripts/partials/header.html", "AC-E12");
  const catalog = readJson("tests/ecosystem.json", "AC-E1");
  const exclusions = checkExclusions(readJson("tests/ecosystem-exclusions.json", "AC-E1"));
  const flagshipSnapshot = readJson("tests/flagship.json", "AC-E10");

  const ecosystemHtml = indexHtml ? sectionInner(indexHtml, "ecosystem") : null;
  const productsHtml = indexHtml ? sectionInner(indexHtml, "products") : null;
  if (indexHtml && ecosystemHtml == null) fail("AC-E1", "missing #ecosystem");
  if (indexHtml && productsHtml == null) fail("AC-E10", "missing #products");

  const ecoGroups = rowsIn(ecosystemHtml, "eco-list");
  const flagshipGroups = rowsIn(productsHtml, "index");
  const flagshipRows = flagshipGroups.flat();
  let ecoRows = [];
  if (catalog) checkCatalog(catalog);
  if (catalog && ecosystemHtml != null) ecoRows = checkPageList(ecoGroups, catalog);
  if (catalog && ecoRows.length) checkRowContent(ecoRows, catalog);

  const jsonLd = indexHtml ? jsonLdTexts(indexHtml) : null;
  const llmsEco = llms ? markdownSection(llms, "## Ecosystem") : null;
  checkWording(ecosystemHtml, jsonLd ? jsonLd.join("\n") : null, llmsEco ? llmsEco.join("\n") : null, indexHtml ? metaDescription(indexHtml) : null);
  if (jsonLd) checkJsonLd(jsonLd);
  checkLlmsCounts(llms);
  checkMarks(flagshipRows, flagshipSnapshot, ecoRows, catalog, sources);
  checkEmptyMarks(productsHtml, ecosystemHtml);
  checkLicenseMention([
    ["index.html", indexHtml],
    ["llms.txt", llms],
    ["sitemap.xml", sitemap],
    ["README.md", readme],
  ]);
  checkFlagship(flagshipRows, flagshipSnapshot);
  checkSitemap(sitemap, catalog);

  if (indexHtml) checkNav(markedHeader(indexHtml, "index.html"), "index.html");
  if (videosHtml) checkNav(markedHeader(videosHtml, "videos/index.html"), "videos/index.html");
  if (headerPartial) checkNav(headerPartial, "scripts/partials/header.html");
  if (indexHtml && !/\bid\s*=\s*["']ecosystem["']/.test(indexHtml)) fail("AC-E12", 'index.html has no id "ecosystem"');

  if (online) await runOnline(catalog, exclusions, ecoRows, flagshipRows);
  report();
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((err) => {
    console.error(err);
    console.log("check-ecosystem: 1 failure(s)");
    process.exit(1);
  });
}
