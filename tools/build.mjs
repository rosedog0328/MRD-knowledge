#!/usr/bin/env node
/* ============================================================================
   build.mjs — 零依賴靜態產生器
   ----------------------------------------------------------------------------
   src/modules/*.html  →  site/*.html
   src/data/*.json     →  site/assets/data/*.data.js   （不是 .json！）

   為什麼需要 build step：只有這樣才能讓 35 張 SVG 同時是
     (a) 可獨立開啟／預覽／編輯的 .svg 檔，而且
     (b) inline 進頁面所以 CSS variable 主題化生效。
   沒有 build 就只能二選一。

   為什麼資料是 .data.js 而不是 .json：
     file:// 是 opaque origin，fetch() 一律被擋。

   用法：
     node tools/build.mjs           一次性建置
     node tools/build.mjs --watch   監看 src/ 變動自動重建
   ============================================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUARD_TOPICS } from './guards.mjs';
import { toMathML } from './mathml.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const SITE = path.join(ROOT, 'site');

const P = {
  modules: path.join(SRC, 'modules'),
  partials: path.join(SRC, 'partials'),
  svg: path.join(SRC, 'svg'),
  data: path.join(SRC, 'data'),
  outData: path.join(SITE, 'assets', 'data'),
  img: path.join(SITE, 'assets', 'img'),
};

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

const read = (f) => fs.readFileSync(f, 'utf8');
const exists = (f) => fs.existsSync(f);

/* 五段式區塊的標題與編號。
   第五段採用「實作練習」—— 這份教材是獨立的，
   讀者不需要（也不應該需要）去翻任何投影片才能看懂。 */
const PARTS = {
  why:      { n: '①', zh: '為什麼重要' },
  concept:  { n: '②', zh: '概念與互動' },
  evidence: { n: '③', zh: '真實資料與證據' },
  predict:  { n: '④', zh: '預測與結果檢視' },
  practice: { n: '⑤', zh: '實作練習' },
};

/* ---------------------------------------------------------------- 小工具 -- */

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const slugify = (s) => String(s)
  .toLowerCase()
  .replace(/<[^>]+>/g, '')
  .replace(/[^\w一-鿿]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'sec';

/* 把 tooltip 的內容整塊拿掉，只留下讀者實際看到的那幾個字。
   ★ 為什麼不能用 regex ★
   .term__pop 裡面還有 <span class="term__def">，非貪婪的
   /<span class="term__pop"[\s\S]*?<\/span>/ 會停在「內層」的 </span>，
   把兩份定義的文字留下來。所以要自己數 <span> 的巢狀深度。

   沒有這一步的後果（實際發生過）：標題若以 [[term]] 開頭，
   目錄項目就會變成整段中英文定義加上「完整條目 →」，
   heading id 也跟著變成兩百多個字元。m03 / m05 / m10 都中招。 */
function stripPops(html) {
  const OPEN = '<span class="term__pop"';
  let out = html, i;
  while ((i = out.indexOf(OPEN)) >= 0) {
    let depth = 0, j = i;
    const re = /<(\/?)span\b/g;
    re.lastIndex = i;
    let m;
    while ((m = re.exec(out))) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) { j = out.indexOf('>', m.index) + 1; break; }
    }
    if (depth !== 0) break;            /* 標籤沒配對好就別亂剪 */
    out = out.slice(0, i) + out.slice(j);
  }
  return out;
}

/* 把不該被後續 macro 碰到的區塊（pre/code/已展開的 svg）先抽出來換成 token，
   全部處理完再放回去。這是讓 [[term]] 不會污染程式碼區塊的關鍵。 */
class Stash {
  constructor() { this.items = []; }
  /* 哨兵用 \uE000（私用區）而不是 NUL：NUL 會讓 git 把這個檔案當成 binary，
     diff 與 grep 就全都失效了。 */
  put(html) { this.items.push(html); return `\uE000STASH${this.items.length - 1}\uE000`; }
  restore(html) {
    return html.replace(/\uE000STASH(\d+)\uE000/g, (_, i) => this.items[+i]);
  }
}

/* {{svg:name | 圖說}} 的掃描器。圖說可以含巢狀的 {{m: …}}，所以收尾的 }}
   要自己數深度找，不能交給 regex —— 理由見呼叫端的註解。
   fn(name, caption) 回傳要替換進去的 HTML。 */
function replaceSvgMacro(s, fn) {
  const OPEN = '{{svg:';
  for (let i = s.indexOf(OPEN); i >= 0; i = s.indexOf(OPEN, i)) {
    const m = /^\{\{svg:([\w-]+)\s*(\|)?/.exec(s.slice(i));
    if (!m) { i += OPEN.length; continue; }
    let j = i + m[0].length, depth = 0, end = -1;
    while (j < s.length) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') {
        if (depth > 0) depth--;
        else if (s[j + 1] === '}') { end = j; break; }
      }
      j++;
    }
    if (end < 0) { i += OPEN.length; continue; }  /* 沒收尾 → 交給「未知 macro」那一關報錯 */
    const out = fn(m[1], m[2] ? s.slice(i + m[0].length, end) : '');
    s = s.slice(0, i) + out + s.slice(end + 2);
    i += out.length;
  }
  return s;
}

/* {{m: 式子}} → MathML。
   ★ 這裡不能用 regex ★ 式子本身就含大括號（\frac{a}{b}、\hat{φ}），
   所以 /\{\{m:(.*?)\}\}/ 會停在 "…{b}" 的那個 }} 上，把式子剪斷。
   要自己數深度，並且跳過 \{ \} 這種跳脫。
   wrap 讓呼叫端決定要不要把結果收進 stash（模組內文要，glossary 不用）。 */
function expandInlineMath(s, where, wrap = (x) => x) {
  for (let i = s.indexOf('{{m:'); i >= 0; i = s.indexOf('{{m:', i)) {
    let j = i + 4, depth = 0, end = -1;
    while (j < s.length) {
      if (s[j] === '\\') { j += 2; continue; }
      if (s[j] === '{') depth++;
      else if (s[j] === '}') {
        if (depth > 0) depth--;
        else if (s[j + 1] === '}') { end = j; break; }
      }
      j++;
    }
    if (end < 0) { err(where, `{{m: …}} 沒有收尾`); break; }
    const src = s.slice(i + 4, end).trim();
    let out;
    try { out = wrap(toMathML(src, false)); }
    catch (e) { err(where, `${e.message}（{{m: ${src}}}）`); out = wrap(`<code>${esc(src)}</code>`); }
    s = s.slice(0, i) + out + s.slice(end + 2);
    i += out.length;
  }
  return s;
}

/* JSON 裡的字串（glossary 定義、quiz 題幹與解說）也要能寫數學 */
function expandMathDeep(node, where) {
  if (typeof node === 'string') return expandInlineMath(node, where);
  if (Array.isArray(node)) return node.map((x) => expandMathDeep(x, where));
  if (node && typeof node === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(node)) o[k] = expandMathDeep(v, where);
    return o;
  }
  return node;
}

/* ------------------------------------------------------------ SVG inline -- */

