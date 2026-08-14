/* ============================================================================
   mathml.mjs — 把一小段 LaTeX 風格的式子編成 MathML
   ----------------------------------------------------------------------------
   為什麼要有這支：`components.css` 的 .eq 註解已經講過理由 ——
   ASCII 公式只能用空白硬湊對齊，讀者一改字級或換字型就散掉，
   而且不會有任何錯誤訊息。但手寫 MathML 又長到沒有人願意維護
   （一個 c_k ≥ Σ c_j 要寫十幾行），所以最後式子都退化成
   <code>c_k ≥ Σ_{j∈S} c_j</code> 這種「看起來像 LaTeX 的純文字」。

   這支解決的就是那個取捨：來源寫得像 LaTeX，輸出是真正的 MathML。

   ── 支援的語法（刻意只有這些，夠用就好）──────────────────────────────

     x_i      x_{z_m}        下標
     x^2      e^{−λ}         上標
     x_i^2                   同時有上下標
     \frac{a}{b}             分數
     \sum_{m}                求和（display 時符號在下方，行內時在右下）
     \hat{φ}  \bar{x}        戴帽子／橫線
     \text{中文說明}          式子裡的文字
     \{ \}                   字面上的大括號（{ } 本身是分組用）
     \log \max \min \exp     直立字體的函數名
     \mid \sim \to \cdot     ∣ ∼ → ·（也可以直接打 Unicode）
     \int                    積分號（把 nuisance 參數積掉時會用到）
     \quad \qquad            水平間距。一行放兩條式子時用，例如
                             「\hat{n}_A = … , \qquad \hat{n}_B = …」；
                             純空白在 MathML 裡不佔寬度，硬打空格沒有作用

   其餘字元照下面的規則自動分類：
     數字（含 , . %）→ <mn>   運算子 → <mo>   其他 → <mi>

   單一個拉丁／希臘字母的 <mi> 由瀏覽器預設斜體（變數），
   多字元的 <mi>（VAF、BetaBin）預設直立 —— 這正好符合數學排版慣例，
   所以不需要自己指定 mathvariant。
   ============================================================================ */

const OPS = new Set([
  '=', '≠', '≥', '≤', '<', '>', '+', '−', '-', '±', '×', '÷', '·', '⋅',
  '∈', '∉', '⊂', '⊆', '∼', '~', '≈', '∝', '→', '←', '⇒', '↔', '∣', '|', '∫',
  '(', ')', '[', ']', '{', '}', ',', ';', ':', '/', '…', '∑', '∏', '√', '∞', '!',
]);

/* \cmd → 直接對應的單一符號 */
const CMD_SYMBOL = {
  mid: '∣', sim: '∼', to: '→', gets: '←', cdot: '·', times: '×', div: '÷',
  le: '≤', ge: '≥', ne: '≠', in: '∈', approx: '≈', pm: '±', ldots: '…',
  infty: '∞', propto: '∝', Rightarrow: '⇒', int: '∫',
};
const CMD_FUNC = new Set(['log', 'max', 'min', 'exp', 'ln', 'det', 'arg']);

/* \cmd → 固定寬度的空白。<mspace> 是 void element，verify.mjs 的
   MathML 配對檢查已經把它列為不需要收尾標籤。 */
const CMD_SPACE = { quad: '1em', qquad: '2em' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ---------------------------------------------------------------- 詞法分析 -- */

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];

    if (/\s/.test(c)) { i++; continue; }

    /* \命令 —— \{ 與 \} 是字面括號，其餘是識別字 */
    if (c === '\\') {
      if (src[i + 1] === '{' || src[i + 1] === '}') {
        out.push({ t: 'op', v: src[i + 1] }); i += 2; continue;
      }
      /* ★ \text{…} 一定要在這裡原樣抓 ★
         下面會把所有空白丟掉，等到 parser 才收就變成
         \text{total copy number} → "totalcopynumber"。實際踩過。 */
      const tx = /^\\text\{([^}]*)\}/.exec(src.slice(i));
      if (tx) { out.push({ t: 'text', v: tx[1] }); i += tx[0].length; continue; }
      const m = /^\\([A-Za-z]+)/.exec(src.slice(i));
      if (!m) throw new Error(`math：不認得的跳脫字元 "${src.slice(i, i + 6)}"`);
      out.push({ t: 'cmd', v: m[1] }); i += m[0].length; continue;
    }

    if (c === '{' ) { out.push({ t: '{' }); i++; continue; }
    if (c === '}' ) { out.push({ t: '}' }); i++; continue; }
    if (c === '_' ) { out.push({ t: '_' }); i++; continue; }
    if (c === '^' ) { out.push({ t: '^' }); i++; continue; }

    /* 數字：允許千分位逗號、小數點與結尾的 % */
    const num = /^\d[\d,]*(?:\.\d+)?%?/.exec(src.slice(i));
    if (num) { out.push({ t: 'num', v: num[0] }); i += num[0].length; continue; }

    if (OPS.has(c)) { out.push({ t: 'op', v: c }); i++; continue; }

    /* 識別字：連續的拉丁字母算同一個（VAF、BetaBin），
       非拉丁（希臘、ℒ、ϱ、CJK…）一個字元算一個 */
    const word = /^[A-Za-z]+/.exec(src.slice(i));
    if (word) { out.push({ t: 'id', v: word[0] }); i += word[0].length; continue; }

    out.push({ t: 'id', v: c }); i++;
  }
  return out;
}

