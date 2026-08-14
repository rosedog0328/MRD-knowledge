# 知識庫頁面規劃

> 建立日期：2026-08-14
> 配比原則（使用者指定）：**教學 1–3 頁，其餘為方法細節、比較、統整**（供 AI agent 參考）
> 每頁標出：用哪些素材、數字來源、對應哪個 SVG

---

## 配比總覽

| 層 | 頁數 | 頁碼 | 定位 |
|---|---:|---|---|
| **教學** | 2 | p00–p01 | 建立最低限度的共同語言，讓新人讀得下去 |
| **方法細節** | 5 | p02–p06 | 逐步驟的橫向比較 —— **知識庫主體** |
| **統整** | 2 | p07–p08 | 跨論文的結論與我們的設計選單 |

自動產生：`index.html`（首頁）、`glossary.html`（91 條術語）

---

# 教學層（2 頁）

## p00 · 導覽：這份知識庫在回答什麼

**目的**：讓讀者 5 分鐘內知道這裡有什麼、怎麼用、需要什麼前置知識。

| 內容 | 素材來源 |
|---|---|
| 一句話定位：11 篇 MRD 方法論文拆進同一組欄位，找出共同骨架 | — |
| **六步骨架圖**（整個知識庫的組織原則） | `{{svg:six-step-skeleton}}` |
| 前置知識：連到 lab-tutorial M0–M13（不重寫基礎） | 外部連結 |
| 收了哪 11 篇、為什麼是這 11 篇 | `PAPER_TIERS.md` §1 |
| 怎麼用：人讀網頁 / agent 讀 `dissection/*.json` | `dissection/README.md` |
| ⚠️ 三個閱讀警告：`ont_transfer` 是我們的判斷、只有 11/28 篇有規格、LLOD 不可跨方法比較 | 各 JSON `caveats` |

---

## p01 · 為什麼 MRD 偵測是個難題

**目的**：建立「為什麼不能只是加深定序」這個核心直覺。**唯一一頁真正的教學。**

| 內容 | 素材來源 |
|---|---|
| MRD 的問題設定：治療後殘存、影像看不到、TF 低至 1e-5 | glossary `MRD`/`tumor fraction` |
| **GE 天花板**：1 mL 血漿只有 10³–10⁴ 個分子 → 加深定序無效 | `{{svg:breadth-vs-depth}}` |
| MRDetect 的實證：重分析 40,000X panel 仍卡在 VAF 1e-3 | `core1` problem_framing |
| **廣度取代深度**：`p = 1 − e^(−ndk)` | `{{eq}}`；`17_iDES` s4 |
| **read-centric**：低 TF 下每位點最多 1 條支持 read | `{{svg:read-centric}}`；`core1` s3 |
| 由此推出的兩個設計 | `01_INVAR` s3-⑤、`34_AccuScan` s4 |
| `{{guard}}` 不要搞混：加深定序 vs 增加位點數 | — |

---

# 方法細節層（5 頁）—— 知識庫主體

> 這五頁是**逐步驟的橫向比較**：同一步，11 篇各自怎麼做、代價是什麼、我們能不能搬。
> 每一格的規格直接來自 `dissection/*.json` 的 `steps.*.spec`。

## p02 · ① 追蹤標的 與 ② 驗證資料

| 內容 | 素材來源 |
|---|---|
| **①的五種做法對照表**：全基因體 SNV / 通用 panel / 個人化 panel / PV / 不需 compendium | 11 篇 s1 |
| 規模對照：10² → 10⁵ 位點，以及「位點數 vs 每位點深度」的取捨 | 各篇 s1.scale |
| **共同點：全部都做 germline 移除，無一例外** | 各篇 s1.spec |
| CAPP-Seq 的 selector 演算法（125 kb 覆蓋 88% 病人，中位 4 SNV） | `16` s1 |
| **②的三種驗證資料**：in silico 混合 / 濕實驗稀釋 / germline 當代理標的 | 11 篇 s2 |
| **共同點：11 篇全部做了稀釋序列量測 LLOD** | 各篇 s2 |
| 設計參數對照：replicate 數（3 → 11 → 50）、深度掃描點數 | `core1`/`33` s2 |
| ⚠️ 我們的缺口：每 TF 只有 3 個 replicate、單一深度 | — |

