#!/usr/bin/env node
/* ============================================================================
   verify.mjs — file:// 安全 linter
   ----------------------------------------------------------------------------
   存在的唯一理由：

     fetch()、ESM、外部 SVG <use> 在 http://localhost 全部正常運作，
     在共用磁碟的 file:// 全部失效。

   所以「先在 localhost 測過了」不是證據 —— 那正是會靜默出貨的那一類 bug。
   這支腳本把那些差異變成 build-time 錯誤。

   用法：node tools/verify.mjs   （exit 0 才可以出貨）
   ============================================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUARD_TOPICS } from './guards.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const SRC = path.join(ROOT, 'src');

const fails = [];
const warns = [];
const fail = (f, m) => fails.push(`${f}: ${m}`);
const warn = (f, m) => warns.push(`${f}: ${m}`);

const rel = (f) => path.relative(ROOT, f);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(SITE);
const html = files.filter((f) => f.endsWith('.html'));
const js = files.filter((f) => f.endsWith('.js'));
const css = files.filter((f) => f.endsWith('.css'));

/* 建一份小寫檔名索引，用來做大小寫敏感的存在性檢查。
   macOS 預設不分大小寫，但共用磁碟／Linux 會分 —— 這種 bug 只在別人電腦上爆。 */
const onDisk = new Set(files.map((f) => path.relative(SITE, f)));
const onDiskLower = new Map(files.map((f) => [path.relative(SITE, f).toLowerCase(),
                                              path.relative(SITE, f)]));

/* ── 1. shipped JS 不得出現 fetch / XHR / ESM ─────────────────────────── */

