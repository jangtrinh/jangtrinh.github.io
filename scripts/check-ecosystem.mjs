import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BANNED = /open[\s-]source/i;
const TAG = "FREE · source-available";
const SHIELD_PHRASE = "source-available (PolyForm Shield";
const MCP_LOGO = "assets/logos/mcp-bridge-go.webp";
const HUB_HOME = "https://jangtrinh.github.io/";
const HUB_VIDEOS = "https://jangtrinh.github.io/videos/";
const NAV = [
  { href: "/#products", text: "Products" },
  { href: "/videos/", text: "Videos" },
  { href: "/#ecosystem", text: "Ecosystem" },
];
const FILE_LIST = [
  "index.html",
  "llms.txt",
  "sitemap.xml",
  "README.md",
  "assets/logos/SOURCES.txt",
  "videos/index.html",
  "scripts/partials/header.html",
  "tests/ecosystem.json",
  "tests/ecosystem-exclusions.json",
  "tests/flagship.json",
  "tests/marks.sha256",
];

let failures = [];
let stats = emptyStats();

function emptyStats() {
  return {
    rows: 0,
    groups: 0,
    groupSizes: [],
    docsPills: 0,
    jsonLd: 0,
    sitemap: 0,
    llmsProducts: 0,
    llmsEco: 0,
    marks: 0,
  };
}

function reset() {
  failures = [];
  stats = emptyStats();
}

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

function groupPlan(catalog) {
  const plan = [];
  for (const entry of catalog) {
    const id = entry && typeof entry.group === "string" ? entry.group : "";
    const last = plan[plan.length - 1];
    if (!last || last.id !== id) plan.push({ id, size: 1 });
    else last.size += 1;
  }
  return plan;
}

function checkCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    fail("AC-E1", `tests/ecosystem.json has ${Array.isArray(catalog) ? catalog.length : "no"} rows`);
    return false;
  }
  catalog.forEach((entry, index) => {
    const n = index + 1;
    const logo = entry && `assets/logos/${entry.repo}.webp`;
    if (!entry || entry.n !== n) fail("AC-E1", `tests/ecosystem.json entry ${index} n is ${entry && entry.n}, expected ${n}`);
    if (!entry || typeof entry.group !== "string" || entry.group === "") fail("AC-E1", `row ${n} missing group`);
    if (!entry || typeof entry.name !== "string" || entry.name === "") fail("AC-E1", `row ${n} missing name`);
    if (!entry || typeof entry.repo !== "string" || !entry.repo) fail("AC-E1", `row ${n} missing repo`);
    if (!entry || entry.logo !== logo) fail("AC-E8", `row ${n} logo is ${entry && entry.logo}, expected ${logo}`);
    if (!entry || (entry.docs != null && (typeof entry.docs !== "string" || entry.docs === ""))) {
      fail("AC-E2", `row ${n} docs is not a URL`);
    }
  });
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
  const plan = groupPlan(catalog);
  if (groups.length !== plan.length) fail("AC-E1", `#ecosystem has ${groups.length} groups, expected ${plan.length}`);
  const flat = [];
  plan.forEach((group, index) => {
    const rows = groups[index] || [];
    if (rows.length !== group.size) fail("AC-E1", `group ${group.id || index + 1} has ${rows.length} rows, expected ${group.size}`);
    flat.push(...rows);
  });
  for (let index = plan.length; index < groups.length; index++) flat.push(...groups[index]);
  if (flat.length !== catalog.length) fail("AC-E1", `#ecosystem has ${flat.length} rows, expected ${catalog.length}`);
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