---

## p03 · ③ 怎麼壓噪音 —— 最大的一頁

**這是本領域設計空間最寬的一步，7 種做法。**

| 內容 | 素材來源 |
|---|---|
| **A 類：靠濕實驗化學**（UMI / duplex / RCA×2） | `01`/`33`/`34`/`35` s3 |
| **B 類：靠統計建模**（background polishing / context 分層 / outlier suppression / 單分子準則 / 自身錯誤率） | `17`/`01`/`34` s3 |
| **C 類：靠機器學習**（SVM 5 特徵 / CNN+MLP / 變異層級機率） | `core1`/`core2`/`18` s3 |
| **D 類：換偵測單元**（phased variants） | `03` s3 |
| **錯誤率總表**：未過濾 → 各法達到的值（含 ONT simplex 的位置） | 各篇 s3.error_rate |
| **匯率**：錯誤率降 2 個數量級 ≈ 深度增 5 倍 | `{{svg:error-vs-depth}}`；`34` results |
| **代價**：duplex 只回收 19%、RCA 僅 35–51% | `{{svg:duplex-cost}}`；`03` s3 |
| **PV 的原理與 ONT 優勢** | `{{svg:phased-variant}}`、`{{svg:pv-distance-readlength}}` |
| ⚠️ ONT 錯誤獨立性未驗證 | `03` caveats |
| `{{guard}}` iDES 的 background polishing 需 n=12 陰性樣本，我們只有 5 | `17` ont_transfer |

---

## p04 · ④ 樣本層分數 與 ⑤ 門檻

| 內容 | 素材來源 |
|---|---|
| **④的八種做法**：Z-score / Poisson-幾何 / 分層二項式 / likelihood ratio / Monte Carlo / HMM / 樣本層分類器 / Stouffer | 11 篇 s4 |
| 各自的統計式（`{{eq}}` MathML） | 10–12 條公式 |
| **共同點：全部都是「把 N 個弱觀測合成一個數」**，差別在機率模型 | — |
| **關鍵分歧：只有 MRDetect 世系需要 control 世代估 μ/σ**，其餘六種不需要 | 各篇 s4 |
| **⑤的六種門檻決定方式** | 11 篇 s5 |
| **陰性樣本稀缺的兩條解法**（cross-patient / 統計模型反推） | `01` s5、`34`/`17` s5 |
| 各篇需要多少陰性樣本：30 / 27 / 12 / 7 / 0 | 各篇 s5 |
| ⚠️ INVAR 作者自承：逐 cohort 定門檻不是長久之計 | `01` author_limitations |
| Lung-CLiP 的多工作點報告法（98% spec vs 80% spec） | `18` s5 |

---

## p05 · ⑥ 評估與切分紀律

| 內容 | 素材來源 |
|---|---|
| **共同點**：全部用稀釋序列量 LLOD、全部報 specificity、全部做分層報告 | 11 篇 s6 |
| **切分紀律的四個等級**：最嚴（Lung-CLiP）→ 未明說（5 篇） | 各篇 s6.split_discipline |
| **Lung-CLiP 的原文引用**（批評同世代交叉驗證） | `18` s6 |
| 對應本專案已知坑 #11 與 `ml-evaluation.md` | 專案規則 |
| 樣本層級 vs read 層級的 TP/FP 定義 | `{{svg:sample-vs-read-level}}` ← **待畫** |
| **LLOD 總表**：11 篇的偵測極限 + 條件（深度、位點數、specificity） | 各篇 `llod` |
| ⚠️ LLOD 不可跨方法直接比較（panel 10³–10⁴× vs WGS 20–120×） | `{{guard}}` |
| **作者自承限制總表**：11 篇 × 3–5 條 | 各篇 `author_limitations` |

