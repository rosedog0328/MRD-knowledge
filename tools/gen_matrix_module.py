#!/usr/bin/env python3
"""從 dissection/*.json 產生 p06 矩陣頁的模組原始檔。

用法：python3 tools/gen_matrix_module.py

輸出：src/modules/p06-matrix.html
**不要手改該檔** —— 改 dissection 的 JSON 後重跑本腳本，再跑 build.mjs。
"""
import json
import html
import re
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
SRC = Path("/big8_disk/pingting114/MRD_detection/docs/paper/dissection")
OUT = BASE / "src" / "modules" / "p06-matrix.html"

STEPS = [
    ("s1_compendium",      "① 追蹤標的"),
    ("s2_validation_data", "② 驗證資料"),
    ("s3_read_denoise",    "③ read 層去噪"),
    ("s4_sample_score",    "④ 樣本層分數"),
    ("s5_threshold",       "⑤ 門檻"),
    ("s6_evaluation",      "⑥ 評估"),
]

TAG = {
    "portable":     ("可移植",   "ok"),
    "needs_change": ("需調整",   "warn"),
    "blocked":      ("不可移植", "bad"),
}

# 顯示順序：世系三代 → 去噪源頭 → 統計/ML → ONT/單讀取 → CNA
ORDER = ["core1", "core2", "33", "16", "17", "01", "03", "18", "34", "35", "05"]

# 論文公式 → {{m:}} 語法。verify.mjs 第 13.8 項會擋掉留在 <code> 裡的數學，
# 理由是 ASCII 公式只能靠空白硬湊對齊，讀者一改字級就散掉且不會有錯誤訊息。
# 這裡逐條轉成 mathml.mjs 支援的語法（該檔開頭有完整可用語法清單）。
FORMULA_MAP = {
    "M = N·(1 − (1 − TF)^cov) + μ·R":
        r"M = N · (1 − (1 − TF)^{cov}) + μ · R",
    "M = N·(1−(1−TF)^cov) + μ·R":
        r"M = N · (1 − (1 − TF)^{cov}) + μ · R",
    "TF = 1 − (1 − [M − μ·R]/N)^(1/cov)":
        r"TF = 1 − (1 − \frac{M − μ · R}{N})^{1/cov}",
    "CNA Signal = Σ (P(i) − N(i)) × sign(T(i) − N(i))":
        r"\text{CNA Signal} = \sum (P_i − N_i) × \text{sign}(T_i − N_i)",
    "S = TF_required·(HTF·P_L + (1−HTF)·2)/(HTF·P_L)":
        r"S = \frac{TF_{req} · (HTF · P_L + (1 − HTF) · 2)}{HTF · P_L}",
    "Z = ΣZ_i/√k":
        r"Z = \frac{\sum Z_i}{√k}",
}

# 這些字串在文中出現時轉為術語連結（只轉第一次，避免整頁都是 tooltip）
TERMS = ["duplex sequencing", "background polishing", "outlier suppression",
         "phased variant", "read-centric", "compendium", "Z-score",
         "likelihood ratio", "RCA", "concatemer", "UMI", "tumor fraction",
         "detection rate", "specificity", "informative reads", "blacklist"]


def md(s, link_terms=False, seen=None):
    """極簡 markdown → HTML：**粗體**、`code`；其餘逸出。"""
    s = html.escape(str(s))
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    def _code(m):
        inner = m.group(1)
        # 還原逸出，才能與 FORMULA_MAP 的鍵比對
        plain = html.unescape(inner)
        if plain in FORMULA_MAP:
            return "{{m: " + FORMULA_MAP[plain] + "}}"
        return f"<code>{inner}</code>"
    s = re.sub(r"`(.+?)`", _code, s)
    if link_terms and seen is not None:
        for t in TERMS:
            if t in seen:
                continue
            # 避免切到已有標籤內部
            pat = re.compile(r"(?<![\w\[])" + re.escape(t) + r"(?![\w\]])")
            if pat.search(s):
                s = pat.sub(f"[[{t}]]", s, count=1)
                seen.add(t)
    return s


