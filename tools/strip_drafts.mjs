#!/usr/bin/env node
/* ============================================================================
   strip_drafts.mjs — 把 draft 頁面從「要發布的 site/」裡拿掉
   ----------------------------------------------------------------------------
   modules.json 標了 "draft": true 的模組，build.mjs 照樣產生頁面
   （本機 file:// 讀得到，CI 的 site/↔src/ 比對也才不會因為少一個檔案而失敗），
   但它不出現在首頁、學習路徑、print-all、pager 與 glossary 的任何連結上。

   這支只做最後一步：在 CI 上傳 Pages artifact **之前**把檔案刪掉。
   一定要跑在「site/ 必須跟 src/ 同步」那一步之後，先刪就會判定不同步。

   ★ 這是「未列出」，不是「私密」★
   repo 是公開的，src/modules/ 的原始檔與 commit 進來的 site/ 產出照樣讀得到。
   要真的不公開，就不能把它 commit 進這個 repo。

   ★ 為什麼要順便掃殘留連結 ★
   漏掉一處連結的話，Pages 上就是一個 404，而且**本機完全測不出來** ——
   本機的 site/ 有那個檔案，點下去一切正常。這種只在線上出現的壞連結
   沒有任何一支既有工具會抓到，所以在刪檔的同一支工具裡當場驗。

   用法：node tools/strip_drafts.mjs           真的刪（CI 用）
         node tools/strip_drafts.mjs --check   只檢查不刪（本機用）
   ============================================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const checkOnly = process.argv.includes('--check');

const modules = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/modules.json'), 'utf8'));
const drafts = modules.filter((m) => m.draft);

if (!drafts.length) {
  console.log('  沒有 draft 頁面');
  process.exit(0);
}

/* 遞迴收集 site/ 底下所有文字檔，連 assets/data/*.data.js 也要掃 ——
   modules.data.js 若還留著 draft 的 id，首頁的 JS 就會把它畫回卡片上。 */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(html|js|json|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

const targets = new Set(drafts.map((m) => path.join(SITE, `${m.id}.html`)));
const files = walk(SITE).filter((f) => !targets.has(f));

let bad = 0;
for (const m of drafts) {
  const page = path.join(SITE, `${m.id}.html`);

  const refs = files.filter((f) => {
    const s = fs.readFileSync(f, 'utf8');
    return s.includes(`${m.id}.html`) || new RegExp(`"id"\\s*:\\s*"${m.id}"`).test(s);
  });
  if (refs.length) {
    bad += refs.length;
    for (const r of refs) {
      console.log(`::error::${path.relative(ROOT, r)} 仍指向 draft 模組 ${m.id}` +
                  ` —— 發布後會是 404 或把它列回導覽面`);
    }
  }

  if (checkOnly) {
    console.log(`  ${m.id}.html ${fs.existsSync(page) ? '存在（--check 不刪）' : '不存在'}`);
  } else if (fs.existsSync(page)) {
    fs.unlinkSync(page);
    console.log(`  不發布 ${path.relative(ROOT, page)}`);
  } else {
    console.log(`  ${path.relative(ROOT, page)} 不存在，略過`);
  }
}

if (bad) {
  console.log(`\n  ✗ ${bad} 處殘留連結`);
  process.exit(1);
}
console.log(`  ✓ ${drafts.length} 篇 draft，沒有任何殘留連結`);