function checkJsonLd(blocks, expectedCount) {
  if (!blocks || blocks.length === 0) {
    fail("AC-E7", "home JSON-LD missing");
    return [];
  }
  const apps = [];
  for (const block of blocks) {
    try {
      apps.push(...softwareApps(JSON.parse(block)));
    } catch {
      fail("AC-E7", "home JSON-LD does not parse");
      stats.jsonLd = apps.length;
      return apps;
    }
  }
  stats.jsonLd = apps.length;
  if (apps.length !== expectedCount) fail("AC-E7", `${apps.length} SoftwareApplication nodes, expected ${expectedCount}`);
  for (const app of apps) {
    if (app.isAccessibleForFree !== true) {
      fail("AC-E7", `${app.name || "SoftwareApplication"} isAccessibleForFree is not true`);
    }
  }
  return apps;
}

function parseLlmsItems(lines) {
  return lines.map((line) => {
    const match = /^- \[([^\]]+)\]\(([^)]+)\): (.*) Repo: (\S+)\s*$/.exec(line);
    if (!match) {
      fail("AC-E7", `llms.txt line does not parse: ${line}`);
      return null;
    }
    return { name: match[1], href: match[2], description: match[3], repoUrl: match[4] };
  });
}

function checkLlmsCounts(llms, expectedProducts, expectedEco) {
  if (llms == null) return [];
  let items = [];
  for (const [heading, expected] of [["## Products", expectedProducts], ["## Ecosystem", expectedEco]]) {
    const body = markdownSection(llms, heading);
    if (!body) {
      fail("AC-E7", `llms.txt missing ${heading}`);
      continue;
    }
    const lines = body.filter((line) => line.startsWith("- "));
    if (heading === "## Products") stats.llmsProducts = lines.length;
    if (heading === "## Ecosystem") {
      stats.llmsEco = lines.length;
      items = parseLlmsItems(lines);
    }
    if (lines.length !== expected) fail("AC-E7", `llms.txt ${heading} has ${lines.length} lines, expected ${expected}`);
  }
  return items;
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

function isHubDocs(url) {
  return typeof url === "string" && url.startsWith(HUB_HOME);
}

function checkSitemap(xml, catalog, flagship) {
  if (xml == null) return;
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => match[1]);
  stats.sitemap = locs.length;
  const expected = new Set([HUB_HOME, HUB_VIDEOS]);
  if (Array.isArray(flagship)) {
    for (const row of flagship) {
      for (const link of (row && row.links) || []) {
        if (link && link.text === "Docs" && isHubDocs(link.href)) expected.add(link.href);
      }
    }
  }
  if (Array.isArray(catalog)) {
    for (const entry of catalog) {
      if (entry && isHubDocs(entry.docs)) expected.add(entry.docs);
    }
  }
  const seen = new Set();
  const dupes = [];
  for (const loc of locs) {
    if (seen.has(loc)) dupes.push(loc);
    seen.add(loc);
  }
  if (dupes.length) fail("sitemap", `duplicate ${dupes.join(", ")}`);
  const reported = new Set();
  if (Array.isArray(catalog)) {
    for (const entry of catalog) {
      if (!entry || !isHubDocs(entry.docs) || seen.has(entry.docs)) continue;
      fail("sitemap", `row ${entry.n} docs "${entry.docs}" vs absent`);
      reported.add(entry.docs);
    }
  }
  for (const loc of expected) if (!seen.has(loc) && !reported.has(loc)) fail("sitemap", `missing ${loc}`);
  for (const loc of seen) if (!expected.has(loc)) fail("sitemap", `unexpected ${loc}`);
}

function show(value) {
  return value == null ? "null" : `"${value}"`;
}

function differ(ac, n, field, left, right) {
  if (left !== right) fail(ac, `row ${n} ${field} ${show(left)} vs ${show(right)}`);
}

function linkByText(row, text) {
  const found = row.links.filter((link) => link.text === text);
  if (found.length === 1) return found[0].href;
  if (found.length === 0) return null;
  return found.map((link) => link.href).join(" ");
}

