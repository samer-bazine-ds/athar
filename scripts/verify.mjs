import { readdir, readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const failures = [];

async function filesBelow(relativeDir, extension) {
  const directory = path.join(root, relativeDir);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(relative, extension));
    else if (entry.name.endsWith(extension)) files.push(relative);
  }
  return files;
}

async function exists(relativePath) {
  try {
    return (await stat(path.join(root, relativePath))).isFile();
  } catch {
    return false;
  }
}

const jsFiles = await filesBelow("js", ".js");
for (const file of jsFiles) {
  const syntax = spawnSync(process.execPath, ["--check", file], { cwd: root, encoding: "utf8" });
  if (syntax.status !== 0) failures.push(`${file}: ${syntax.stderr.trim() || "invalid JavaScript"}`);

  const source = await readFile(path.join(root, file), "utf8");
  if (source.includes("\uFFFD")) failures.push(`${file}: contains a replacement character`);
  const importPattern = /(?:from\s*|import\s*\()(["'])(\.{1,2}\/[^"']+)\1/g;
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[2].split(/[?#]/, 1)[0];
    const target = path.normalize(path.join(path.dirname(file), specifier));
    if (!await exists(target)) failures.push(`${file}: missing imported file ${specifier}`);
  }
}

for (const file of ["index.html", "login.html", "client-view.html"]) {
  const source = await readFile(path.join(root, file), "utf8");
  if (source.includes("\uFFFD")) failures.push(`${file}: contains a replacement character`);
  const ids = [...source.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1]);
  for (const id of new Set(ids)) {
    if (ids.filter((candidate) => candidate === id).length > 1) failures.push(`${file}: duplicate id ${id}`);
  }
  for (const match of source.matchAll(/(?:src|href)=["']([^"'#][^"']*)["']/g)) {
    const asset = match[1].split(/[?#]/, 1)[0];
    if (/^(?:https?:|data:|mailto:)/i.test(asset)) continue;
    if (!await exists(asset)) failures.push(`${file}: missing referenced asset ${asset}`);
  }
}

const config = await readFile(path.join(root, "js/config.js"), "utf8");
if (!/SUPABASE_URL:\s*["']https:\/\/[a-z0-9]+\.supabase\.co["']/.test(config)) failures.push("js/config.js: invalid SUPABASE_URL");
if (!/SUPABASE_ANON_KEY:\s*["'](?:eyJ|sb_publishable_)/.test(config)) failures.push("js/config.js: invalid public Supabase key");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Verified ${jsFiles.length} JavaScript files and 3 HTML entry points.`);
