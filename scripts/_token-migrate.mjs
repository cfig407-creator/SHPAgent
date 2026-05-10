// One-shot Phase-1 color migration: replace hardcoded dark-theme color literals
// in SHPProspectingAgent.jsx with the new design-token references.
// Idempotent — safe to re-run, but will only change anything when matching
// hardcoded colors are still present.
//
// Run from the project root: node scripts/_token-migrate.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', 'src', 'SHPProspectingAgent.jsx');

let text = fs.readFileSync(FILE, 'utf8');
const before = text;

// ===========================================================================
// HEX → TOKEN
// ===========================================================================
const hex = [
  ["'#0a1628'",  "'var(--shp-red-on)'"],   // was used as text-on-green-button → flip to white-on-red analog
  ["'#4ade80'",  "'var(--ok)'"],
  ["'#5a6b85'",  "'var(--text-3)'"],
  ["'#7a8aa3'",  "'var(--text-3)'"],
  ["'#93b0d6'",  "'var(--info)'"],
  ["'#a8b5c9'",  "'var(--text-2)'"],
  ["'#c8d4e8'",  "'var(--text)'"],
  ["'#e8ecf3'",  "'var(--text)'"],
  ["'#fbbf24'",  "'var(--warn)'"],
  ["'#ff6b85'",  "'var(--danger)'"],
];
for (const [from, to] of hex) {
  text = text.split(from).join(to);
}

// ===========================================================================
// RGBA SOFT BACKGROUNDS — alpha < 0.1
// ===========================================================================
const softBg = [
  // SHP red soft
  [/'rgba\(200,\s*16,\s*46,\s*0\.0\d+\)'/g,    "'var(--shp-red-soft)'"],
  // OK / green soft
  [/'rgba\(34,\s*197,\s*94,\s*0\.0\d+\)'/g,    "'var(--ok-soft)'"],
  // Warn / amber soft (both 245,158,11 and 251,191,36 variants)
  [/'rgba\(245,\s*158,\s*11,\s*0\.0\d+\)'/g,   "'var(--warn-soft)'"],
  [/'rgba\(251,\s*191,\s*36,\s*0\.0\d+\)'/g,   "'var(--warn-soft)'"],
  // Danger / red soft
  [/'rgba\(255,\s*107,\s*133,\s*0\.0\d+\)'/g,  "'var(--danger-soft)'"],
  // Info / navy soft
  [/'rgba\(99,\s*130,\s*175,\s*0\.0\d+\)'/g,   "'var(--info-soft)'"],
  // Light overlay on dark (used for borders/bgs in old theme) → use token surface/border
  [/'rgba\(232,\s*236,\s*243,\s*0\.04\)'/g,    "'var(--bg-sunk)'"],
  [/'rgba\(232,\s*236,\s*243,\s*0\.06\)'/g,    "'var(--bg-sunk)'"],
  [/'rgba\(232,\s*236,\s*243,\s*0\.08\)'/g,    "'var(--border)'"],
  [/'rgba\(232,\s*236,\s*243,\s*0\.1\d*\)'/g,  "'var(--border-strong)'"],
  // Dark code-block background (was rgba(0,0,0,0.3) and rgba(10,22,40,0.5))
  [/'rgba\(0,\s*0,\s*0,\s*0\.3\)'/g,           "'var(--bg-sunk)'"],
  [/'rgba\(10,\s*22,\s*40,\s*0\.\d+\)'/g,      "'var(--bg-sunk)'"],
];
for (const [re, to] of softBg) {
  text = text.replace(re, to);
}

// ===========================================================================
// RGBA "BORDER" RANGE — alpha 0.15-0.4 → color-mix from semantic token
// ===========================================================================
const colorMix = [
  // SHP red border
  [/'rgba\(200,\s*16,\s*46,\s*0\.[1-4]\d*\)'/g,
    "'color-mix(in oklch, var(--shp-red) 30%, transparent)'"],
  // OK / green border
  [/'rgba\(34,\s*197,\s*94,\s*0\.[1-4]\d*\)'/g,
    "'color-mix(in oklch, var(--ok) 30%, transparent)'"],
  // Warn border
  [/'rgba\(245,\s*158,\s*11,\s*0\.[1-4]\d*\)'/g,
    "'color-mix(in oklch, var(--warn) 30%, transparent)'"],
  [/'rgba\(251,\s*191,\s*36,\s*0\.[1-4]\d*\)'/g,
    "'color-mix(in oklch, var(--warn) 30%, transparent)'"],
  // Danger border
  [/'rgba\(255,\s*107,\s*133,\s*0\.[1-4]\d*\)'/g,
    "'color-mix(in oklch, var(--danger) 30%, transparent)'"],
  // Info border
  [/'rgba\(99,\s*130,\s*175,\s*0\.[1-4]\d*\)'/g,
    "'color-mix(in oklch, var(--info) 30%, transparent)'"],
];
for (const [re, to] of colorMix) {
  text = text.replace(re, to);
}

// ===========================================================================
// GRADIENT REMOVALS (replace red gradients with solid)
// ===========================================================================
text = text.replace(
  /linear-gradient\([^)]*#C8102E[^)]*\)/g,
  'var(--shp-red)'
);
text = text.replace(
  /linear-gradient\([^)]*#ef4444[^)]*\)/g,
  'var(--danger)'
);
// The progress bar's red gradient — keep as a subtle red→dark-red gradient (not to text)
text = text.replace(
  /linear-gradient\(90deg,\s*#C8102E,\s*#ff6b85\)/g,
  'var(--shp-red)'
);

// ===========================================================================
// REPORT
// ===========================================================================
if (text === before) {
  console.log('No replacements needed (already migrated).');
  process.exit(0);
}

fs.writeFileSync(FILE, text);

const remainingHex = (text.match(/'#[0-9a-fA-F]{3,8}'/g) || []).filter(h => h !== "'#fff'" && h !== "'#ffffff'" && h !== "'#000'" && h !== "'#000000'");
const remainingRgba = text.match(/'rgba\([^)]+\)'/g) || [];
console.log(`Migrated tokens. Remaining hardcoded colors:`);
console.log(`  hex literals : ${remainingHex.length}`);
console.log(`  rgba literals: ${remainingRgba.length}`);
if (remainingHex.length) console.log('  hex sample:', [...new Set(remainingHex)].slice(0, 6).join(', '));
if (remainingRgba.length) console.log('  rgba sample:', [...new Set(remainingRgba)].slice(0, 6).join(', '));
