# MRD 偵測方法知識庫

把 11 篇 MRD 偵測方法論文拆進同一組欄位（六步共同骨架），
使「大家都怎麼做」與「同一步有幾種做法」得以直接對照。

**定位**：不是文獻綜述，也不是教材，而是**設計選單** ——
產出是「每一步有哪些選項、各自的代價是什麼」，供 ONT 版本的設計據以決定。

---

## 給讀者：怎麼看

**直接用瀏覽器打開 `site/index.html` 就好。不需要安裝任何東西。**

整包 `site/` 資料夾可以複製到隨身碟、共用磁碟或另一台電腦，一樣能用。

- 右上角可切換 **中／EN／雙語** 的詞彙定義、深淺色、字級
- 進度會自動存在瀏覽器裡；換電腦請用首頁的「匯出進度／匯入進度」
- 想印成紙本：首頁的「完整手冊（可列印）」→ Cmd-P → 存成 PDF

### 前置知識

本知識庫假設讀者已具備長讀長癌症基因體學的基礎，**不重複說明**。
所需概念在實驗室既有教材 [lab-tutorial](../lab-tutorial/) 的 M2、M3、M7、M8、M9、M10 已完整涵蓋。

MRD 專屬的術語則於本知識庫定義（115 條，其中 14 條繼承自 lab-tutorial）。

### 頁面結構

| 層 | 頁 | 內容 |
|---|---|---|
| **導覽** | p00–p01 | 六步骨架的組織原則；三個基本量與三個共同前提 |
| **方法細節** | p02–p07 | 逐步驟橫向比較 11 篇的做法（**主體**） |
| **統整** | p08–p09 | 跨論文的三條主線；本專案的位置與設計選單 |

---

## 給 AI agent

**不要讀本網站的 HTML。** 同一批資料以結構化形式提供：

```
/big8_disk/pingting114/MRD_detection/docs/paper/dissection/
├─ README.md        ← 入口：欄位語意、使用警告、快速索引
├─ SYNTHESIS.md     ← 跨論文綜合分析（先讀這份）
├─ _TABLES.json     ← 扁平比較表（約 10k tokens，橫向查詢用）
└─ <id>_<key>.json  ← 逐篇完整規格（11 檔，全載入約 38k tokens）
```

網站與 JSON **同源**（p07 由 JSON 自動產生），內容不會分歧。

---

## 給維護者：怎麼改

```bash
python3 tools/gen_matrix_module.py   # dissection/*.json → p07 模組原始檔
node tools/build.mjs                 # src/ → site/
node tools/verify.mjs                # file:// 安全 + 內容檢查，exit 0 才可發佈
node tools/audit_order.mjs           # 閱讀順序稽核
python3 tools/check_svg_layout.py    # SVG 文字重疊與超出畫布
```

改完 `src/` 底下的東西**一定要重新 build**，因為 `site/` 是產出物。

### 目錄結構

```
src/                      作者用，讀者不會打開
├─ modules/p00…p09.html   每頁一個檔（p07 為自動產生，勿手改）
├─ partials/shell.html    唯一的頁面模板
├─ svg/*.svg              手繪圖，一圖一檔，可獨立開啟預覽
└─ data/
   ├─ glossary.json       詞彙（唯一來源，115 條）
   └─ modules.json        頁面順序與 metadata

tools/                    不會發佈
├─ build.mjs              產生器
├─ verify.mjs             file:// 安全 + 內容 linter
├─ guards.mjs             「不要搞混」警告框的唯一名冊（15 個）
├─ gen_matrix_module.py   ★ 從 dissection/*.json 產生 p07
└─ check_svg_layout.py    SVG 檢查：class 組合、文字重疊、壓住資料點、超出畫布

site/                     ★ 交付物，整包複製就能用
```

### 資料來源

論文拆解的原始資料不在本 repo，而在
`/big8_disk/pingting114/MRD_detection/docs/paper/dissection/`。
`gen_matrix_module.py` 會直接讀該路徑 —— 改了 JSON 之後，
必須重跑該腳本再 build，否則 p07 會落後。

---

## 與 lab-tutorial 的關係

工具鏈、樣式、巨集語法**完全沿用** lab-tutorial，因此兩站的外觀與操作一致。
差異只有三處，皆有在地化的理由：

| 項目 | 差異 | 理由 |
|---|---|---|
| `tools/guards.mjs` | 換成本知識庫的 15 個警告框 | 主題不同 |
| `tools/verify.mjs` 第 10 項 | **不再擋「N 篇論文」** | lab-tutorial 的讀者手上沒有那些投影片；本知識庫的論文就收在 `docs/paper/`，讀者拿得到 |
| `site/assets/css/matrix.css` | 新增 `.matrix` | lab-tutorial 沒有「多篇 × 多步驟」的可展開矩陣 |
| `site/assets/css/diagram-ext.css` | **新檔**：補上 diagram.css 沒定義的 class 組合（`.mark.ok`、`.guide.thick` 等） | 未定義的修飾會被瀏覽器**靜默忽略**，圖看起來正常但少了顏色分級；不動 diagram.css，新增一律寫這裡 |

其餘（`build.mjs`、`mathml.mjs`、`audit_order.mjs`、全部 CSS 與 JS）未修改。

---

## 內容的三種來源，必須區分

| 類型 | 來源 | 可信度 |
|---|---|---|
| 問題設定、方法規格、效能數字、作者自承限制 | 論文原文 | 忠實轉述 |
| **實作細節**（3 篇：INVAR、ichorCNA、Landau 第三代） | **開源程式碼** | **高於論文文字** |
| 跨論文的綜合（p08、p09） | 本知識庫 | 可回溯至上述來源 |

**p09 的判斷會隨本專案的實測結果而修正** —— 它是目前的最佳判斷，不是定論。

---

## 已知的待補項目

| 項目 | 說明 |
|---|---|
| Tier B 的 8 篇未拆解 | 只有書目與一句話定位；需要細節時必須先拆，不可從書目臆測 |
| 部分格子「未公開」 | 如 CAPP-Seq 的 ④⑤ 在未取得的補充資料中，已照實標記 |
| 34 條詞彙尚未被引用 | 為完整性而定義（如 `nDR`、`limit of blank`），非缺陷 |
| 互動元件 | 目前無。最有價值的候選是「拉動 TF／深度／位點數三個滑桿看偵測機率」 |
