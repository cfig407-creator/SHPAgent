// One-shot re-classifier: walks every prospect in seed-prospects.js, runs the
// (newly relaxed) classifyICP, and updates `segment` + `status` accordingly.
// Run after any policy change in classifyICP. Idempotent.
//
// Usage:
//   node scripts/reclassify-seed.mjs --dry   (preview transitions)
//   node scripts/reclassify-seed.mjs         (write back)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyICP } from '../src/strategy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED = path.resolve(__dirname, '..', 'src', 'seed-prospects.js');

const dry = process.argv.includes('--dry');

function loadSeed() {
  const text = fs.readFileSync(SEED, 'utf8');
  const match = text.match(/export default (\[[\s\S]*\]);?\s*$/);
  if (!match) throw new Error('Could not parse seed-prospects.js');
  // eslint-disable-next-line no-eval
  const arr = eval(match[1]);
  return { prospects: arr, rawText: text };
}

function statusFromIcp(icpStatus) {
  // App's normalizeSeed maps: Ready → in, Review Needed → unknown, * → out.
  // After the policy change, only healthcare returns 'out'; everything else
  // is 'in'. So: Ready for in, Out of ICP for out. Review Needed disappears
  // as a category from the seed (overrides handle in-app status).
  return icpStatus === 'in' ? 'Ready' : 'Out of ICP';
}

// Segments we should NEVER overwrite — they were manually curated in the seed
// and represent ground truth the keyword classifier can't always reproduce
// (e.g. "Trinity Lutheran" without "school" in the name is still K-12).
const PRESERVE_SEGMENTS = new Set([
  'K-12 Education', 'Higher Education', 'Local Government', 'Healthcare',
]);

function decide(prospect) {
  const existingSegment = prospect.segment || '';
  // Trust manually-curated segments — only update status to match the new policy
  if (PRESERVE_SEGMENTS.has(existingSegment)) {
    return {
      segment: existingSegment,
      status: existingSegment === 'Healthcare' ? 'Out of ICP' : 'Ready',
    };
  }
  // For Unclassified / Industrial / Retail / etc., re-run the classifier
  const icp = classifyICP(prospect.company, prospect.title);
  return { segment: icp.segment, status: statusFromIcp(icp.status) };
}

function main() {
  const { prospects } = loadSeed();
  const transitions = {};
  const updated = [];
  let changed = 0;

  for (const p of prospects) {
    const { segment: newSegment, status: newStatus } = decide(p);
    const oldStatus = p.status;
    const oldSegment = p.segment;

    if (newStatus !== oldStatus || newSegment !== oldSegment) {
      changed++;
      const key = `${oldStatus} → ${newStatus} (${oldSegment || '∅'} → ${newSegment})`;
      transitions[key] = (transitions[key] || 0) + 1;
    }

    // Bump priority on newly-Ready prospects so they don't all sit at the bottom.
    let priority = p.priority;
    if (oldStatus !== 'Ready' && newStatus === 'Ready' && (priority == null || priority < 90)) {
      priority = 90;
    }

    updated.push({ ...p, segment: newSegment, status: newStatus, priority });
  }

  const finalCount = updated.filter(p => p.status === 'Ready').length;
  const outCount = updated.filter(p => p.status === 'Out of ICP').length;

  console.log(`Total prospects: ${prospects.length}`);
  console.log(`Changed: ${changed}`);
  console.log(`After:  ${finalCount} Ready · ${outCount} Out of ICP (healthcare only)`);
  console.log(`\nTransitions:`);
  for (const [k, v] of Object.entries(transitions).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.toString().padStart(4)}  ${k}`);
  }

  if (dry) return;

  // Re-emit the seed file preserving header + format
  const header = `// Auto-generated from master prospect list. Do not edit by hand.\n// ${updated.length} records\nexport default `;
  const body = JSON.stringify(updated, null, 2);
  fs.writeFileSync(SEED, header + body + ';\n');
  console.log(`\nWrote ${updated.length} entries to seed-prospects.js`);
}

main();