for (const f of js) {
  const s = fs.readFileSync(f, 'utf8');
  const src = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  if (/\bfetch\s*\(/.test(src))            fail(rel(f), 'file:// 會擋 fetch()，資料請改用 *.data.js 全域變數');
  if (/\bXMLHttpRequest\b/.test(src))      fail(rel(f), 'file:// 會擋 XMLHttpRequest');
  if (/^\s*import\s/m.test(src))           fail(rel(f), 'file:// 不支援 ESM import，請用 classic script');
  if (/^\s*export\s/m.test(src))           fail(rel(f), 'file:// 不支援 ESM export');
  if (/\bimport\s*\(/.test(src))           fail(rel(f), 'file:// 不支援動態 import()');
}

for (const f of html) {
  const s = fs.readFileSync(f, 'utf8');
  if (/<script[^>]+type\s*=\s*["']module["']/.test(s)) {
    fail(rel(f), '<script type="module"> 在 file:// 會被擋');
  }
}

/* ── 2. 不得有 CDN / 外部資源 ─────────────────────────────────────────── */

const EXTERNAL = /(?:src|href)\s*=\s*["']https?:\/\/[^"']+["']/gi;
for (const f of [...html, ...css]) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(EXTERNAL)) {
    /* 純文字連結（<a href="https://...">）是允許的，只有會載入資源的才擋 */
    if (/^src/i.test(m[0])) fail(rel(f), `外部資源會在離線時失效：${m[0].slice(0, 70)}`);
  }
  for (const m of s.matchAll(/@import\s+(?:url\()?["']?https?:/gi)) {
    fail(rel(f), '@import 外部樣式表');
  }
  for (const m of s.matchAll(/url\(\s*["']?https?:\/\/[^)]*\)/gi)) {
    fail(rel(f), `CSS url() 指向外部主機：${m[0].slice(0, 60)}`);
  }
}

/* ── 3. 絕對路徑會解析到檔案系統根目錄 ───────────────────────────────── */

for (const f of [...html, ...css]) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/(?:src|href)\s*=\s*["']\/(?!\/)[^"']*["']/g)) {
    fail(rel(f), `絕對路徑在 file:// 會指到檔案系統根目錄：${m[0].slice(0, 60)}`);
  }
}

/* ── 4. @font-face 相對路徑在 file:// 載不到 ─────────────────────────── */

for (const f of css) {
  const s = fs.readFileSync(f, 'utf8');
  if (/@font-face/.test(s)) {
    fail(rel(f), '@font-face 在 file:// 無法載入，請只用系統字型堆疊');
  }
}

/* ── 5. 外部 SVG <use> 在 file:// 被擋 ───────────────────────────────── */

for (const f of html) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/<use\b[^>]*(?:xlink:)?href\s*=\s*["']([^"'#]+)#/g)) {
    fail(rel(f), `外部 SVG sprite 在 file:// 被擋：<use href="${m[1]}#…">，符號必須 inline 進頁面`);
  }
}

/* ── 6. 引用的檔案要真的存在（大小寫敏感） ───────────────────────────── */

for (const f of html) {
  const s = fs.readFileSync(f, 'utf8');
  const dir = path.dirname(f);
  for (const m of s.matchAll(/(?:src|href)\s*=\s*["']([^"':#?][^"':]*?)["']/g)) {
    const target = m[1].split(/[?#]/)[0];
    if (!target || /^(https?|mailto|data|tel):/i.test(target)) continue;
    const abs = path.resolve(dir, target);
    const r = path.relative(SITE, abs);
    if (r.startsWith('..')) { fail(rel(f), `引用到 site/ 之外：${target}`); continue; }
    if (!onDisk.has(r)) {
      if (onDiskLower.has(r.toLowerCase())) {
        fail(rel(f), `大小寫不符：引用 ${r}，磁碟上是 ${onDiskLower.get(r.toLowerCase())}` +
                     `（macOS 不分大小寫，但共用磁碟／Linux 會分）`);
      } else {
        fail(rel(f), `引用的檔案不存在：${target}`);
      }
    }
  }
}

/* ── 7. 產出檔名不得含非 ASCII（SMB/exFAT 正規化遲早弄壞） ──────────── */

for (const f of files) {
  const base = path.basename(f);
  // eslint-disable-next-line no-control-regex
  if (/[^\x20-\x7E]/.test(base)) {
    fail(rel(f), '檔名含非 ASCII 字元，在 SMB／exFAT 上會被正規化弄壞');
  }
  if (/\s/.test(base)) warn(rel(f), '檔名含空白，建議避免');
}

/* ── 8. SVG 品質：title/desc、字面色碼、同頁 id 撞名 ─────────────────── */

const svgSrc = walk(path.join(SRC, 'svg')).filter((f) => f.endsWith('.svg'));
for (const f of svgSrc) {
  const s = fs.readFileSync(f, 'utf8');
  const isDefs = path.basename(f) === '_defs.svg';
  if (!isDefs) {
    if (!/<title[\s>]/.test(s)) fail(rel(f), '缺 <title>（螢幕閱讀器必要）');
    if (!/<desc[\s>]/.test(s))  fail(rel(f), '缺 <desc>（螢幕閱讀器必要）');
    if (!/viewBox\s*=\s*"0 0 1000 /.test(s)) {
      warn(rel(f), 'viewBox 寬度不是 1000 —— 慣例是 "0 0 1000 H"，這樣線寬字級才能跨圖複製');
    }
    const noC = s.replace(/<!--[\s\S]*?-->/g, '');
    const lit = noC.match(/(?:fill|stroke|stop-color)\s*=\s*"(#[0-9a-fA-F]{3,8}|rgba?\()/g);
    if (lit) fail(rel(f), `出現字面色碼（${lit.length} 處）—— 顏色只能走 class → diagram.css → token`);
  }
}

/* 同一頁面內的 element id 撞名：兩張 inline SVG 的 gradient/marker 會靜默抓錯 def */
for (const f of html) {
  const s = fs.readFileSync(f, 'utf8');
  const ids = [...s.matchAll(/\sid\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set(), dup = new Set();
  for (const id of ids) { if (seen.has(id)) dup.add(id); seen.add(id); }
  if (dup.size) fail(rel(f), `同頁 id 重複：${[...dup].slice(0, 6).join(', ')}`);
}

/* ── 9. widget id 唯一、glossary 詞彙都有定義 ───────────────────────── */

const glossary = JSON.parse(fs.readFileSync(path.join(SRC, 'data', 'glossary.json'), 'utf8'));
const allWids = new Map();
for (const f of html) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/data-wid\s*=\s*"([^"]+)"/g)) {
    if (allWids.has(m[1])) fail(rel(f), `widget id 與 ${allWids.get(m[1])} 重複：${m[1]}`);
    allWids.set(m[1], rel(f));
  }
  for (const m of s.matchAll(/data-term\s*=\s*"([^"]+)"/g)) {
    if (!glossary[m[1]]) fail(rel(f), `詞彙未定義：${m[1]}`);
  }
}

/* 未被任何模組使用的詞彙（不是錯誤，但值得知道） */
const usedTerms = new Set();
for (const f of html) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/data-term\s*=\s*"([^"]+)"/g)) usedTerms.add(m[1]);
}
const unused = Object.keys(glossary).filter((k) => !usedTerms.has(k));
if (unused.length) warn('glossary.json', `${unused.length} 條詞彙尚未被任何模組引用：${unused.slice(0, 8).join('、')}${unused.length > 8 ? '…' : ''}`);

/* ── 10. 教材必須自成一體：不得引用外部投影片 ────────────────────────
   這份教材是獨立的，讀者不該需要去翻任何投影片才能看懂。
   這一項會擋掉 Deck 代號、投影片編號，以及「五份投影片」那類後設敘述。   */

const SELF_CONTAINED = [
  [/Deck\s*[A-E]\b/g, 'Deck 代號（讀者手上沒有那些投影片）'],
  [/投影片\s*\d/g, '投影片編號'],
  /* 原規則連「N 篇論文」一併擋掉，因為 lab-tutorial 的讀者手上沒有那些外部文件。
     本知識庫相反：11 篇論文本身就是主題，且原始檔就收在 docs/paper/ 內，
     讀者拿得到。因此此處只擋投影片／簡報，不擋論文。 */
  [/(?:五|四|三|兩|２|\d)\s*(?:份|篇)\s*(?:投影片|簡報)/g,
   '「五份投影片」這類指向讀者沒有的外部文件的說法'],
  [/(?:論文|投影片|簡報)的(?:投影片|內容|說明)/g, '指向外部文件'],
  /* 本知識庫的主題就是論文，因此「引用論文」不是缺陷 ——
     lab-tutorial 的原始規則是為了擋掉「叫讀者自己去看投影片」，
     那條在此處改為只擋投影片／簡報，不擋論文。 */
  [/看懂[^。]{0,12}(?:投影片|簡報)/g, '把終點定義成「看懂外部投影片」'],
  [/\bslide\s*\d/gi, 'slide 編號'],
];
for (const f of [...html, path.join(SRC, 'data/quizzes.json'), path.join(SRC, 'data/glossary.json')]) {
  if (!fs.existsSync(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  for (const [re, what] of SELF_CONTAINED) {
    const hits = s.match(re);
    if (hits) fail(rel(f), `出現${what}（${hits.length} 處，例：${hits[0]}）—— 教材必須自成一體`);
  }
}

/* ── 10.5 頁面結構不得重複 ────────────────────────────────────────────
   曾經發生過：內容裡的 grep 指令含有 `$'`，而 String.replace 的
   *替換字串* 會把 $' 解讀成「插入比對位置之後的全部內容」，
   於是整個 shell 尾巴被重新插了一次 —— core.js 被載入兩次，
   第二次把 widget 註冊表清空，該頁所有互動元件靜默失效。
   產生器已改用函式形式的替換，這裡是防回歸。                            */

for (const f of html) {
  const s = fs.readFileSync(f, 'utf8');
  for (const [tag, re] of [['</body>', /<\/body>/g], ['</html>', /<\/html>/g],
                           ['<!doctype', /<!doctype/gi]]) {
    const n = (s.match(re) || []).length;
    if (n > 1) fail(rel(f), `${tag} 出現 ${n} 次 —— 頁面結構重複（檢查替換字串裡的 $' 與 $\``);
  }
  const dupScript = {};
  for (const m of s.matchAll(/<script src="([^"]+)"/g)) {
    dupScript[m[1]] = (dupScript[m[1]] || 0) + 1;
  }
  const dups = Object.entries(dupScript).filter(([, n]) => n > 1);
  if (dups.length) {
    fail(rel(f), `同一支 JS 被載入多次：${dups.map(([k, n]) => `${k}×${n}`).join(', ')}` +
                 ` —— core.js 重複載入會清空 widget 註冊表`);
  }
}

/* ── 11. 十個「不要搞混」警告框必須全部就位 ──────────────────────────
   這十個處理的是新人一定會誤解、而且錯了會影響結論的地方。
   它們是本教材相對於原始素材最大的增值，改寫內容時很容易不小心刪掉 ——
   所以在這裡把它變成 build-time 錯誤。                                    */

const guardsFound = new Set();
for (const f of fs.existsSync(path.join(SRC, 'modules'))
  ? walk(path.join(SRC, 'modules')).filter((x) => x.endsWith('.html')) : []) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\{\{guard:(\d+)/g)) guardsFound.add(+m[1]);
}
const guardsMissing = Object.keys(GUARD_TOPICS).map(Number).filter((n) => !guardsFound.has(n));
if (guardsMissing.length) {
  for (const n of guardsMissing) {
    fail('src/modules/', `缺少 guardrail #${n}（${GUARD_TOPICS[n]}）` +
      ` —— 這些警告框必須全部就位，這是本教材最大的增值`);
  }
}
/* 反向也要擋：用了名冊上沒有的編號，頁面照樣渲染成「重要區分 #N」，
   但它不受這一項保護 —— 下一次改寫就可能靜靜地消失。 */
const guardsUnknown = [...guardsFound].filter((n) => !GUARD_TOPICS[n]).sort((a, b) => a - b);
for (const n of guardsUnknown) {
  fail('src/modules/', `用了未登記的 guardrail #${n}` +
    ` —— 請在 tools/guards.mjs 的 GUARD_TOPICS 補上，否則它不受第 11 項保護`);
}

/* ── 12. presentation attribute 不得跟 diagram.css 的宣告撞名 ──────────
   踩過才加的一項。CSS 有一條反直覺的規則：<b>樣式表裡的宣告一律贏過
   presentation attribute</b>（後者相當於 specificity 0），跟寫在哪裡無關。
   所以這一行畫出來是灰色，不是紅色：

     <line class="conn" stroke="var(--bad)"/>       ← stroke 被 .conn 蓋掉

   而且它<b>不會有任何錯誤訊息</b> —— 顏色就是靜靜地錯了。全專案曾經有
   78 處這種寫法。正確作法二選一：
     · 有語意的狀態色 → 在 diagram.css 開一個 class（.conn.bad …）
     · 一次性的數值   → 寫進 style=""（inline style 才贏得過樣式表）   */

const diagCss = fs.readFileSync(path.join(SITE, 'assets', 'css', 'diagram.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/* selector → 它宣告了哪些 property */
const cssRules = [];
for (const m of diagCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const props = new Set(
    m[2].split(';').filter((d) => d.includes(':')).map((d) => d.split(':')[0].trim()));
  for (const one of m[1].split(',')) {
    const sel = one.trim();
    if (!sel.startsWith('.dia-svg')) continue;
    const cls = [...sel.replace('.dia-svg', '').matchAll(/\.([\w-]+)/g)].map((x) => x[1]);
    if (cls.length) cssRules.push([cls, props]);
  }
}

const PRESENTATION = new Set([
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity',
  'font-size', 'font-weight', 'font-family', 'text-anchor',
]);

for (const f of fs.existsSync(path.join(SRC, 'svg'))
  ? fs.readdirSync(path.join(SRC, 'svg')).filter((x) => x.endsWith('.svg') && !x.startsWith('_'))
  : []) {
  const s = fs.readFileSync(path.join(SRC, 'svg', f), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '');
  for (const el of s.matchAll(/<(\w+)((?:[^>"]|"[^"]*")*?)>/g)) {
    const attrs = el[2];
    const cm = attrs.match(/class="([^"]*)"/);
    if (!cm) continue;
    const classes = cm[1].split(/\s+/).filter(Boolean);
    const styled = new Set();
    for (const [need, props] of cssRules) {
      if (need.every((c) => classes.includes(c))) for (const p of props) styled.add(p);
    }
    const sm = attrs.match(/style="([^"]*)"/);
    const inStyle = new Set(sm
      ? sm[1].split(';').filter((d) => d.includes(':')).map((d) => d.split(':')[0].trim())
      : []);
    for (const am of attrs.matchAll(/\s([a-z-]+)="([^"]*)"/g)) {
      const [, prop, val] = am;
      if (!PRESENTATION.has(prop) || !styled.has(prop) || inStyle.has(prop)) continue;
      fail(`src/svg/${f}`, `<${el[1]} class="${cm[1]}"> 的 ${prop}="${val}"` +
        ` 會被 diagram.css 蓋掉（樣式表贏過 presentation attribute）` +
        ` —— 改成 class 或寫進 style=""`);
    }
  }
}

/* 12b. 同一條規則也要蓋到「用 JS 畫出來的 SVG」。
   手繪的 .svg 檔早就在管了，但 widget 是在瀏覽器裡用 TW.svg() 生出來的，
   一直沒有人檢查 —— 於是同一個錯誤在 8 個地方活了下來，包括 pr-threshold
   那條「門檻線」被 .axis 蓋成跟座標軸一模一樣的灰色。

   （順帶記一筆，免得下次又有人推論錯：presentation attribute 裡的 var()
   是<b>可以</b>被代換的，Chrome 151 實測 stroke="var(--rule)" 會正確拿到
   #D3DAE1。所以 stroke="var(--bad)" 畫出來不是紅色時，原因永遠是上面那條
   「樣式表贏過 attribute」，不是 var() 失效 —— 只要那個 class 在
   diagram.css 裡宣告過同名 property 就會發生。）                          */

for (const f of js) {
  const s = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rel = path.relative(ROOT, f);

  /* TW.svg('tag', { class: 'x y', stroke: '…' }) —— 只看第一層的物件字面 */
  for (const call of s.matchAll(/TW\.svg\(\s*'(\w+)'\s*,\s*\{([^{}]*)\}/g)) {
    const [, tag, body] = call;
    const cm = body.match(/'?class'?\s*:\s*'([^']*)'/);
    if (!cm) continue;
    const classes = cm[1].split(/\s+/).filter(Boolean);
    const styled = new Set();
    for (const [need, props] of cssRules) {
      if (need.every((c) => classes.includes(c))) for (const p of props) styled.add(p);
    }
    for (const am of body.matchAll(/'?([a-z-]+)'?\s*:\s*('[^']*'|[^,]+)/g)) {
      const [, prop, raw] = am;
      if (!PRESENTATION.has(prop) || !styled.has(prop)) continue;
      fail(rel, `TW.svg('${tag}', { class: '${cm[1]}', ${prop}: ${raw.trim()} })` +
        ` 的 ${prop} 會被 diagram.css 蓋掉 —— 改成 class 或寫進 style=""`);
    }
  }

  /* 同一個錯誤的第二種寫法：先 TW.text()／TW.svg() 拿到節點，
     再 el.setAttribute('font-size', …)。attribute 一樣輸給樣式表，
     所以 .lbl（22px）上面設 font-size="54" 是完全沒有作用的。
     踩過才知道：loh-sim 的 heterozygosity 大字就是這樣被縮回 22px 的。 */
  const nodeClass = new Map();
  /* class 常常是拼出來的（'lbl mid bold mono ' + (het ? 'ok' : 'bad')）；
     只取靜態前綴就夠了 —— 動態尾綴只會再加 class，不會拿掉宣告。 */
  for (const m of s.matchAll(
    /(\w+)\s*=\s*TW\.text\([^;]*?,\s*'([^']*)'\s*(?:\+[^,;]*?)?,\s*\w+\s*\)/g)) {
    nodeClass.set(m[1], m[2]);
  }
  for (const m of s.matchAll(/(\w+)\s*=\s*TW\.svg\(\s*'\w+'\s*,\s*\{([^{}]*)\}/g)) {
    const cm = m[2].match(/'?class'?\s*:\s*'([^']*)'/);
    if (cm) nodeClass.set(m[1], cm[1]);
  }
  for (const m of s.matchAll(/(\w+)\.setAttribute\(\s*'([a-z-]+)'\s*,\s*('[^']*'|[^)]+)\)/g)) {
    const [, name, prop, raw] = m;
    if (!PRESENTATION.has(prop) || !nodeClass.has(name)) continue;
    const classes = nodeClass.get(name).split(/\s+/).filter(Boolean);
    const styled = new Set();
    for (const [need, props] of cssRules) {
      if (need.every((c) => classes.includes(c))) for (const p of props) styled.add(p);
    }
    if (!styled.has(prop)) continue;
    fail(rel, `${name}.setAttribute('${prop}', ${raw.trim()}) —— ${name} 是` +
      ` class="${nodeClass.get(name)}"，${prop} 已由 diagram.css 宣告，attribute 不會生效。` +
      ` 改用 ${name}.style`);
  }

}

/* ── 13. 產出的 HTML 不得殘留沒展開的 macro 或詞彙標記 ───────────────────
   踩過才加的一項。build.mjs 的第 9 步（[[term]]）要能看到文字才展開得了，
   而 {{svg:}} / {{fig:}} / {{widget:}} 會先把整塊圖 stash 起來。圖說一旦
   被一起 stash，[[soft clipping]] 就會原樣印在頁面上 —— <b>而且沒有任何
   錯誤訊息</b>，因為對 build 來說那只是一段普通文字。
   曾經同時漏在 m08 與 m13 的圖說裡，靠眼睛看沒發現。                     */

for (const f of html) {
  const s = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f);
  for (const m of s.matchAll(/\[\[[^\]\n]{1,60}\]\]/g)) {
    fail(rel, `殘留沒展開的詞彙標記 ${m[0]} —— 多半是寫在被 stash 的區塊裡`);
  }
  for (const m of s.matchAll(/\{\{[^}\n]{1,60}\}\}/g)) {
    fail(rel, `殘留沒展開的 macro ${m[0]}`);
  }
}

/* ── 13.5 MathML 標籤必須完整配對 ──────────────────────────────────────
   為什麼需要這一項：MathML 沒有 void element，每個標籤都要收。
   但 HTML parser 對沒收的標籤非常寬容 —— 少一個 </mrow> 不會有錯誤、
   不會有警告，它只會把後面的內容一路吞進那個沒關的元素裡，
   於是式子後面整段內文靜靜消失。這跟 check_svg_layout.py 擋的
   「漏一個 </text>」是同一類問題，只是換到 <math> 上。

   另外擋掉字面的 < 與 > ：MathML 裡要寫 &lt; / &gt;，
   直接寫 < 會被 parser 當成標籤開頭，同樣是靜默壞掉。          */

const MATHML_VOID = new Set(['mspace', 'mprescripts', 'none']);

for (const f of html) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/<math\b[\s\S]*?<\/math>/g)) {
    const frag = m[0];
    const stack = [];
    let broken = null;
    for (const t of frag.matchAll(/<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g)) {
      const [, close, name, selfClose] = t;
      if (selfClose || MATHML_VOID.has(name)) continue;
      if (close) {
        if (stack.pop() !== name) { broken = `</${name}> 沒有對應的開始標籤`; break; }
      } else {
        stack.push(name);
      }
    }
    if (!broken && stack.length) broken = `${stack.map((x) => `<${x}>`).join(' ')} 沒有收`;
    if (broken) {
      fail(rel(f), `MathML 標籤沒配對好：${broken} —— HTML parser 會靜默吞掉後面的內容`);
    }
    /* <mo>&lt;</mo> 才對；直接寫 <mo><</mo> 會被當成標籤 */
    const bare = frag.match(/<m[a-z]+>\s*[<>]\s*<\/m/g);
    if (bare) fail(rel(f), `MathML 裡有字面的 < 或 >，要寫成 &lt; / &gt;（${bare.length} 處）`);
  }
}

