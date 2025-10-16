// Convert a .ke.txt dictionary into all.json for Monaco site
// Usage: node tools/ke-txt-to-all.mjs ./path/to/dict.ke.txt ./all.json
import fs from 'node:fs/promises';
import path from 'node:path';

const [,, inPath, outPath = './all.json'] = process.argv;
if (!inPath) {
  console.error('Usage: node tools/ke-txt-to-all.mjs <input.ke.txt> [out.json]');
  process.exit(1);
}

const raw = await fs.readFile(inPath, 'utf8');
const lines = raw.split(/\r?\n/);

const items = [];
for (let ln of lines) {
  const line = ln.trim();
  if (!line || line.startsWith('#') || line.startsWith('//')) continue;
  // Try formats in order: prefix -> body | prefix: body | prefix	body | prefix  body
  let m;
  if ((m = line.match(/^([^:\-\>\t\s]+)\s*[-:>]+\s*(.+)$/))) {
    const prefix = m[1].trim();
    const body = m[2].trim();
    if (prefix && body) items.push({ prefix, body, detail: `${prefix} → ${body}` });
    continue;
  }
  if ((m = line.match(/^([^\s]+)\s+(.+)$/))) {
    const prefix = m[1].trim();
    const body = m[2].trim();
    if (prefix && body) items.push({ prefix, body, detail: `${prefix} → ${body}` });
    continue;
  }
  // Fallback: ignore
}

// Deduplicate by (prefix,body)
const uniq = new Map();
for (const it of items) {
  uniq.set(`${it.prefix}\u0000${it.body}`, it);
}

const out = { items: Array.from(uniq.values()) };
await fs.writeFile(outPath, JSON.stringify(out, null, 2));
console.log(`wrote ${out.items.length} items to`, path.resolve(outPath));

