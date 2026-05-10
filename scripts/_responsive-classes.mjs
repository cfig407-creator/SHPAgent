// Batch-add responsive className attributes to SHPProspectingAgent.jsx.
// Idempotent: skips occurrences that already have a className adjacent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', 'src', 'SHPProspectingAgent.jsx');

let t = fs.readFileSync(FILE, 'utf8');

const subs = [
  ['style={styles.modalOverlay}',  'className="shp-modal-overlay" style={styles.modalOverlay}'],
  ['style={styles.modalCard}',     'className="shp-modal-card" style={styles.modalCard}'],
  ['style={styles.pageTitle}',     'className="shp-page-title" style={styles.pageTitle}'],
  ['style={styles.statsGrid}',     'className="shp-stats-grid" style={styles.statsGrid}'],
  ['style={styles.statCard}',      'className="shp-stat-card" style={styles.statCard}'],
  ['style={styles.statValue}',     'className="shp-stat-value" style={styles.statValue}'],
  ['style={styles.grid2}',         'className="shp-grid2" style={styles.grid2}'],
  ['style={styles.grid3}',         'className="shp-grid3" style={styles.grid3}'],
  ['style={styles.pipelineGrid}',  'className="shp-pipeline-grid" style={styles.pipelineGrid}'],
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let total = 0;

for (const [from, to] of subs) {
  // Negative-lookbehind: don't match if a className=... already precedes this style attribute.
  const re = new RegExp('(?<!className="[^"]*" )' + escape(from), 'g');
  const matches = (t.match(re) || []).length;
  if (matches > 0) {
    t = t.replace(re, to);
    console.log(`${from}  →  ${matches} replacements`);
    total += matches;
  }
}

fs.writeFileSync(FILE, t);
console.log(`Total: ${total}`);
