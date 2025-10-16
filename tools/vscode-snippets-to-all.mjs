// Convert a VS Code snippets JSON (object of snippets) to all.json format
// Usage: node tools/vscode-snippets-to-all.mjs ~/.config/Code/User/snippets/kanji-esperanto.json ./all.json
import fs from 'node:fs/promises';
import path from 'node:path';

const [,, inPath, outPath = './all.json'] = process.argv;
if (!inPath) {
  console.error('Usage: node tools/vscode-snippets-to-all.mjs <snippets.json> [out.json]');
  process.exit(1);
}

let raw = await fs.readFile(inPath, 'utf8');
// Support JSONC: strip BOM, //..., /*...*/, and trailing commas
raw = raw.replace(/^\uFEFF/, '');
// remove block comments
raw = raw.replace(/\/\*[\s\S]*?\*\//g, '');
// remove line comments
raw = raw.replace(/^\s*\/\/.*$/gm, '');
// remove trailing commas in objects/arrays
raw = raw.replace(/,\s*([}\]])/g, '$1');
let json;
try { json = JSON.parse(raw); } catch (e) {
  console.error('Invalid JSON:', e.message); process.exit(2);
}

const items = [];
for (const [name, spec] of Object.entries(json || {})) {
  if (!spec) continue;
  const prefixes = Array.isArray(spec.prefix) ? spec.prefix : (spec.prefix ? [spec.prefix] : []);
  const body = Array.isArray(spec.body) ? spec.body.join('\n') : (spec.body ?? '');
  const detail = spec.description || name || '';
  for (const p of prefixes) {
    if (!p) continue;
    items.push({ prefix: String(p), body: String(body), detail, documentation: spec.description || undefined });
  }
}

// Deduplicate by (prefix, body)
const uniq = new Map();
for (const it of items) uniq.set(`${it.prefix}\u0000${it.body}`, it);
const out = { items: Array.from(uniq.values()) };
await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(`wrote ${out.items.length} items to`, path.resolve(outPath));