function checkCross(ecoRows, catalog, apps, llmsItems) {
  if (!Array.isArray(catalog)) return;
  const byName = new Map();
  for (const app of apps || []) {
    const name = app && app.name;
    if (typeof name !== "string") continue;
    if (byName.has(name)) fail("AC-E7", `JSON-LD name "${name}" is duplicated`);
    else byName.set(name, app);
  }
  catalog.forEach((expected, index) => {
    if (!expected || typeof expected.n !== "number") return;
    const n = expected.n;
    const row = ecoRows[index];
    const item = llmsItems[index];
    const github = typeof expected.repo === "string" ? `https://github.com/jangtrinh/${expected.repo}` : null;
    const docs = expected.docs == null ? null : expected.docs;
    const publicUrl = docs || github;
    if (!row) {
      fail("AC-E1", `row ${n} missing from #ecosystem`);
      return;
    }
    differ("AC-E1", n, "name", row.name, expected.name);
    differ("AC-E1", n, "logo", row.imgs.length === 1 ? row.imgs[0].src : null, expected.logo);
    differ("AC-E1", n, "GitHub", linkByText(row, "GitHub"), github);
    differ("AC-E1", n, "docs", linkByText(row, "Docs"), docs);
    const description = descriptionOf(row);
    const app = typeof expected.name === "string" ? byName.get(expected.name) : null;
    if (!app) fail("AC-E7", `row ${n} JSON-LD node missing for "${expected.name}"`);
    else {
      differ("AC-E7", n, "JSON-LD name", app.name, expected.name);
      differ("AC-E7", n, "description", app.description, description);
      differ("AC-E7", n, "JSON-LD url", app.url, publicUrl);
      differ("AC-E7", n, "codeRepository", app.codeRepository, github);
    }
    if (!item) fail("AC-E7", `row ${n} llms.txt line missing`);
    else {
      differ("AC-E7", n, "llms name", item.name, expected.name);
      differ("AC-E7", n, "llms description", item.description, description);
      differ("AC-E7", n, "llms url", item.href, publicUrl);
      differ("AC-E7", n, "llms repo", item.repoUrl, github);
    }
  });
}

function checkMarkHashes(manifestText) {
  const dir = path.join(ROOT, "assets/logos");
  let present = [];
  try {
    present = fs.readdirSync(dir).filter((name) => name.endsWith(".webp")).sort();
  } catch {
    fail("AC-E8", "cannot read assets/logos");
    return;
  }
  if (manifestText == null) {
    fail("AC-E8", "cannot read tests/marks.sha256");
    return;
  }
  const listed = new Map();
  linesOf(manifestText).forEach((line, index) => {
    if (line.trim() === "") return;
    const match = /^([a-f0-9]{64})  (\S+)$/.exec(line);
    if (!match) {
      fail("AC-E8", `tests/marks.sha256:${index + 1} is not sha256sum`);
      return;
    }
    if (listed.has(match[2])) fail("AC-E8", `tests/marks.sha256 lists ${match[2]} twice`);
    listed.set(match[2], match[1]);
  });
  for (const name of present) if (!listed.has(name)) fail("AC-E8", `tests/marks.sha256 missing ${name}`);
  for (const name of listed.keys()) if (!present.includes(name)) fail("AC-E8", `tests/marks.sha256 extra ${name}`);
  for (const name of present) {
    let hash;
    try {
      hash = createHash("sha256").update(fs.readFileSync(path.join(dir, name))).digest("hex");
    } catch {
      fail("AC-E8", `cannot hash ${name}`);
      continue;
    }
    stats.marks += 1;
    const expected = listed.get(name);
    if (expected && hash !== expected) fail("AC-E8", `${name} sha256 ${hash}, expected ${expected}`);
  }
}

function checkCounts() {
  const counts = [
    ["AC-E1", "rows", stats.rows],
    ["AC-E1", "groups", stats.groups],
    ["AC-E2", "docs pills", stats.docsPills],
    ["AC-E7", "JSON-LD nodes", stats.jsonLd],
    ["sitemap", "sitemap URLs", stats.sitemap],
    ["AC-E7", "llms products", stats.llmsProducts],
    ["AC-E7", "llms ecosystem", stats.llmsEco],
    ["AC-E8", "marks", stats.marks],
  ];
  for (const [ac, label, value] of counts) if (!value) fail(ac, `${label} count is 0`);
  for (const size of stats.groupSizes) if (!size) fail("AC-E1", "group size is 0");
}