/* ---------------------------------------------------------------- 語法分析 -- */

function parse(tokens, display) {
  let p = 0;
  const peek = () => tokens[p];

  /* 一個「原子」：可以當成上下標的最小單位 */
  function atom() {
    const tk = tokens[p];
    if (!tk) throw new Error('math：式子結尾不完整');

    if (tk.t === '{') {
      p++;
      const inner = [];
      while (peek() && peek().t !== '}') inner.push(scripted());
      if (!peek()) throw new Error('math：大括號沒有配對');
      p++;
      return inner.length === 1 ? inner[0] : `<mrow>${inner.join('')}</mrow>`;
    }

    if (tk.t === 'cmd') {
      p++;
      const name = tk.v;
      if (name === 'frac') return `<mfrac>${atom()}${atom()}</mfrac>`;
      if (name === 'hat')  return `<mover accent="true">${atom()}<mo>^</mo></mover>`;
      if (name === 'bar')  return `<mover accent="true">${atom()}<mo>‾</mo></mover>`;
      if (name === 'sum')  return { big: '∑' };
      if (name === 'prod') return { big: '∏' };
      if (CMD_FUNC.has(name)) return `<mi>${esc(name)}</mi>`;
      if (CMD_SPACE[name])    return `<mspace width="${CMD_SPACE[name]}"/>`;
      if (CMD_SYMBOL[name])   return `<mo>${esc(CMD_SYMBOL[name])}</mo>`;
      throw new Error(`math：不認得的命令 \\${name}`);
    }

    p++;
    if (tk.t === 'text') return `<mtext>${esc(tk.v)}</mtext>`;
    if (tk.t === 'num') return `<mn>${esc(tk.v)}</mn>`;
    if (tk.t === 'op')  return `<mo>${esc(tk.v)}</mo>`;
    if (tk.t === 'id')  return `<mi>${esc(tk.v)}</mi>`;
    throw new Error(`math：多出來的 "${tk.t}"`);
  }

  /* 原子 ＋ 後面跟著的上下標 */
  function scripted() {
    let base = atom();
    let sub = null, sup = null;
    while (peek() && (peek().t === '_' || peek().t === '^')) {
      const kind = tokens[p].t; p++;
      const val = atom();
      if (typeof val !== 'string') throw new Error('math：\\sum 不能當上下標的內容');
      if (kind === '_') sub = val; else sup = val;
    }

    /* \sum 這類大型運算子：display 時上下標放上下，行內時放右側 */
    if (typeof base === 'object' && base.big) {
      const op = `<mo>${base.big}</mo>`;
      if (!sub && !sup) return op;
      if (display) {
        if (sub && sup) return `<munderover>${op}${sub}${sup}</munderover>`;
        return sub ? `<munder>${op}${sub}</munder>` : `<mover>${op}${sup}</mover>`;
      }
      if (sub && sup) return `<msubsup>${op}${sub}${sup}</msubsup>`;
      return sub ? `<msub>${op}${sub}</msub>` : `<msup>${op}${sup}</msup>`;
    }

    if (sub && sup) return `<msubsup>${base}${sub}${sup}</msubsup>`;
    if (sub) return `<msub>${base}${sub}</msub>`;
    if (sup) return `<msup>${base}${sup}</msup>`;
    return base;
  }

  const parts = [];
  while (p < tokens.length) parts.push(scripted());
  return parts.map((x) => (typeof x === 'object' ? `<mo>${x.big}</mo>` : x)).join('');
}

/* ------------------------------------------------------------------ 對外 -- */

/**
 * @param {string} src      LaTeX 風格的式子
 * @param {boolean} display true → display="block"（獨立一行、∑ 的界限在上下）
 * @returns {string} <math>…</math>
 */
export function toMathML(src, display = false) {
  const body = parse(tokenize(src), display);
  return `<math${display ? ' display="block"' : ''}>${body}</math>`;
}