/**
 * 讀 src/svg/<name>.svg，做四件事：
 *   1. 剝掉 XML prolog / DOCTYPE / 外層註解
 *   2. 檢查 <title> 與 <desc>（無障礙必要，缺就 build 失敗）
 *   3. 檢查是否有字面色碼（_defs.svg 以外一律禁止）
 *   4. ★ 把檔案內部定義的 id 全部加上前綴，並改寫 url(#x) / href="#x"
 *      —— 沒有這一步，同一頁 35 張 SVG 的 gradient/marker 會靜默抓錯 def，
 *         這是最難查的 bug。
 * 回傳 { svg, symbols } —— symbols 是它引用到的 _defs 符號集合。
 */
function inlineSvg(name, where) {
  const file = path.join(P.svg, `${name}.svg`);
  if (!exists(file)) { err(where, `找不到 SVG：src/svg/${name}.svg`); return null; }

  let s = read(file);
  s = s.replace(/<\?xml[\s\S]*?\?>/g, '')
       .replace(/<!DOCTYPE[\s\S]*?>/gi, '');

  if (!/<title[\s>]/i.test(s) || !/<desc[\s>]/i.test(s)) {
    err(where, `src/svg/${name}.svg 缺 <title> 或 <desc>（螢幕閱讀器必要）`);
  }

  /* 字面色碼檢查：註解裡的不算 */
  const noComments = s.replace(/<!--[\s\S]*?-->/g, '');
  const lit = noComments.match(/(?:fill|stroke|stop-color)\s*=\s*"(#[0-9a-f]{3,8}|rgba?\([^"]*\))"/gi);
  if (lit) {
    err(where, `src/svg/${name}.svg 出現字面色碼 ${lit.slice(0, 3).join(', ')}` +
               ` —— 顏色只能走 class → diagram.css → token`);
  }

  /* ★ HTML 破框標籤檢查 ★
     inline SVG 是走 HTML parser 的「foreign content」模式，而 HTML 規格對
     b / i / em / strong / code / span / p / br / sub / sup … 這一票標籤有一條
     特例：在 foreign content 裡遇到它們，parser 會「往上彈出元素直到離開
     foreign content」—— 也就是把 <svg> 整個關掉，後面全部當 HTML 解析。
     結果就是圖從破框那一行開始整個消失，而且 **沒有任何錯誤訊息**。
     （<title> 與 <desc> 是 HTML integration point，裡面寫 HTML 標籤是合法的，
       所以先把這兩塊挖掉再檢查。）
     要在 <text> 裡做粗體，用 <tspan class="bold">。 */
  const BREAKOUT = ['b','big','blockquote','body','br','center','code','dd','div',
    'dl','dt','em','embed','h1','h2','h3','h4','h5','h6','head','hr','i','img',
    'li','listing','menu','meta','nobr','ol','p','pre','ruby','s','small','span',
    'strong','strike','sub','sup','table','tt','u','ul','var'];
  const outsideProse = noComments
    .replace(/<title\b[\s\S]*?<\/title>/gi, '')
    .replace(/<desc\b[\s\S]*?<\/desc>/gi, '');
  const bad = [...new Set(
    [...outsideProse.matchAll(new RegExp(`<(${BREAKOUT.join('|')})\\b[^>]*>`, 'gi'))]
      .map((m) => `<${m[1].toLowerCase()}>`))];
  if (bad.length) {
    err(where, `src/svg/${name}.svg 在 <title>／<desc> 之外用了 HTML 標籤 ` +
               `${bad.slice(0, 4).join(', ')} —— HTML parser 會在這裡把 <svg> ` +
               `整個關掉，圖從該行起消失且不報錯。粗體請改用 <tspan class="bold">`);
  }

  /* 這張圖引用到哪些共用符號 */
  const symbols = new Set();
  for (const m of noComments.matchAll(/(?:xlink:)?href\s*=\s*"#(sym-[\w-]+)"/g)) symbols.add(m[1]);
  for (const m of noComments.matchAll(/url\(#(arrow[\w-]*|pat-[\w-]+)\)/g)) symbols.add(m[1]);
  for (const m of noComments.matchAll(/marker-(?:start|mid|end)\s*=\s*"url\(#([\w-]+)\)"/g)) symbols.add(m[1]);

  /* 檔案內部自己定義的 id → 加前綴 */
  const own = new Set();
  for (const m of s.matchAll(/\sid\s*=\s*"([^"]+)"/g)) own.add(m[1]);
  const pfx = `${name.replace(/[^\w-]/g, '_')}__`;
  if (own.size) {
    s = s.replace(/(\sid\s*=\s*")([^"]+)(")/g,
      (_, a, id, b) => own.has(id) ? `${a}${pfx}${id}${b}` : `${a}${id}${b}`);
    s = s.replace(/url\(#([^)"]+)\)/g,
      (m0, id) => own.has(id) ? `url(#${pfx}${id})` : m0);
    s = s.replace(/((?:xlink:)?href\s*=\s*")#([^"]+)(")/g,
      (m0, a, id, b) => own.has(id) ? `${a}#${pfx}${id}${b}` : m0);
    s = s.replace(/(aria-labelledby\s*=\s*")([^"]+)(")/g,
      (_, a, ids, b) => `${a}${ids.split(/\s+/).map(i => own.has(i) ? pfx + i : i).join(' ')}${b}`);
  }

  /* ★ 把 <title>／<desc> 接到根 <svg> 上 ★
     光有 <title> 與 <desc> 是不夠的：role="img" 的元素若沒有 aria-labelledby，
     螢幕閱讀器多半只會唸一句「圖片」。<desc> 的支援更差，幾乎一定要靠
     aria-describedby 才會被唸出來。也就是說，這裡每張圖辛苦寫的那段
     「看得懂的人學到什麼」，在修好之前沒有任何人聽得到。

     每個檔案只有一個 <title>／<desc>（build 會擋掉沒有的），所以只改第一個。
     id 用跟前面同一套 pfx，同一頁 35 張圖才不會互相搶。 */
  const aria = [];
  if (!/<title\b[^>]*\sid=/i.test(s)) {
    s = s.replace(/<title\b([^>]*)>/i, `<title$1 id="${pfx}title">`);
  }
  aria.push(/<title\b[^>]*\sid\s*=\s*"([^"]+)"/i.exec(s)?.[1]);
  if (!/<desc\b[^>]*\sid=/i.test(s)) {
    s = s.replace(/<desc\b([^>]*)>/i, `<desc$1 id="${pfx}desc">`);
  }
  aria.push(/<desc\b[^>]*\sid\s*=\s*"([^"]+)"/i.exec(s)?.[1]);

  /* 確保根 <svg> 帶 class、role 與無障礙關聯 */
  s = s.replace(/<svg\b([^>]*)>/i, (m0, attrs) => {
    let a = attrs;
    if (!/\bxmlns=/.test(a)) a = ` xmlns="http://www.w3.org/2000/svg"` + a;
    if (!/\bclass=/.test(a)) a += ` class="dia-svg"`;
    else a = a.replace(/class\s*=\s*"([^"]*)"/, (_, c) => `class="${c} dia-svg"`);
    if (!/\brole=/.test(a)) a += ` role="img"`;
    if (!/\baria-labelledby=/.test(a) && aria[0]) a += ` aria-labelledby="${aria[0]}"`;
    if (!/\baria-describedby=/.test(a) && aria[1]) a += ` aria-describedby="${aria[1]}"`;
    return `<svg${a}>`;
  });

  return { svg: s.trim(), symbols };
}