function summaryLine() {
  return `check-ecosystem: ${stats.rows} rows, ${stats.groups} groups (${stats.groupSizes.join("/")}), ${stats.docsPills} docs pills, ${stats.jsonLd} JSON-LD nodes, ${stats.sitemap} sitemap URLs, llms ${stats.llmsProducts}+${stats.llmsEco}, ${stats.marks} marks hashed`;
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

async function checkAbsentPages(catalog) {
  if (!Array.isArray(catalog)) return;
  const rows = catalog.filter((entry) => entry && entry.docs == null && typeof entry.repo === "string" && entry.repo);
  const results = await Promise.all(rows.map(async (entry) => {
    const url = `https://jangtrinh.github.io/${entry.repo}/`;
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      });
      await response.arrayBuffer();
      if (response.status === 404) return null;
      return `row ${entry.n} ${url} status ${response.status}, expected 404`;
    } catch (err) {
      return `row ${entry.n} ${url} ${oneLine(err.message)}`;
    }
  }));
  for (const message of results) if (message) fail("AC-E2", message);
}

async function runOnline(catalog, exclusions, ecoRows, flagshipRows) {
  if (catalog) checkLicenseGate(catalog);
  if (catalog) await checkAbsentPages(catalog);
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

function fileText(files, rel, ac) {
  if (files[rel] == null) {
    fail(ac, `cannot read ${rel}`);
    return null;
  }
  return files[rel];
}

function parseJson(text, rel, ac) {
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    fail(ac, `${rel} is not JSON`);
    return null;
  }
}

function loadFiles() {
  const files = {};
  for (const rel of FILE_LIST) {
    try {
      files[rel] = fs.readFileSync(path.join(ROOT, rel), "utf8");
    } catch {
      files[rel] = null;
    }
  }
  return files;
}

