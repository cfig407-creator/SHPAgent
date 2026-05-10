// One-shot importer for IFMA JAX Professionals.xlsx → seed-prospects.js
//
// Reads the parsed JSON dropped by the Python step, runs each row through the
// app's existing classifyCounty + classifyICP + classifyTitle so the
// classification matches what the app expects, then appends new entries to
// seed-prospects.js with IDs starting at seed_603.
//
// Idempotency: scans existing emails + name-company pairs in the seed file and
// skips anything already present.
//
// Usage: node scripts/import-ifma-jax.mjs
//   --dry  to preview without writing

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyCounty, classifyICP, classifyTitle } from '../src/strategy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RAW = path.join(__dirname, '_ifma_jax_raw.json');
const SEED = path.join(ROOT, 'src', 'seed-prospects.js');

const dryRun = process.argv.includes('--dry');

function loadSeed() {
  const text = fs.readFileSync(SEED, 'utf8');
  // Existing seed file is `export default [ ... ];` — extract the array literal
  const match = text.match(/export default (\[[\s\S]*\]);?\s*$/);
  if (!match) throw new Error('Could not parse seed-prospects.js');
  // eslint-disable-next-line no-eval
  const arr = eval(match[1]);
  return { existing: arr, prefix: text.slice(0, match.index) };
}

function normName(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function classifyAndBuild(rec, idIdx) {
  const county = classifyCounty(rec.city);
  const icp = classifyICP(rec.company, rec.title);
  const titleClass = classifyTitle(rec.title);

  // Status mapping mirrors normalizeSeed in the app
  let status;
  if (icp.status === 'in') status = 'Ready';
  else if (icp.status === 'unknown') status = 'Review Needed';
  else status = 'Out of ICP';

  // Priority — match the existing seed convention (110 for Ready/in-ICP, less otherwise)
  let priority = 70;
  if (icp.status === 'in') priority = 110;
  else if (icp.status === 'unknown') priority = 85;

  // Source notes capture IFMA-specific context
  const sourceNotes = [
    rec.memberType ? `IFMA JAX (${rec.memberType})` : 'IFMA JAX',
    rec.credentials ? `creds: ${rec.credentials}` : '',
  ].filter(Boolean).join(' · ');

  return {
    id: `seed_${idIdx}`,
    name: rec.name,
    title: rec.title,
    company: rec.company,
    email: rec.email,
    phone: rec.phone,
    address: '',
    city: rec.city,
    county: county || '',
    state: rec.state ? (rec.state === 'Florida' ? 'FL' : rec.state) : 'FL',
    zip: rec.zip,
    segment: icp.segment,
    status,
    priority,
    source: 'IFMA JAX',
    sourceNotes,
    enrollmentOrPop: '',
  };
}

function main() {
  const raw = JSON.parse(fs.readFileSync(RAW, 'utf8'));
  const { existing } = loadSeed();

  const seenEmails = new Set(existing.map(p => (p.email || '').toLowerCase()).filter(Boolean));
  const seenNameOrg = new Set(existing.map(p => `${normName(p.name)}|${normName(p.company)}`));

  // Highest existing seed_N number + 1
  const maxId = existing.reduce((m, p) => {
    const m2 = (p.id || '').match(/^seed_(\d+)$/);
    return m2 ? Math.max(m, parseInt(m2[1], 10)) : m;
  }, 0);

  const newOnes = [];
  const skipped = { dup: 0, noName: 0, noCompany: 0 };
  const buckets = { Ready: 0, ReviewNeeded: 0, OutOfICP: 0, inTerritory: 0, outOfTerritory: 0 };

  for (const r of raw) {
    if (!r.name) { skipped.noName++; continue; }
    if (!r.company) { skipped.noCompany++; continue; }
    const key = `${normName(r.name)}|${normName(r.company)}`;
    if (seenNameOrg.has(key)) { skipped.dup++; continue; }
    if (r.email && seenEmails.has(r.email.toLowerCase())) { skipped.dup++; continue; }

    const next = classifyAndBuild(r, maxId + newOnes.length + 1);
    newOnes.push(next);

    if (next.status === 'Ready') buckets.Ready++;
    else if (next.status === 'Review Needed') buckets.ReviewNeeded++;
    else buckets.OutOfICP++;
    if (next.county) buckets.inTerritory++; else buckets.outOfTerritory++;
  }

  console.log(`Parsed ${raw.length} input rows.`);
  console.log(`Skipped: ${skipped.dup} dup, ${skipped.noName} no-name, ${skipped.noCompany} no-company`);
  console.log(`New entries to add: ${newOnes.length}`);
  console.log(`  Ready (in-ICP):    ${buckets.Ready}`);
  console.log(`  Review Needed:     ${buckets.ReviewNeeded}`);
  console.log(`  Out of ICP:        ${buckets.OutOfICP}`);
  console.log(`  In CFL territory:  ${buckets.inTerritory}`);
  console.log(`  Out of territory:  ${buckets.outOfTerritory}`);

  if (dryRun) {
    console.log('\nFirst 3 new entries (preview):');
    console.log(JSON.stringify(newOnes.slice(0, 3), null, 2));
    return;
  }

  if (newOnes.length === 0) { console.log('Nothing to add.'); return; }

  // Append to seed file by replacing the closing `]`
  const text = fs.readFileSync(SEED, 'utf8');
  const closing = text.lastIndexOf('];');
  if (closing < 0) throw new Error('Could not find closing ]; in seed file');

  const newJson = newOnes
    .map(p => '  ' + JSON.stringify(p, null, 2).split('\n').join('\n  '))
    .join(',\n');

  // Find where the last existing entry ends to insert a comma + the new entries
  const before = text.slice(0, closing).trimEnd();
  const insertion = before.endsWith(',') ? '\n' + newJson + '\n' : ',\n' + newJson + '\n';
  const totalCount = existing.length + newOnes.length;
  const updated = text.slice(0, 1).startsWith('//')
    ? text.replace(/\/\/ \d+ records/, `// ${totalCount} records`)
    : text;
  const final = updated.slice(0, closing).trimEnd() + insertion + '];\n';

  fs.writeFileSync(SEED, final.replace(/\/\/ \d+ records/, `// ${totalCount} records`));
  console.log(`\nWrote ${newOnes.length} entries to seed-prospects.js (now ${totalCount} total).`);
}

main();