/* ---------------------------------------------------------- macro 展開 -- */

function expand(raw, ctx) {
  const stash = new Stash();
  let s = raw;

  /* 逃生口：{{{ 與 [[[ 產生字面量 */
  s = s.replace(/\{\{\{/g, 'LB').replace(/\[\[\[/g, 'SB');

  /* 0) 先把 <pre> 整塊藏起來（裡面可能有 {{ 或 [[ ） */
  s = s.replace(/<pre\b[\s\S]*?<\/pre>/g, (m) => stash.put(m));

  /* 1) {{include:name}} */
  s = s.replace(/\{\{include:([\w-]+)\}\}/g, (m0, n) => {
    const f = path.join(P.partials, `${n}.html`);
    if (!exists(f)) { err(ctx.id, `找不到 partial：${n}`); return ''; }
    return read(f);
  });

  /* 2) {{svg:name | caption}}
     ★ 這裡不能用 /\{\{svg:([\w-]+)\s*(?:\|([^}]*))?\}\}/ ★
     圖說裡會出現 {{m: …}}（圖說本來就常要提到式子裡的符號），而 [^}]* 會停在
     \frac{a}{b} 或 {{m: s}} 的第一個 }，把圖說攔腰截斷。後果特別隱蔽：
     被截掉的後半段變成散在文件裡的裸文字，接著第 7.2 步的 {{m: …}} 掃描器
     從殘缺的 {{m: 一路吃到整個 macro 的收尾 }}，把 </figcaption></figure>
     一併吞進 MathML —— 頁面照樣渲染（HTML parser 很寬容），只是圖說消失、
     版面錯位，而且沒有任何錯誤訊息。m11、sr1 出貨時就是這樣壞掉的。
     所以改成跟 expandInlineMath 一樣自己數大括號深度。 */
  s = replaceSvgMacro(s, (name, cap) => {
    const r = inlineSvg(name, ctx.id);
    if (!r) return '';
    r.symbols.forEach((x) => ctx.symbols.add(x));
    const caption = (cap || '').trim();
    const cls = caption.includes('[wide]') ? 'dia dia--wide'
              : caption.includes('[narrow]') ? 'dia dia--narrow' : 'dia';
    const clean = caption.replace(/\[(wide|narrow)\]/g, '').trim();
    /* 只藏 SVG 本體，圖說留在外面 —— 否則 [[term]] 這一關（第 9 步）
       看不到圖說，tooltip 會原樣印出 [[soft clipping]]，而且沒有任何錯誤訊息。 */
    return `<figure class="${cls}">${stash.put(r.svg)}` +
           (clean ? `<figcaption>${clean}</figcaption>` : '') +
           `</figure>`;
  });

  /* 3) {{fig:key}} */
  s = s.replace(/\{\{fig:([\w.-]+)\}\}/g, (m0, key) => {
    const f = ctx.figures[key];
    if (!f) {
      warn(ctx.id, `figure "${key}" 尚未抽取（figures.json 未收錄）—— 先放佔位`);
      return stash.put(
        `<figure class="fig"><div class="note">圖片待抽取：<code>${esc(key)}</code>` +
        `（執行 <code>python3 tools/extract_media.py</code>）</div></figure>`
      );
    }
    for (const src of [f.src, f.src2x].filter(Boolean)) {
      if (!exists(path.join(SITE, src))) err(ctx.id, `figure 檔案不存在：${src}`);
    }
    /* 刻意不印投影片編號 —— 讀者不該需要去對照任何外部檔案。
       要標註來源就在 figures.json 寫 "source"（例如「實驗室實測結果」）。 */
    return (
      `<figure class="fig">` +
      stash.put(`<img src="${esc(f.src)}"${f.src2x ? ` srcset="${esc(f.src)} 1x, ${esc(f.src2x)} 2x"` : ''}` +
      ` alt="${esc(f.alt || '')}" loading="lazy" decoding="async">`) +
      (f.caption ? `<figcaption>${f.caption}</figcaption>` : '') +
      (f.source ? `<p class="fig__prov">${esc(f.source)}</p>` : '') +
      `</figure>`
    );
  });

  /* 4) {{widget:type #id {json} | caption}} */
  s = s.replace(
    /\{\{widget:([\w-]+)\s+#([\w.-]+)\s*(\{[\s\S]*?\})?\s*(?:\|([^}]*))?\}\}/g,
    (m0, type, id, cfg, cap) => {
      const wid = `${ctx.id}.${id}`;
      if (ctx.widgetIds.has(wid)) err(ctx.id, `widget id 重複：${wid}`);
      ctx.widgetIds.add(wid);

      const wfile = path.join(SITE, 'assets', 'js', 'widgets', `${type}.js`);
      if (!exists(wfile)) err(ctx.id, `找不到 widget 程式：assets/js/widgets/${type}.js`);
      ctx.widgets.add(type);

      if (cfg) { try { JSON.parse(cfg); } catch (e) { err(ctx.id, `widget ${wid} 的 config 不是合法 JSON`); } }

      /* 同 {{svg:}}：圖說不進 stash，[[term]] 才處理得到 */
      return (
        stash.put(
          `<figure class="widget" data-widget="${esc(type)}" data-wid="${esc(wid)}"` +
          (cfg ? ` data-config='${cfg.replace(/'/g, '&#39;')}'` : '') + `>` +
          `<div class="widget__hd">互動練習</div>` +
          `<div class="widget__stage"></div>` +
          `<div class="widget__ctl">` +
          `<button type="button" class="btn" data-act="check">檢查答案</button>` +
          `<button type="button" class="btn btn--ghost" data-act="reset">重設</button>` +
          `<output class="widget__msg" role="status" aria-live="polite"></output>` +
          `</div>`
        ) +
        (cap ? `<figcaption>${cap.trim()}</figcaption>` : '') +
        stash.put(
          `<noscript><p class="note">此互動需要 JavaScript。` +
          `請改看上方的靜態圖說明相同概念。</p></noscript>` +
          `</figure>`
        )
      );
    }
  );

  /* 5) {{guard:n}}…{{/guard}} */
  s = s.replace(/\{\{guard:(\d+)\s*\|([^}]*)\}\}([\s\S]*?)\{\{\/guard\}\}/g,
    (m0, n, title, body) => {
      ctx.guards.push(+n);
      return `<aside class="guardrail" id="guard-${n}">` +
             `<p class="guardrail__hd">重要區分 #${n}：${title.trim()}</p>` +
             body.trim() + `</aside>`;
    });

  /* 6) {{predict}}…{{reveal}}…{{/predict}} */
  s = s.replace(/\{\{predict\}\}([\s\S]*?)\{\{reveal\}\}([\s\S]*?)\{\{\/predict\}\}/g,
    (m0, q, a) =>
      `<details class="reveal">` +
      `<summary>請先思考，再展開答案</summary>` +
      `<div class="reveal__q">${q.trim()}</div>` +
      `<div class="reveal__a">${a.trim()}</div>` +
      `</details>`
  );
  /* 允許 predict 區塊把問題寫在 summary 之前 */
  s = s.replace(/\{\{ask\}\}([\s\S]*?)\{\{reveal\}\}([\s\S]*?)\{\{\/ask\}\}/g,
    (m0, q, a) =>
      `<div class="reveal__q">${q.trim()}</div>` +
      `<details class="reveal"><summary>展開答案</summary>` +
      `<div class="reveal__a">${a.trim()}</div></details>`
  );

  /* 7) {{card 標題}}…{{/card}} —— 一般用途的標題卡（取代舊的 deck 引用卡）*/
  s = s.replace(/\{\{card\s+([^}]*)\}\}([\s\S]*?)\{\{\/card\}\}/g, (m0, title, body) =>
    `<div class="source-card">` +
    `<div class="source-card__hd"><b>${title.trim()}</b></div>` +
    `<div class="source-card__body">${body.trim()}</div></div>`
  );

  /* 7.2) 數學：{{m: 式子}} 行內、{{eq}}式子{{note}}說明{{/eq}} 獨立一行。
     語法見 tools/mathml.mjs。式子編不出來就讓建置失敗 ——
     一條壞掉的公式如果只是靜靜印出原始碼，沒有人會發現。 */
  s = expandInlineMath(s, ctx.id, (h) => stash.put(h));

  s = s.replace(/\{\{eq\}\}([\s\S]*?)\{\{\/eq\}\}/g, (m0, body) => {
    const [expr, note] = body.split(/\{\{note\}\}/);
    let ml;
    try { ml = toMathML(expr.trim(), true); }
    catch (e) { err(ctx.id, `${e.message}（{{eq}} ${expr.trim().slice(0, 60)}）`); return m0; }
    /* 式子進 stash（不可被 [[term]] 掃到），說明不進 —— 說明裡常有術語連結 */
    return stash.put(`<div class="eq">${ml}`) +
           (note ? `<p class="eq__note">${note.trim()}</p>` : '') +
           stash.put(`</div>`);
  });

  s = s.replace(/\{\{cli\}\}([\s\S]*?)\{\{\/cli\}\}/g, (m0, code) =>
    stash.put(`<pre><code>${esc(code.trim())}</code></pre>`)
  );

  /* 7.5) 表頭補 scope="col"。全教材的 <th> 都在 <thead> 裡、都是欄標題，
     所以這件事沒必要讓作者每次手寫 —— 但少了它，螢幕閱讀器在唸儲存格時
     不會帶出「這一欄是什麼」，兩欄以上的對照表就完全失去意義。 */
  s = s.replace(/<thead>([\s\S]*?)<\/thead>/g, (m0, inner) =>
    `<thead>${inner.replace(/<th(?![^>]*\bscope=)/g, '<th scope="col"')}</thead>`);

  /* 8) {{quiz:mNN}} */
  s = s.replace(/\{\{quiz:([\w-]+)\}\}/g, (m0, qid) => {
    if (!ctx.quiz[qid]) { warn(ctx.id, `quiz "${qid}" 在 quizzes.json 中不存在`); return ''; }
    ctx.hasQuiz = true;
    /* 題目由 quiz.js 從 quiz.data.js 掛上去（file:// 不能 fetch）。
       所以關掉 JS 時這一段是空的 —— 要跟 widget 一樣給 noscript 交代，
       否則讀者只會看到一個沒有內容的「學習檢核」標題。 */
    return `<section class="quiz" data-quiz="${esc(qid)}">` +
           `<h2>學習檢核</h2><div class="quiz__items"></div>` +
           `<noscript><p class="note">此測驗需要 JavaScript。` +
           `本模組的重點已完整寫在上面的內文與圖裡，不看測驗也讀得完。</p></noscript>` +
           `</section>`;
  });

  /* 未知 macro → build 失敗 */
  for (const m of s.matchAll(/\{\{([^}\n]{1,60})\}\}/g)) {
    if (!/^slot:/.test(m[1])) err(ctx.id, `未知的 macro：{{${m[1]}}}`);
  }

  /* 9) [[term]] / [[term|顯示文字]] —— 最後才做，才能涵蓋前面 macro 產生的文字 */
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m0, key, disp) => {
    const k = key.trim();
    const g = ctx.glossary[k];
    if (!g) { err(ctx.id, `未定義的詞彙：[[${k}]]（請補進 src/data/glossary.json）`); return esc(k); }
    ctx.terms.add(k);
    const id = `gd-${slugify(k)}-${ctx.termSeq++}`;
    const label = (disp || k).trim();
    return `<span class="term" data-term="${esc(k)}" tabindex="0" role="button"` +
           ` aria-expanded="false" aria-describedby="${id}"` +
           `>${esc(label)}<span class="term__pop" id="${id}" role="tooltip">` +
           `<b class="term__hd">${esc(k)}${g.zh_gloss ? ` <i>${esc(g.zh_gloss)}</i>` : ''}</b>` +
           `<span class="term__def" data-lang="zh">${g.zh}</span>` +
           /* lang="en" 一定要標：<html> 是 zh-Hant-TW，沒標的話螢幕閱讀器
             會用中文語音去唸英文定義，而這份教材的英文詞條是一級功能。 */
           `<span class="term__def" data-lang="en" lang="en">${g.en}</span>` +
           `<a class="term__more" href="glossary.html#${slugify(k)}">完整條目 →</a>` +
           `</span></span>`;
  });

  s = stash.restore(s);
  s = s.replace(/LB/g, '{{').replace(/SB/g, '[[');
  return s;
}

/* ------------------------------------------------------- 區塊 / TOC 處理 -- */

function decorateSections(html, ctx) {
  /* 給 data-part 區塊補標題編號 */
  html = html.replace(/<section\b([^>]*\bdata-part="(\w+)"[^>]*)>/g, (m0, attrs, key) => {
    const p = PARTS[key];
    if (!p) { warn(ctx.id, `未知的 data-part："${key}"`); return m0; }
    const withClass = /class="/.test(attrs)
      ? attrs.replace(/class="([^"]*)"/, (_, c) => `class="${c} part"`)
      : `${attrs} class="part"`;
    return `<section${withClass} id="part-${key}">`;
  });

  /* h2 補上編號徽章 */
  html = html.replace(
    /(<section[^>]*\bdata-part="(\w+)"[^>]*>\s*)<h2([^>]*)>/g,
    (m0, head, key, attrs) => {
      const p = PARTS[key];
      return p ? `${head}<h2${attrs} data-num="${p.n}">` : m0;
    }
  );

  /* 自動補 heading id + 收集 TOC */
  const toc = [];
  /* h4 也要收進 TOC —— 研究指引頁的小節（用途一／二／三）是 h4，
     只收到 h3 的話那些小節在側欄完全看不見。m04 也有同樣的狀況。 */
  html = html.replace(/<(h2|h3|h4)\b([^>]*)>([\s\S]*?)<\/\1>/g, (m0, tag, attrs, text) => {
    let id = /\bid="([^"]+)"/.exec(attrs)?.[1];
    /* 先剪掉 tooltip 再去標籤，否則整段詞彙定義會被當成標題文字 */
    const plain = stripPops(text).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!id) {
      id = slugify(plain);
      let n = 2;
      while (toc.some((t) => t.id === id)) id = `${slugify(plain)}-${n++}`;
      attrs += ` id="${id}"`;
    }
    toc.push({ tag, id, text: plain });
    return `<${tag}${attrs}>${text}</${tag}>`;
  });

  return { html, toc };
}