function evaluate(files) {
  const indexHtml = fileText(files, "index.html", "AC-E1");
  const llms = fileText(files, "llms.txt", "AC-E7");
  const sitemap = fileText(files, "sitemap.xml", "sitemap");
  const readme = fileText(files, "README.md", "AC-E9");
  const sources = fileText(files, "assets/logos/SOURCES.txt", "AC-E8");
  const videosHtml = fileText(files, "videos/index.html", "AC-E12");
  const headerPartial = fileText(files, "scripts/partials/header.html", "AC-E12");
  const marks = fileText(files, "tests/marks.sha256", "AC-E8");
  const catalog = parseJson(fileText(files, "tests/ecosystem.json", "AC-E1"), "tests/ecosystem.json", "AC-E1");
  const exclusions = checkExclusions(parseJson(fileText(files, "tests/ecosystem-exclusions.json", "AC-E1"), "tests/ecosystem-exclusions.json", "AC-E1"));
  const flagshipSnapshot = parseJson(fileText(files, "tests/flagship.json", "AC-E10"), "tests/flagship.json", "AC-E10");

  const ecosystemHtml = indexHtml ? sectionInner(indexHtml, "ecosystem") : null;
  const productsHtml = indexHtml ? sectionInner(indexHtml, "products") : null;
  if (indexHtml && ecosystemHtml == null) fail("AC-E1", "missing #ecosystem");
  if (indexHtml && productsHtml == null) fail("AC-E10", "missing #products");

  const ecoGroups = rowsIn(ecosystemHtml, "eco-list");
  const flagshipRows = rowsIn(productsHtml, "index").flat();
  stats.groups = ecoGroups.length;
  stats.groupSizes = ecoGroups.map((rows) => rows.length);
  let ecoRows = ecoGroups.flat();
  if (catalog) checkCatalog(catalog);
  if (catalog && ecosystemHtml != null) ecoRows = checkPageList(ecoGroups, catalog);
  stats.rows = ecoRows.length;
  stats.docsPills = ecoRows.reduce((sum, row) => sum + row.links.filter((link) => link.text === "Docs").length, 0);
  if (catalog && ecoRows.length) checkRowContent(ecoRows, catalog);

  const jsonLd = indexHtml ? jsonLdTexts(indexHtml) : null;
  const llmsEco = llms ? markdownSection(llms, "## Ecosystem") : null;
  checkWording(ecosystemHtml, jsonLd ? jsonLd.join("\n") : null, llmsEco ? llmsEco.join("\n") : null, indexHtml ? metaDescription(indexHtml) : null);
  const productCount = Array.isArray(flagshipSnapshot) ? flagshipSnapshot.length : 0;
  const rowCount = Array.isArray(catalog) ? catalog.length : 0;
  const apps = jsonLd ? checkJsonLd(jsonLd, productCount + rowCount) : [];
  const llmsItems = checkLlmsCounts(llms, productCount, rowCount);
  checkMarks(flagshipRows, flagshipSnapshot, ecoRows, catalog, sources);
  checkMarkHashes(marks);
  checkEmptyMarks(productsHtml, ecosystemHtml);
  checkLicenseMention([
    ["index.html", indexHtml],
    ["llms.txt", llms],
    ["sitemap.xml", sitemap],
    ["README.md", readme],
  ]);
  checkFlagship(flagshipRows, flagshipSnapshot);
  checkSitemap(sitemap, catalog, flagshipSnapshot);
  checkCross(ecoRows, catalog || [], apps, llmsItems);

  if (indexHtml) checkNav(markedHeader(indexHtml, "index.html"), "index.html");
  if (videosHtml) checkNav(markedHeader(videosHtml, "videos/index.html"), "videos/index.html");
  if (headerPartial) checkNav(headerPartial, "scripts/partials/header.html");
  if (indexHtml && !/\bid\s*=\s*["']ecosystem["']/.test(indexHtml)) fail("AC-E12", 'index.html has no id "ecosystem"');
  checkCounts();
  return { catalog, exclusions, ecoRows, flagshipRows };
}

function ecosystemBounds(html) {
  const open = /<section\b[^>]*\bid=["']ecosystem["'][^>]*>/i.exec(html);
  if (!open) return null;
  const start = open.index + open[0].length;
  const re = /<\/?section\b[^>]*>/gi;
  re.lastIndex = start;
  let depth = 1;
  let found;
  while ((found = re.exec(html))) {
    depth += found[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return { start, end: found.index };
  }
  return null;
}

function ecoLis(inner) {
  return [...inner.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/gi)].map((match) => ({
    index: match.index,
    text: match[0],
  }));
}

function mapEcosystem(html, fn) {
  const bounds = ecosystemBounds(html || "");
  if (!bounds) return html;
  const inner = html.slice(bounds.start, bounds.end);
  return html.slice(0, bounds.start) + fn(inner, ecoLis(inner)) + html.slice(bounds.end);
}

function removeRow(html) {
  return mapEcosystem(html, (inner, lis) => {
    if (!lis.length) return inner;
    const li = lis[0];
    return inner.slice(0, li.index) + inner.slice(li.index + li.text.length);
  });
}

function swapRows(html) {
  return mapEcosystem(html, (inner, lis) => {
    if (lis.length < 2) return inner;
    const a = lis[0];
    const b = lis[1];
    return inner.slice(0, a.index) + b.text + inner.slice(a.index + a.text.length, b.index) + a.text + inner.slice(b.index + b.text.length);
  });
}

function removeDocsPill(html) {
  const at = (html || "").indexOf('id="ecosystem"');
  const hit = html.indexOf(">Docs<svg", at);
  const open = html.lastIndexOf("<a ", hit);
  const close = html.indexOf("</a>", hit);
  if (at < 0 || hit < 0 || open < at || close < 0) return html;
  return html.slice(0, open) + html.slice(close + 4);
}

function addDocsPill(html) {
  const needle = 'aria-label="DESIGN:OS Skills on GitHub">';
  const hit = (html || "").indexOf(needle);
  const close = html.indexOf("</a>", hit);
  if (hit < 0 || close < 0) return html;
  const pill = '<a href="https://jangtrinh.github.io/design-os-skills-pack/" aria-label="DESIGN:OS Skills docs">Docs<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 6h8M6.5 2.5 10 6 6.5 9.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></a>';
  return html.slice(0, close + 4) + pill + html.slice(close + 4);
}

function bannedTag(html) {
  const phrase = ["open", "source"].join(" ");
  const at = (html || "").indexOf('id="ecosystem"');
  const needle = '<span class="eco-tag">FREE · source-available</span>';
  const hit = html.indexOf(needle, at);
  if (hit < 0) return html;
  return html.slice(0, hit) + `<span class="eco-tag">FREE · ${phrase}</span>` + html.slice(hit + needle.length);
}

function dropJsonLd(html) {
  const open = '<script type="application/ld+json">';
  const start = (html || "").indexOf(open);
  const end = html.indexOf("</script>", start);
  if (start < 0 || end < 0) return html;
  const jsonStart = start + open.length;
  const data = JSON.parse(html.slice(jsonStart, end));
  const graph = data["@graph"];
  const index = graph.findIndex((node) => node["@type"] === "SoftwareApplication");
  if (index >= 0) graph.splice(index, 1);
  return html.slice(0, jsonStart) + JSON.stringify(data) + html.slice(end);
}

function dropLlmsLine(text) {
  const at = (text || "").indexOf("## Ecosystem");
  const bullet = text.indexOf("\n- ", at);
  const next = text.indexOf("\n", bullet + 1);
  if (at < 0 || bullet < 0 || next < 0) return text;
  return text.slice(0, bullet) + text.slice(next);
}

function swapHash(text) {
  return (text || "").replace(/^([a-f0-9])([a-f0-9]{63})/m, (_, first, rest) => (first === "a" ? "b" : "a") + rest);
}

function removeImg(html) {
  const at = (html || "").indexOf('id="ecosystem"');
  const img = html.indexOf("<img ", at);
  const end = html.indexOf(">", img);
  if (at < 0 || img < 0 || end < 0) return html;
  return html.slice(0, img) + html.slice(end + 1);
}

function licenceMention(text) {
  return `${text || ""}\nproduct-os-spec-driven is listed here.\n`;
}

function changeFlagship(html) {
  const needle = "Reads and writes .fig files.";
  const at = (html || "").indexOf('id="products"');
  const hit = html.indexOf(needle, at);
  if (hit < 0) return html;
  return html.slice(0, hit) + "Reads and writes .fig files now." + html.slice(hit + needle.length);
}

function removeNav(html) {
  return (html || "").replace('\n    <a href="/#ecosystem">Ecosystem</a>', "");
}

function dropSitemapUrl(xml) {
  const needle = "<loc>https://jangtrinh.github.io/design-os-vietnamese/</loc>";
  const loc = (xml || "").indexOf(needle);
  const start = xml.lastIndexOf("<url>", loc);
  const end = xml.indexOf("</url>", loc);
  if (loc < 0 || start < 0 || end < 0) return xml;
  return xml.slice(0, start) + xml.slice(end + "</url>".length);
}

function coEdit(files) {
  const html = files["index.html"] || "";
  const at = html.indexOf('id="ecosystem"');
  const needle = "https://github.com/jangtrinh/design-os-vietnamese";
  const hit = html.indexOf(needle, at);
  if (hit >= 0) {
    files["index.html"] = html.slice(0, hit) + "https://github.com/jangtrinh/design-os-vietnamese-x" + html.slice(hit + needle.length);
  }
  files["tests/ecosystem.json"] = (files["tests/ecosystem.json"] || "").replace(
    '"repo": "design-os-vietnamese"',
    '"repo": "design-os-vietnamese-x"',
  );
}

const MUTATIONS = [
  { name: "remove-row", ac: "AC-E1", apply(files) { files["index.html"] = removeRow(files["index.html"]); } },
  { name: "swap-rows", ac: "AC-E1", apply(files) { files["index.html"] = swapRows(files["index.html"]); } },
  { name: "remove-docs-pill", ac: "AC-E2", apply(files) { files["index.html"] = removeDocsPill(files["index.html"]); } },
  { name: "add-docs-pill", ac: "AC-E2", apply(files) { files["index.html"] = addDocsPill(files["index.html"]); } },
  { name: "banned-tag", ac: "AC-E3", apply(files) { files["index.html"] = bannedTag(files["index.html"]); } },
  { name: "drop-jsonld", ac: "AC-E7", apply(files) { files["index.html"] = dropJsonLd(files["index.html"]); } },
  { name: "drop-llms-line", ac: "AC-E7", apply(files) { files["llms.txt"] = dropLlmsLine(files["llms.txt"]); } },
  { name: "swap-hash", ac: "AC-E8", apply(files) { files["tests/marks.sha256"] = swapHash(files["tests/marks.sha256"]); } },
  { name: "remove-img", ac: "AC-E8", apply(files) { files["index.html"] = removeImg(files["index.html"]); } },
  { name: "licence-mention", ac: "AC-E9", apply(files) { files["README.md"] = licenceMention(files["README.md"]); } },
  { name: "flagship-description", ac: "AC-E10", apply(files) { files["index.html"] = changeFlagship(files["index.html"]); } },
  { name: "remove-nav", ac: "AC-E12", apply(files) { files["index.html"] = removeNav(files["index.html"]); } },
  { name: "remove-sitemap-url", ac: "sitemap", apply(files) { files["sitemap.xml"] = dropSitemapUrl(files["sitemap.xml"]); } },
  { name: "co-edit", ac: "AC-E7", apply: coEdit },
];

function selfTestRun(files) {
  reset();
  evaluate(files);
  if (failures.length) {
    for (const line of failures) console.log(line);
    console.log("check-ecosystem --self-test: base is red");
    process.exit(1);
  }
  let red = 0;
  for (const mutation of MUTATIONS) {
    const copy = { ...files };
    mutation.apply(copy);
    reset();
    evaluate(copy);
    const hit = failures.some((line) => line.startsWith(`${mutation.ac}:`));
    if (hit) {
      red += 1;
      console.log(`self-test ${mutation.name}: red (${mutation.ac})`);
    } else {
      console.log(`self-test ${mutation.name}: green`);
      for (const line of failures) console.log(line);
    }
  }
  console.log(`check-ecosystem --self-test: ${red}/${MUTATIONS.length} mutations red`);
  process.exit(red === MUTATIONS.length ? 0 : 1);
}

function parseArgs(argv) {
  let online = false;
  let selfTest = false;
  for (const arg of argv) {
    if (arg === "--online") online = true;
    else if (arg === "--self-test") selfTest = true;
    else {
      console.log(`check-ecosystem: unknown argument ${arg}`);
      process.exit(1);
    }
  }
  return { online, selfTest };
}

function report() {
  if (failures.length === 0) {
    console.log(summaryLine());
    console.log("check-ecosystem: OK");
    process.exit(0);
  }
  for (const line of failures) console.log(line);
  console.log(`check-ecosystem: ${failures.length} failure(s)`);
  process.exit(1);
}

async function main() {
  const { online, selfTest } = parseArgs(process.argv.slice(2));
  const files = loadFiles();
  if (selfTest) {
    selfTestRun(files);
    return;
  }
  reset();
  const loaded = evaluate(files);
  if (online) await runOnline(loaded.catalog, loaded.exclusions, loaded.ecoRows, loaded.flagshipRows);
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