/* ── 13.8 數學不得留在 <code> 裡 ─────────────────────────────────────────
   `components.css` 的 .eq 註解已經寫過理由：ASCII 公式只能用空白硬湊對齊，
   讀者一改字級或換字型就散掉，而且不會有任何錯誤訊息。
   但手寫 MathML 太長，所以式子很容易退化成
   <code>c_k ≥ Σ_{j∈S} c_j</code> 這種「看起來像 LaTeX 的純文字」——
   sr2 整頁都這樣寫過一輪。tools/mathml.mjs 就是為了拿掉那個藉口，
   所以這一項擋的是「明明可以寫成 {{m: …}} 卻留在 <code> 裡」。

   判準刻意抓得保守：要同時有數學運算子（或下標語法）而且不像 shell／程式碼。
   HP:i:1、GT:0/1、chr1:1000-2000 這類欄位值不該被誤判，所以先排除。   */

const MATH_SIGN = /[≥≤≠∈∑∏≈∝√±×÷·⋅]|_\{|\^\{/;
const LOOKS_CODE = /(^|\n)\s*(\$|#|python3?|samtools|bcftools|awk|sed|grep|longphase|node|npm|for |while |if |wget|curl|import |print|docker|minimap|whatshap|bgzip|tabix|report:|def |return )/;
const FIELDY = /^[\w.-]+:[\w./-]+$|^[A-Z]{2,}:[a-z]:/;   /* HP:i:1、chr1:100-200 */

for (const f of html) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/<code>([\s\S]*?)<\/code>/g)) {
    const body = m[1].replace(/<[^>]+>/g, '').trim();
    if (!MATH_SIGN.test(body) || LOOKS_CODE.test(body) || FIELDY.test(body)) continue;
    fail(rel(f), `數學留在 <code> 裡：「${body.slice(0, 46)}」` +
                 ` —— 改用 {{m: …}}（行內）或 {{eq}}…{{/eq}}（獨立一行），語法見 tools/mathml.mjs`);
  }
}