function tocHtml(toc) {
  if (toc.length < 3) return '';
  const items = toc.map((t) =>
    `<li class="lv${t.tag === 'h4' ? 4 : t.tag === 'h3' ? 3 : 2}">` +
    `<a href="#${t.id}">${esc(t.text)}</a></li>`).join('');
  return `<nav class="toc--sticky" aria-label="本頁目錄">` +
         `<h2>本頁目錄</h2><ol>${items}</ol></nav>`;
}

/* -------------------------------------------------------------- 主流程 -- */

function build() {
  errors.length = 0; warnings.length = 0;
  const t0 = Date.now();

  const glossary = expandMathDeep(JSON.parse(read(path.join(P.data, 'glossary.json'))), 'glossary.json');
  const modules = JSON.parse(read(path.join(P.data, 'modules.json')));
  const quizFile = path.join(P.data, 'quizzes.json');
  const quiz = exists(quizFile) ? expandMathDeep(JSON.parse(read(quizFile)), 'quizzes.json') : {};
  const figFile = path.join(P.data, 'figures.manifest.json');
  const figures = exists(figFile) ? JSON.parse(read(figFile)) : {};

  const shell = read(path.join(P.partials, 'shell.html'));
  const defsRaw = read(path.join(P.svg, '_defs.svg'));

  /* ★ draft 模組 ★
     modules.json 標了 "draft": true 的，頁面照建（本機用 file:// 讀得到，
     而且 CI 的 site/↔src/ 比對才不會因為少一個檔案而失敗），但<b>不出現在任何
     導覽面</b>：首頁卡片、學習路徑時數、print-all、上下篇 pager、glossary 的
     「哪些模組用過此詞」、modules.data.js 全部略過。
     真正不發布是在 .github/workflows/deploy.yml —— 上傳 Pages artifact 之前
     依這個欄位把檔案刪掉。兩邊都讀同一個欄位，加一篇 draft 不必改 workflow。

     注意這是「未列出」，不是「私密」：repo 是公開的，原始碼與 site/ 裡的
     產出照樣讀得到。要真的不公開就不能 commit。 */
  const listed = modules.filter((m) => !m.draft);

  /* 詞彙使用交叉索引：哪些 module 用過此詞（絕不手寫，一律由 build 算） */
  const termUse = {};
  const built = [];

  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    const file = path.join(P.modules, `${mod.src}`);
    if (!exists(file)) { err(mod.id, `找不到 src/modules/${mod.src}`); continue; }

    let raw = read(file);
    const fm = /^\s*<!--tw([\s\S]*?)-->/.exec(raw);
    let meta = {};
    if (fm) {
      try { meta = JSON.parse(fm[1]); }
      catch (e) { err(mod.id, `front-matter 不是合法 JSON：${e.message}`); }
      raw = raw.slice(fm[0].length);
    }
    meta = { ...mod, ...meta };

    const ctx = {
      id: mod.id, glossary, quiz, figures,
      symbols: new Set(), widgets: new Set(), widgetIds: new Set(),
      terms: new Set(), guards: [], termSeq: 0, hasQuiz: false,
    };

    let body = expand(raw, ctx);
    const dec = decorateSections(body, ctx);
    body = dec.html;

    if (!mod.draft) ctx.terms.forEach((t) => { (termUse[t] ||= new Set()).add(mod.id); });

    /* 頁首 */
    const objectives = (meta.objectives || []).map((o) => `<li>${o}</li>`).join('');
    const prereqChips = (meta.prereq || []).map((pid) => {
      const p = modules.find((m) => m.id === pid);
      return p ? `<a class="chip" href="${p.id}.html">建議先修：${esc(p.short || p.title_zh)}</a>` : '';
    }).join('');

    const head =
      `<header class="mhead">` +
      /* kicker 預設是「模組 N」。研究指引頁不是教學模組，
         讓它用 modules.json 的 kicker 欄位自己說自己是什麼。 */
      `<p class="mhead__kicker">${meta.kicker ? esc(meta.kicker) : `模組 ${esc(meta.num ?? i)}`}` +
      ` ${meta.title_en ? '· ' + esc(meta.title_en) : ''}</p>` +
      `<h1>${esc(meta.title_zh)}</h1>` +
      (meta.sub ? `<p class="mhead__sub">${meta.sub}</p>` : '') +
      `<p class="mhead__meta">` +
      (meta.est_min ? `<span class="chip">約 ${meta.est_min} 分鐘</span>` : '') +
      prereqChips + `</p></header>` +
      (objectives ? `<section class="objectives"><h2>本模組學習目標</h2><ul>${objectives}</ul></section>` : '');

    /* 上下篇。draft 不進 pager，也不從別人的 pager 連過去 ——
       否則 sr5 的「下一模組」就成了通往未發布頁面的入口。 */
    const li = mod.draft ? -1 : listed.indexOf(mod);
    const prev = li > 0 ? listed[li - 1] : undefined;
    const next = li >= 0 && li < listed.length - 1 ? listed[li + 1] : undefined;
    const pager =
      `<nav class="pager" aria-label="模組導覽">` +
      (prev ? `<a class="prev" href="${prev.id}.html"><small>← 上一模組</small>${esc(prev.title_zh)}</a>` : `<span></span>`) +
      (next ? `<a class="next" href="${next.id}.html"><small>下一模組 →</small>${esc(next.title_zh)}</a>` : `<span></span>`) +
      `</nav>`;

    /* 列印用詞彙附錄（螢幕隱藏）—— 讓紙本自足 */
    const appendix = ctx.terms.size
      ? `<section class="glossary-appendix"><h2>本模組術語</h2><dl>` +
        [...ctx.terms].sort().map((t) =>
          `<dt>${esc(t)}${glossary[t].zh_gloss ? `（${esc(glossary[t].zh_gloss)}）` : ''}</dt>` +
          `<dd>${glossary[t].zh}</dd>`).join('') +
        `</dl></section>`
      : '';

    /* 只 inline 這一頁真的用到的符號 */
    const defs = buildDefs(defsRaw, ctx.symbols);

    /* 只載入這一頁真的用到的東西 */
    const scripts = [
      ctx.hasQuiz ? `<script src="assets/data/quiz.data.js"></script>` : '',
      ...[...ctx.widgets].sort().map((w) => `<script src="assets/js/widgets/${w}.js"></script>`),
    ].filter(Boolean).join('\n');

    const page = shell
      .replace('{{slot:title}}', () => esc(`${meta.title_zh} · 長讀癌症基因體學入門`))
      .replace('{{slot:desc}}', () => esc(meta.sub || meta.title_zh))
      .replace('{{slot:wrapclass}}', () => dec.toc.length >= 3 ? '' : 'wrap--plain')
      .replace('{{slot:body}}', () => head + body)
      .replace('{{slot:pager}}', () => pager)
      .replace('{{slot:glossary-appendix}}', () => appendix)
      .replace('{{slot:toc}}', () => tocHtml(dec.toc))
      .replace('{{slot:defs}}', () => defs)
      .replace('{{slot:scripts}}', () => scripts);

    fs.writeFileSync(path.join(SITE, `${mod.id}.html`), page);
    built.push({ ...meta, terms: ctx.terms.size, widgets: ctx.widgetIds.size, guards: ctx.guards });
  }

  /* ---- 資料檔（.data.js，不是 .json —— file:// 擋 fetch） ---- */
  fs.mkdirSync(P.outData, { recursive: true });

  const gloOut = {};
  for (const [k, v] of Object.entries(glossary)) {
    gloOut[k] = { ...v, slug: slugify(k), modules: [...(termUse[k] || [])].sort() };
  }
  fs.writeFileSync(path.join(P.outData, 'glossary.data.js'),
    `/* generated by tools/build.mjs — 不要手動編輯 */\n` +
    `window.TW_GLOSSARY = ${JSON.stringify(gloOut, null, 1)};\n`);

  fs.writeFileSync(path.join(P.outData, 'quiz.data.js'),
    `/* generated by tools/build.mjs — 不要手動編輯 */\n` +
    `window.TW_QUIZ = ${JSON.stringify(quiz, null, 1)};\n`);

  fs.writeFileSync(path.join(P.outData, 'modules.data.js'),
    `/* generated by tools/build.mjs — 不要手動編輯 */\n` +
    `window.TW_MODULES = ${JSON.stringify(
      listed.map((m) => ({ id: m.id, num: m.num, title_zh: m.title_zh, title_en: m.title_en,
                            short: m.short, q: m.q, sub: m.sub,
                            est_min: m.est_min, group: m.group })),
      null, 1)};\n`);

  /* ---- index.html / glossary.html / print-all.html ---- */
  writeIndex(listed, shell);
  writeGlossary(gloOut, listed, shell);
  writePrintAll(listed, shell);

  /* ---- 報告 ---- */
  const ms = Date.now() - t0;
  const allGuards = built.flatMap((b) => b.guards);
  console.log(`\n  建置完成：${built.length} 個模組，${ms} ms`);
  console.log(`  詞彙 ${Object.keys(glossary).length} 條 · guardrail ${new Set(allGuards).size}/${Object.keys(GUARD_TOPICS).length} 就位` +
              (allGuards.length ? ` [${[...new Set(allGuards)].sort((a, b) => a - b).join(',')}]` : ''));

  const drafts = modules.filter((m) => m.draft);
  if (drafts.length) {
    console.log(`  draft ${drafts.length} 篇（本機建得出來，不列在導覽面，Pages 不發布）：` +
                drafts.map((m) => `${m.id}.html`).join('、'));
  }

  if (warnings.length) {
    console.log(`\n  ⚠ ${warnings.length} 個警告`);
    warnings.slice(0, 20).forEach((w) => console.log(`    · ${w}`));
    if (warnings.length > 20) console.log(`    …另外 ${warnings.length - 20} 個`);
  }
  if (errors.length) {
    console.error(`\n  ✗ ${errors.length} 個錯誤，建置失敗\n`);
    errors.forEach((e) => console.error(`    · ${e}`));
    console.error('');
    return false;
  }
  console.log(`  ✓ 無錯誤\n`);
  return true;
}

