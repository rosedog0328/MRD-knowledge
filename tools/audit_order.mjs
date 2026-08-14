#!/usr/bin/env node
/* ============================================================================
   audit_order.mjs — 教學順序稽核
   ----------------------------------------------------------------------------
   抓四類問題：
     1. 詞彙「首次實質使用」的模組，比真正講解它的模組更早
        （tooltip 只能救急，不能取代講解）
     2. 單一模組一次引入太多新詞（認知負荷過重）
     3. 前向參照：用「後面會講」迴避當下該給的解釋
     4. 殘留的外部投影片引用

   用法：node tools/audit_order.mjs
   ============================================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

const modules = JSON.parse(fs.readFileSync(path.join(SRC, 'data/modules.json'), 'utf8'));
const glossary = JSON.parse(fs.readFileSync(path.join(SRC, 'data/glossary.json'), 'utf8'));

const bodies = modules.map((m) => {
  const f = path.join(SRC, 'modules', m.src);
  return { ...m, text: fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '' };
});

/* ---- 1 & 2：詞彙首次使用 ------------------------------------------------ */

const firstUse = new Map();
const perModuleNew = new Map();

bodies.forEach((m, i) => {
  const fresh = [];
  for (const term of Object.keys(glossary)) {
    const re = new RegExp(`\\[\\[${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\||\\]\\])`);
    if (!re.test(m.text)) continue;
    if (!firstUse.has(term)) { firstUse.set(term, i); fresh.push(term); }
  }
  perModuleNew.set(m.id, fresh);
});

/* 判斷某個詞在哪些模組「有被講解」：出現在 h2/h3 標題或 objectives 就算 */
function explainedIn(term) {
  const hits = [];
  bodies.forEach((m, i) => {
    const heads = [...m.text.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/g)].map((x) => x[1]);
    const fm = /^\s*<!--tw([\s\S]*?)-->/.exec(m.text)?.[1] || '';
    const hay = (heads.join(' ') + ' ' + fm).toLowerCase();
    if (hay.includes(term.toLowerCase())) hits.push(i);
  });
  return hits;
}

console.log('\n  ── 1. 詞彙在「講解它的模組」之前就被實質使用 ──\n');
let earlyUse = 0;
for (const [term, useIdx] of [...firstUse.entries()].sort((a, b) => a[1] - b[1])) {
  const ex = explainedIn(term);
  if (!ex.length) continue;
  const home = Math.min(...ex);
  if (useIdx < home) {
    earlyUse++;
    console.log(`    ${term.padEnd(24)} 首次用於 ${bodies[useIdx].id}，講解在 ${bodies[home].id}`);
  }
}
if (!earlyUse) console.log('    （無）');

console.log('\n  ── 2. 每個模組引入的新詞數量 ──\n');
for (const m of bodies) {
  const n = perModuleNew.get(m.id).length;
  console.log(`    ${m.id}  ${String(n).padStart(2)} ${'#'.repeat(Math.min(40, n))}`
    + (n > 14 ? '  <= 偏多' : ''));
}

/* ---- 3：前向參照 -------------------------------------------------------- */

console.log('\n  ── 3. 用「後面會講」迴避當下解釋 ──\n');
const dodge = [];
for (const m of bodies) {
  /* 冒號也算 —— 「M7 會詳談：」跟「M7 會詳談。」是同一種迴避 */
  const re = /[^。：<>]{0,60}M\d+\s*(?:會|詳談|再講|完整講|會看到|會談)[^。：]{0,40}[。：]/g;
  for (const mm of m.text.matchAll(re)) {
    dodge.push([m.id, mm[0].replace(/<[^>]+>/g, '').trim().slice(0, 76)]);
  }
}
if (!dodge.length) console.log('    （無）');
dodge.forEach(([id, s]) => console.log(`    ${id}  ...${s}`));

/* ---- 4：殘留的外部投影片引用 -------------------------------------------- */

console.log('\n  ── 4. 殘留的外部投影片引用 ──\n');
let leftover = 0;
for (const m of bodies) {
  const deck = (m.text.match(/Deck\s*[A-E]/g) || []).length;
  const slide = (m.text.match(/投影片/g) || []).length;
  const src = (m.text.match(/\{\{source/g) || []).length;
  const pw = (m.text.match(/data-part="where"/g) || []).length;
  if (deck + slide + src + pw === 0) continue;
  leftover++;
  console.log(`    ${m.id}  Deck x${deck}  投影片 x${slide}  {{source}} x${src}  where x${pw}`);
}
if (!leftover) console.log('    （無）');
console.log('');