---

## p06 · 逐篇完整規格（矩陣）

**內容即現有的 `matrix.html`** —— 11 篇 × 6 步 = 66 格可展開規格，由 `build_matrix.py` 從 JSON 自動產生。

| 內容 | 素材來源 |
|---|---|
| 完整矩陣（點格子展開 `spec`） | `dissection/*.json` |
| 每篇的 metadata：平台、深度、訊號模態、開源碼 | 各篇頂層欄位 |
| ONT 可移植性色標（portable 45 / needs_change 15 / blocked 6） | 各篇 `ont_transfer` |
| LLOD 與作者限制的並排表 | 各篇 `llod` / `author_limitations` |

---

# 統整層（2 頁）

## p07 · 跨論文統整：三條主線

| 內容 | 素材來源 |
|---|---|
| **主線一：取捨三角**（錯誤率 / 分子數 / 廣度） | `{{svg:tradeoff-triangle}}` ← **待畫**；SYNTHESIS §2 |
| 各方法在三角上的位置；PhasED-seq 是唯一宣稱兩者兼得者 | SYNTHESIS §2 |
| **主線二：訊號模態的硬界線**（TF 3%） | `{{svg:tf-3percent-boundary}}`；`05`/`35` |
| 兩篇獨立佐證 → Phase 4 的 CNA 在目標區間可能無訊號 | `05` caveats |
| **主線三：世系三代 = 錯誤抑制的天花板故事** | `{{svg:three-generations}}` |
| 第三代作者自承的轉折（tumor-informed 下標準 WGS 可能更好） | `33` author_limitations |
| **共同點總結**：全部都在「累積大量獨立觀測」，差別只在累積什麼 | SYNTHESIS §0 |

---

## p08 · 我們的位置與設計選單

**這一頁是知識庫的產出 —— 把 66 格轉成可執行的決策。**

| 內容 | 素材來源 |
|---|---|
| **結構性優勢**：compendium 35,603 位點、無 GE 天花板、read 長度 | SYNTHESIS §3.1 |
| **結構性劣勢**：錯誤率 Q21、陰性個體僅 5 個、replicate 僅 3 | SYNTHESIS §3.1 |
| **期望值校準**：NanoRCS 用 RCA 共識（比我們好 9.4×）只到 TF 0.24%，我們目標 1e-4 | `35` caveats |
| **四個純計算、可立即做的改進**（依優先序） | SYNTHESIS §3.2 |
| **六步各自的建議選項 + 依據** | SYNTHESIS §4 |
| **拆解推翻的五件事** | SYNTHESIS §5 |
| 下一步的具體測量：PV 盤點（現有 BAM 就能算） | `03` ont_transfer |

---

## 尚缺的素材

| 項目 | 用在哪頁 |
|---|---|
| `{{svg:sample-vs-read-level}}` — 樣本層 vs read 層的 TP/FP 定義 | p05 |
| `{{svg:tradeoff-triangle}}` — 錯誤率／分子數／廣度的取捨三角 | p07 |
| 10–12 條數學式轉 `{{eq}}` 語法 | p01、p04 |
| 10–15 個 `{{guard}}` 警告框 | 各頁 |

---

## 語體

採 lab-tutorial `sr*` 研究指引頁的**學術語體**：不用第二人稱、不對文件本身下註解、
標題用名詞片語。**例外**：p00 與 p01 是教學層，可略放寬讓新人讀得進去。

## 數字紀律

**每一個數字都必須能回溯到某個 JSON 欄位。** 寫不出來源的數字一律不寫。
建站後加一道 build 檢查：掃描頁面中的數字，比對是否出現在 `dissection/*.json`。