/** 只把這一頁用到的 symbol / marker / pattern inline 進去。
    外部 sprite（<use href="_defs.svg#x">）在 file:// 被擋，所以必須 inline。 */
function buildDefs(defsRaw, used) {
  if (!used.size) return '';
  const picked = [];
  for (const tag of ['symbol', 'marker', 'pattern']) {
    const re = new RegExp(`<${tag}\\b[^>]*\\sid="([\\w-]+)"[\\s\\S]*?<\\/${tag}>`, 'g');
    for (const m of defsRaw.matchAll(re)) if (used.has(m[1])) picked.push(m[0]);
  }
  if (!picked.length) return '';
  return `<svg class="tw-defs" aria-hidden="true" focusable="false"` +
         ` style="position:absolute;width:0;height:0;overflow:hidden">` +
         `<defs>${picked.join('')}</defs></svg>`;
}

function writeIndex(modules, shell) {
  const groups = [];
  for (const m of modules) {
    let g = groups.find((x) => x.name === (m.group || '其他'));
    if (!g) { g = { name: m.group || '其他', items: [] }; groups.push(g); }
    g.items.push(m);
  }

  /* 卡片上顯示的是「這個模組回答什麼問題」（modules.json 的 q），
     而不是術語清單 —— 零基礎的讀者第一次打開時，看到一串沒學過的詞會直接放棄。
     術語留給 sub，那是模組內頁的副標題，那裡有圖與互動撐著。 */
  const card = (m) =>
    `<li class="mcard" data-mod="${esc(m.id)}">` +
    `<a href="${m.id}.html">` +
    `<span class="mcard__num">${esc(String(m.num))}</span>` +
    `<span class="mcard__body">` +
    `<b>${esc(m.title_zh)}</b>` +
    (m.q ? `<small class="mcard__q">${m.q}</small>` : '') +
    (m.est_min ? `<span class="mcard__time">約 ${m.est_min} 分鐘</span>` : '') +
    `</span>` +
    `<span class="mcard__state" data-state aria-hidden="true"></span>` +
    `</a></li>`;

  /* group 之下再分一層 topic：研究指引會有好幾個主題，每個主題自己好幾頁，
     但它們都屬於同一個「這不是課程」的區塊。教材模組沒有 topic，
     那一層就整個不出現 —— 所以這個改動對前 15 張卡片是零影響。

     ★ 一個主題要自成一塊，不能只靠一行小標題把兩批卡片分開。
       兩個主題並列之後才看得出來的問題：num 是「上／中／下」，
       所以捲下來會看到 上 中 下 上 下 —— 兩個「上」相鄰，
       而卡片本身沒有任何東西指出它們屬於不同的主題。
       所以每個主題包成一個 .topic 區塊，自己帶標題、一句說明、
       先修條件與篇數；「上中下」的編號因而被限制在該區塊之內讀。 */
  const topicBlock = (c) => {
    const first = c.items[0] || {};
    const pre = (first.prereq || [])
      .map((pid) => modules.find((m) => m.id === pid))
      .filter(Boolean)
      .map((p) => `<a class="chip" href="${p.id}.html">${esc(p.short || p.title_zh)}</a>`)
      .join('');
    return `<div class="topic">` +
      `<h3 class="topic__name">${esc(c.topic)}</h3>` +
      (first.topic_sub ? `<p class="topic__sub">${first.topic_sub}</p>` : '') +
      `<p class="topic__meta">` +
      `<span class="topic__count">共 ${c.items.length} 篇，依序閱讀</span>` +
      (pre ? `<span class="topic__pre">建議先修 ${pre}</span>` : '') +
      `</p>` +
      `<ol class="mgrid">${c.items.map(card).join('')}</ol>` +
      `</div>`;
  };

  const cards = groups.map((g) => {
    const clusters = [];
    for (const m of g.items) {
      const key = m.topic || '';
      let c = clusters.find((x) => x.topic === key);
      if (!c) { c = { topic: key, items: [] }; clusters.push(c); }
      c.items.push(m);
    }
    /* 有 topic 的 group（目前只有研究指引）整組換一種呈現：
       它不是課程的一部分，所以不該長得跟「基礎／工具／核心」一模一樣。 */
    const hasTopic = clusters.some((c) => c.topic);
    const body = clusters.map((c) =>
      c.topic ? topicBlock(c) : `<ol class="mgrid">${c.items.map(card).join('')}</ol>`).join('');
    return `<section class="mgroup${hasTopic ? ' mgroup--research' : ''}">` +
      `<h2>${esc(g.name)}</h2>` +
      (hasTopic
        ? `<p class="mgroup__intro">以下不是課程，是研究方向的說明，也不計入時數與學習檢核。` +
          `讀者設定為實驗室成員與論文審閱者，內容以估計式、參數與失效模式為主，` +
          `語體與前面的教學模組不同。建議完成綜合評量之後再讀。</p>`
        : '') +
      body + `</section>`;
  }).join('');

  const first = modules[0];

  /* 學習路徑圖：index 也要有視覺，讓人一眼看到全貌與兩個轉折點 */
  const pathSvg = inlineSvg('index-path', 'index');
  const pathFig = pathSvg
    ? `<figure class="dia dia--wide">${pathSvg.svg}</figure>` : '';

  /* 開場圖：用一張圖說明「這個實驗室在寫什麼軟體」。
     第一版開場是「兩個變異在不在同一條染色體拷貝上」—— 那是 M6 的核心問題，
     但對零生物背景的資訊學生來說，它預設了太多還沒教的東西（染色體有兩份、
     變異、相位、臨床用藥）。首頁的工作只是讓人知道這裡在做什麼，
     所以改成「輸入 → 軟體 → 輸出」三層：那是資訊背景的人立刻看得懂的形狀。 */
  const whatSvg = inlineSvg('index-what-we-do', 'index');
  const whatFig = whatSvg
    ? `<figure class="dia dia--wide">${whatSvg.svg}` +
      `<figcaption>定序機給的是一堆看不出來源的字串；` +
      `把每一條判回它從哪來，就是這個實驗室寫的軟體在做的事。</figcaption></figure>` : '';

  /* 自學者最先問的四件事：給誰、需要先會什麼、要多久、讀完能做什麼。
     原本是開場圖後面的四格區塊，放在那裡太重（第一次打開的人只想知道這在幹嘛），
     所以收成 CTA 下面一個可展開的問句 —— 資訊留著，但不擋路。
     ★ 時數一律由 est_min 加總算出。手寫的數字會過期，而且沒有人會發現。
     ★ 單元數也要跟著只數課程模組。研究指引（sr*）刻意不給 est_min ——
       它們不是課程的一部分，所以不該算進「要多久」。但單元數若用 modules.length，
       就會變成「17 個單元合計約 12 小時」：分子數了研究指引，分母沒有。 */
  const course = modules.filter((m) => m.est_min);
  const totalHr = Math.round(course.reduce((s, m) => s + m.est_min, 0) / 60);

  const body =
    `<header class="mhead">` +
    `<p class="mhead__kicker">自學課程</p>` +
    `<h1>長讀癌症基因體學 · 入門教材</h1>` +
    `</header>` +

    /* ① 鉤子：先讓人知道這在解什麼問題，再談課程安排。
       文字刻意壓到兩句，重量放在下面那張圖上。 */
    `<div class="home-hook">` +
    `<p class="home-hook__q">這個實驗室做的事，是寫程式分析 DNA 定序資料。</p>` +
    `<p>定序機把一管檢體裡的 DNA 打斷成片段、逐條讀出，產出幾百萬條帶著錯誤的字串。` +
    `麻煩的是：這管檢體裡同時有正常細胞和癌細胞，而字串上沒有標記誰是誰。` +
    `把它還原回來，就是我們寫的軟體要做的事。</p>` +
    `</div>` +

    whatFig +

    /* ② 路徑圖 */
    pathFig +

    /* ③ 明確的起點：不要讓人在 15 張卡片裡自己猜 */
    `<p class="home-cta">` +
    `<a class="btn btn--big" href="${first.id}.html">開始第一個模組 →</a>` +
    `<a class="chip chip--accent" href="#resume" data-resume hidden>繼續上次</a>` +
    `<span class="chip" data-progress-summary>—</span>` +
    `</p>` +

    `<details class="reveal"><summary>這份教材適合誰？需要什麼基礎？要花多久？</summary>` +
    `<div class="reveal__a"><dl class="home-facts">` +
    `<div><dt>適合對象</dt><dd>資訊工程背景、沒有受過癌症生物學與定序訓練的自學者</dd></div>` +
    `<div><dt>先備能力</dt><dd>不要求生物學背景。M0–M3 只需閱讀與操作互動元件；` +
    `M4 起需要能在終端機執行基本指令</dd></div>` +
    `<div><dt>預計時間</dt><dd>${course.length} 個單元合計約 ${totalHr} 小時，建議分 6 週完成` +
    (modules.length > course.length
      ? `；另有 ${modules.length - course.length} 篇研究指引，不計入課程時數` : '') +
    `</dd></div>` +
    `<div><dt>完成後能做什麼</dt><dd>獨立判讀一個位點的證據，並寫出明確標示不確定性的結論</dd></div>` +
    `</dl></div></details>` +

    cards +

    /* ④ 工具與注意事項收到最後 —— 第一次打開的人不需要知道 opaque origin */
    `<section class="mgroup"><h2>工具與資源</h2>` +
    `<p class="mhead__meta">` +
    `<a class="chip" href="glossary.html">完整術語表</a>` +
    `<a class="chip" href="print-all.html">完整手冊（可列印）</a>` +
    `<button type="button" class="chip" data-export-progress>匯出進度</button>` +
    `<button type="button" class="chip" data-import-progress>匯入進度</button>` +
    `</p>` +
    `<details class="reveal"><summary>換電腦或共用帳號時，進度如何保存？</summary>` +
    `<div class="reveal__a"><p class="prose">進度存在<b>目前這台電腦的這個瀏覽器</b>裡，` +
    `不會隨教材檔案移轉；瀏覽器無法把本機檔案的進度與檔案本身綁定。</p>` +
    `<p class="prose">所以換電腦、換瀏覽器、或多人共用同一個帳號時，` +
    `請用上面的「匯出進度」存成檔案，再到另一台「匯入進度」。</p></div></details>` +
    `</section>`;

  const page = shell
    .replace('{{slot:title}}', () => '長讀癌症基因體學 · 入門教材')
    .replace('{{slot:desc}}', () => '供中正大學資工系黃耀廷實驗室新進成員自學的教材')
    .replace('{{slot:wrapclass}}', () => 'wrap--plain')
    .replace('{{slot:body}}', () => body)
    .replace('{{slot:pager}}', () => '')
    .replace('{{slot:glossary-appendix}}', () => '')
    .replace('{{slot:toc}}', () => '')
    .replace('{{slot:defs}}', () => buildDefs(read(path.join(P.svg, '_defs.svg')),
      new Set([...(pathSvg ? pathSvg.symbols : []), ...(whatSvg ? whatSvg.symbols : [])])))
    .replace('{{slot:scripts}}', () => `<script src="assets/data/modules.data.js"></script>\n` +
      `<script src="assets/js/index-page.js"></script>`);

  fs.writeFileSync(path.join(SITE, 'index.html'), page);
}