def load():
    papers = {}
    for f in SRC.glob("*.json"):
        if f.name.startswith("_"):
            continue
        d = json.loads(f.read_text(encoding="utf-8"))
        papers[d["id"]] = d
    ordered = [papers[i] for i in ORDER if i in papers]
    ordered += [p for k, p in sorted(papers.items()) if k not in ORDER]
    return ordered


def step_cell(p, key, seen):
    st = (p.get("steps") or {}).get(key)
    if not st:
        return "<td>—</td>"
    tr = (p.get("ont_transfer") or {}).get(key) or {}
    label, cls = TAG.get(tr.get("status"), ("", ""))
    tag = (f'<span class="pill pill--{cls}" title="{html.escape(tr.get("why", ""))}">'
           f"{label}</span>") if label else ""
    items = "".join(f"<li>{md(x, True, seen)}</li>" for x in st.get("spec", []))
    extra = "".join(
        f'<li><b>{html.escape(k)}</b>：{md(v, True, seen)}</li>'
        for k, v in st.items() if k not in ("summary", "spec") and isinstance(v, str)
    )
    return ("<td><details><summary>" + md(st.get("summary", ""), True, seen) + tag +
            f"</summary><ul class='prose'>{items}{extra}</ul></details></td>")


def main():
    papers = load()
    seen = set()

    # ── 矩陣 ──
    head = "".join(f"<th>{h}</th>" for _, h in STEPS)
    rows = []
    for p in papers:
        code = ' <small class="ok">✅ 開源</small>' if p.get("code") else ""
        name = (f'<td><b>{html.escape(p["key"])}</b>{code}'
                f'<br><small>{html.escape(str(p["journal"]).split(":")[0][:24])} '
                f'{p["year"]}</small></td>')
        rows.append("<tr>" + name + "".join(step_cell(p, k, seen) for k, _ in STEPS) + "</tr>")

    # ── metadata 表 ──
    meta = "\n".join(
        f'<tr><td><b>{html.escape(p["key"])}</b></td>'
        f'<td>{html.escape(p["platform"])}</td>'
        f'<td>{html.escape(p["depth"])}</td>'
        f'<td>{"、".join(p["signal"])}</td>'
        f'<td>{"✅ " + html.escape(p["code"]) if p.get("code") else "—"}</td></tr>'
        for p in papers)

    # ── implementation 表 ──
    impl = [p for p in papers if p.get("implementation")]
    impl_rows = "\n".join(
        f'<tr><td><b>{html.escape(p["key"])}</b></td>'
        f'<td><code>{html.escape(p["implementation"]["repo"])}</code></td>'
        f'<td>{html.escape(p["implementation"]["language"])}</td>'
        f'<td>{md(p["implementation"].get("note", ""))}</td></tr>'
        for p in impl)

    counts = {}
    for p in papers:
        for k, _ in STEPS:
            s = (p.get("ont_transfer") or {}).get(k, {}).get("status")
            counts[s] = counts.get(s, 0) + 1

    doc = f"""<!--tw
{{
  "objectives": [
    "查詢任一方法在任一步驟的完整可實作規格",
    "比較 11 篇的平台、深度、訊號模態與開源狀態",
    "區分取自論文的規格與取自原始碼的實作細節"
  ]
}}
-->

<section data-part="why">
<h2>為什麼重要</h2>

<p class="prose">前四頁依步驟橫向比較，本頁提供<b>完整的查詢介面</b>：
{len(papers)} 篇 × 六步 ＝ {len(papers) * 6} 格，每格可展開為可實作規格。</p>

<p class="prose">本頁內容<b>由 <code>dissection/*.json</code> 自動產生</b>，
與 AI agent 讀取的結構化資料同源，不會分歧。</p>
</section>


<section data-part="concept">
<h2>方法拆解矩陣</h2>

<p class="prose">點任一格展開該步驟的完整規格。
色標為本專案對 [[ONT simplex|ONT]] 可移植性的判斷
（<span class="pill pill--ok">可移植</span>
<span class="pill pill--warn">需調整</span>
<span class="pill pill--bad">不可移植</span>，滑鼠停留看理由），
<b>非論文原文的說法</b>。</p>

<p class="prose">全部 {len(papers) * 6} 格的分布：
可移植 <b>{counts.get('portable', 0)}</b>、
需調整 <b>{counts.get('needs_change', 0)}</b>、
不可移植 <b>{counts.get('blocked', 0)}</b>。</p>

<div class="table-wrap table-wrap--matrix">
<table class="matrix">
<thead><tr><th>方法</th>{head}</tr></thead>
<tbody>
{chr(10).join(rows)}
</tbody>
</table>
</div>
</section>


<section data-part="evidence">
<h2>平台與訊號模態</h2>

<div class="table-wrap">
<table>
<thead><tr><th>方法</th><th>平台</th><th>深度</th><th>訊號模態</th><th>開源碼</th></tr></thead>
<tbody>
{meta}
</tbody>
</table>
</div>

<h3>取自原始碼的實作細節</h3>

<p class="prose">下列 {len(impl)} 篇有公開實作。
<b>其 <code>implementation</code> 欄位的可信度高於論文文字</b> ——
論文常省略關鍵參數，程式碼則給出實際值。</p>

<div class="table-wrap">
<table>
<thead><tr><th>方法</th><th>Repo</th><th>語言</th><th>說明</th></tr></thead>
<tbody>
{impl_rows}
</tbody>
</table>
</div>

<div class="guardrail guardrail--info">
<p class="guardrail__hd">兩個論文與程式碼不一致的實例</p>
<ul class="prose">
<li><b>[[INVAR]] 的[[outlier suppression|離群抑制]]</b> ——
論文：「identified outliers to this distribution (correcting for multiple testing)」；
程式碼：Bonferroni 除以位點數、估 p 時排除 AF&gt;0.01 或支持 read&gt;10 的位點、
p 取 EM 估計與加權平均的較大值。</li>
<li><b>[[ichorCNA]] 的 <code>--altFracThreshold</code></b> ——
程式預設為 <b>0.05</b>，但 [[MRDetect]] 論文用的是 <b>0.001</b>。
照預設執行會在低 [[tumor fraction|TF]] 情境失效。</li>
</ul>
</div>
</section>


<section data-part="predict">
<h2>使用本頁時的注意事項</h2>

{{{{guard:14 | 有些格子拆不出來，已照實標記}}}}
<p class="prose">部分論文把方法細節置於補充資料，
而本專案取得的版本不含該部分 —— 例如 [[CAPP-Seq]] 的 ④ 與 ⑤。</p>
<p class="prose">這些格子明確標示為「未公開」，
<b>不應解讀為該方法沒有這一步</b>，也不應以其他論文的作法填補。</p>
{{{{/guard}}}}

{{{{guard:15 | 只有 11 篇有完整規格}}}}
<p class="prose">本專案共蒐集 28 篇 MRD 方法論文，
其中僅這 {len(papers)} 篇完成六步拆解。</p>
<p class="prose">其餘 17 篇只有書目與一句話定位。
若需要其方法細節，<b>必須先行拆解，不可從書目臆測</b>。</p>
{{{{/guard}}}}
</section>


<section data-part="practice">
<h2>給 AI agent 的存取方式</h2>

<p class="prose">本頁的同一批資料以結構化形式提供，agent 應讀該版本而非本頁 HTML：</p>

{{{{cli}}}}
docs/paper/dissection/
├─ README.md        ← agent 入口：欄位語意、使用警告、快速索引
├─ SYNTHESIS.md     ← 跨論文綜合分析（先讀這份）
├─ _TABLES.json     ← 扁平比較表（約 10k tokens，橫向查詢用）
└─ <id>_<key>.json  ← 逐篇完整規格（11 檔，全載入約 38k tokens）
{{{{/cli}}}}

<p class="prose">改動 JSON 後，重新產生本頁：</p>

{{{{cli}}}}
python3 tools/gen_matrix_module.py   # 重新產生 p06 模組原始檔
node tools/build.mjs                 # 重建網站
{{{{/cli}}}}
</section>
"""
    OUT.write_text(doc, encoding="utf-8")
    print(f"✅ {OUT}")
    print(f"   {len(papers)} 篇 × {len(STEPS)} 步 = {len(papers)*len(STEPS)} 格"
          f"｜術語連結 {len(seen)} 個｜implementation {len(impl)} 篇")


if __name__ == "__main__":
    main()