/* ── 13.9 圖說標籤必須成對 ───────────────────────────────────────────────
   實際踩過：{{svg:… | 圖說}} 的圖說裡放了 {{m: …}}，而當時的 macro 用
   ([^}]*) 抓圖說，於是在式子的第一個 } 就截斷。後半段變成裸文字，
   再被 {{m: …}} 的掃描器一路吃到 macro 的收尾 }}，
   把 </figcaption></figure> 整個吞進 MathML。

   為什麼非得寫成檢查項：頁面「看起來還是好的」—— HTML parser 會自行收尾，
   所以不會有錯誤、不會有警告，只是圖說從中間消失、後面的版面全部位移。
   m11 與 sr1 就是這樣出貨的，而且沒有人發現。
   標籤數量對不上是這個 bug 最便宜的指紋，不管成因是什麼都抓得到。         */

for (const f of html) {
  const s = fs.readFileSync(f, 'utf8');
  const open = (s.match(/<figcaption>/g) || []).length;
  const close = (s.match(/<\/figcaption>/g) || []).length;
  if (open !== close) {
    fail(rel(f), `<figcaption> ${open} 個、</figcaption> ${close} 個 —— 圖說標籤不成對` +
                 `（常見成因：圖說裡的 {{m: …}} 把 macro 截斷，圖說後半被吞進 MathML）`);
  }
}

/* ── 14. 大小預算 ────────────────────────────────────────────────────── */

let total = 0;
for (const f of files) total += fs.statSync(f).size;
const mb = total / 1024 / 1024;
if (mb > 40) fail('site/', `總大小 ${mb.toFixed(1)} MB 超過 40 MB 預算`);
else if (mb > 25) warn('site/', `總大小 ${mb.toFixed(1)} MB，接近 25 MB 警戒線`);

/* ── 報告 ───────────────────────────────────────────────────────────── */

console.log(`\n  檢查 ${files.length} 個檔案（${html.length} HTML · ${js.length} JS · ${css.length} CSS）` +
            ` · ${mb.toFixed(2)} MB`);

if (warns.length) {
  console.log(`\n  ⚠ ${warns.length} 個警告`);
  warns.forEach((w) => console.log(`    · ${w}`));
}

if (fails.length) {
  console.error(`\n  ✗ ${fails.length} 項未通過 —— 不可出貨\n`);
  fails.forEach((e) => console.error(`    · ${e}`));
  console.error('');
  process.exit(1);
}

console.log(`\n  ✓ file:// 安全檢查全數通過\n`);