/** print-all.html：把所有 module 串成一份，可透過列印功能另存為 PDF。
    刻意只抽 <main> 的內容，不重複頁首頁尾。 */
function writePrintAll(modules, shell) {
  const parts = [];
  for (const m of modules) {
    const f = path.join(SITE, `${m.id}.html`);
    if (!exists(f)) continue;
    const html = read(f);
    let body = /<main class="main" id="main">([\s\S]*?)<\/main>/.exec(html)?.[1] || '';

    /* 移除逐頁的上下篇導覽（整本連讀時沒有意義） */
    body = body.replace(/<nav class="pager"[\s\S]*?<\/nav>/g, '');
    body = body.replace(/[ \t]+$/gm, '');

    /* widget 在紙本上不能運作，而且它的 data-wid 會與單頁版撞名
       （progress 的 localStorage key 就是那個 id）。改成保留說明的靜態區塊。 */
    body = body.replace(
      /<figure class="widget"[^>]*>([\s\S]*?)<\/figure>/g,
      (m0, inner) => {
        const cap = /<figcaption>([\s\S]*?)<\/figcaption>/.exec(inner)?.[1] || '';
        return `<div class="note"><b>互動元件</b>（列印版保留說明；數位版可操作）` +
               (cap ? `<br>${cap}` : '') + `</div>`;
      }
    );

    /* ★ 每個 module 的 id 全部加前綴，並改寫同頁內的引用。
       否則 15 份模組串起來會有一堆 part-why / 為什麼重要 撞名，
       anchor 連結與 aria-describedby 都會指錯。 */
    const own = new Set();
    for (const mm of body.matchAll(/\sid\s*=\s*"([^"]+)"/g)) own.add(mm[1]);
    const pfx = `${m.id}__`;
    if (own.size) {
      body = body.replace(/(\sid\s*=\s*")([^"]+)(")/g,
        (_, a, id, b) => own.has(id) ? `${a}${pfx}${id}${b}` : `${a}${id}${b}`);
      body = body.replace(/(href\s*=\s*")#([^"]+)(")/g,
        (m1, a, id, b) => own.has(id) ? `${a}#${pfx}${id}${b}` : m1);
      body = body.replace(/(aria-(?:describedby|labelledby)\s*=\s*")([^"]+)(")/g,
        (_, a, ids, b) =>
          `${a}${ids.split(/\s+/).map((i) => own.has(i) ? pfx + i : i).join(' ')}${b}`);
      body = body.replace(/url\(#([^)"]+)\)/g,
        (m1, id) => own.has(id) ? `url(#${pfx}${id})` : m1);
    }

    parts.push(`<article class="module" id="${m.id}">${body}</article>`);
  }

  /* 收集所有頁面用到的 defs，整份 inline 一次 */
  const defsRaw = read(path.join(P.svg, '_defs.svg'));
  const used = new Set();
  for (const p of parts) {
    for (const mm of p.matchAll(/(?:xlink:)?href="#(sym-[\w-]+)"/g)) used.add(mm[1]);
    for (const mm of p.matchAll(/url\(#(arrow[\w-]*|pat-[\w-]+)\)/g)) used.add(mm[1]);
    for (const mm of p.matchAll(/marker-(?:start|mid|end)="url\(#([\w-]+)\)"/g)) used.add(mm[1]);
  }

  const body =
    `<header class="mhead"><h1>長讀癌症基因體學 · 入門教材</h1>` +
    `<p class="mhead__sub">完整手冊（列印版）· 中正大學資工系黃耀廷實驗室</p>` +
    `<p class="note">本頁串接所有模組，可使用瀏覽器的列印功能另存為 PDF。` +
    `紙本版本會將互動元件改為靜態說明。</p></header>` +
    parts.join('\n<hr>\n');

  const page = shell
    .replace('{{slot:title}}', () => '完整手冊（列印版）· 長讀癌症基因體學入門')
    .replace('{{slot:desc}}', () => '所有模組串接成單一頁面，供列印或存成 PDF')
    .replace('{{slot:wrapclass}}', () => 'wrap--plain')
    .replace('{{slot:body}}', () => body)
    .replace('{{slot:pager}}', () => '')
    .replace('{{slot:glossary-appendix}}', () => '')
    .replace('{{slot:toc}}', () => '')
    .replace('{{slot:defs}}', () => buildDefs(defsRaw, used))
    .replace('{{slot:scripts}}', () => '');

  fs.writeFileSync(path.join(SITE, 'print-all.html'), page);
}

function writeGlossary(glo, modules, shell) {
  const keys = Object.keys(glo).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const items = keys.map((k) => {
    const g = glo[k];
    const mods = g.modules.map((id) => {
      const m = modules.find((x) => x.id === id);
      return m ? `<a class="chip" href="${id}.html">${esc(m.short || m.title_zh)}</a>` : '';
    }).join('');
    return `<article class="gitem" id="${g.slug}">` +
      `<h2>${esc(k)}${g.zh_gloss ? ` <small>${esc(g.zh_gloss)}</small>` : ''}</h2>` +
      (g.aka?.length ? `<p class="gitem__aka">別名：${g.aka.map(esc).join('、')}</p>` : '') +
      `<div class="term__def" data-lang="zh">${g.long_zh || g.zh}</div>` +
      `<div class="term__def" data-lang="en" lang="en">${g.long_en || g.en}</div>` +
      (mods ? `<p class="gitem__mods">相關模組：${mods}</p>` : '') +
      (g.see?.length ? `<p class="gitem__see">另見：${g.see.map((s) =>
        glo[s] ? `<a href="#${glo[s].slug}">${esc(s)}</a>` : esc(s)).join('、')}</p>` : '') +
      `</article>`;
  }).join('');

  const body =
    `<header class="mhead"><p class="mhead__kicker">術語表 · Glossary</p>` +
    `<h1>術語表</h1>` +
    `<p class="mhead__sub">共 ${keys.length} 條術語。使用右上角的「繁中／English／雙語」切換定義語言。</p>` +
    `<p class="mhead__meta"><input type="search" id="gsearch" class="chip"` +
    ` placeholder="搜尋術語…" style="min-width:14rem" aria-label="搜尋術語"></p></header>` +
    `<div class="glist">${items}</div>`;

  const page = shell
    .replace('{{slot:title}}', () => '術語表 · 長讀癌症基因體學入門')
    .replace('{{slot:desc}}', () => '中英雙語術語表')
    .replace('{{slot:wrapclass}}', () => 'wrap--plain')
    .replace('{{slot:body}}', () => body)
    .replace('{{slot:pager}}', () => '')
    .replace('{{slot:glossary-appendix}}', () => '')
    .replace('{{slot:toc}}', () => '')
    .replace('{{slot:defs}}', () => '')
    .replace('{{slot:scripts}}', () => `<script src="assets/data/glossary.data.js"></script>\n` +
      `<script src="assets/js/glossary-page.js"></script>`);

  fs.writeFileSync(path.join(SITE, 'glossary.html'), page);
}

/* ------------------------------------------------------------------ 入口 -- */

const ok = build();

if (process.argv.includes('--watch')) {
  console.log('  監看 src/ 中…（Ctrl-C 結束）\n');
  let t = null;
  fs.watch(SRC, { recursive: true }, () => {
    clearTimeout(t);
    t = setTimeout(() => { console.clear(); build(); }, 80);
  });
} else if (!ok) {
  process.exit(1);
}
