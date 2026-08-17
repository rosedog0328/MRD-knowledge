#!/usr/bin/env python3
"""
check_svg_layout.py — 抓 SVG 圖裡的文字重疊與超出邊界

為什麼需要這支：CJK 字形是<b>滿高滿寬</b>的，跟拉丁文字很不一樣。
18px 的中文如果只給 18–20px 行距，實際上會擠在一起；至少要 26px。
這種問題在原始碼上看不出來，要算出 bounding box 才會發現。

字寬估法：CJK 一個字約等於 font-size，拉丁字母約 0.55×font-size。

用法：python3 tools/check_svg_layout.py
"""

import math
import pathlib
import re
import sys
import xml.etree.ElementTree as ET

SVG_DIR = pathlib.Path("src/svg")
CSS_FILES = [
    pathlib.Path("site/assets/css/diagram.css"),
    pathlib.Path("site/assets/css/diagram-ext.css"),
]

# 這些 token 只管排版（字級、對齊、字重），不影響顏色，
# 因此不參與「組合是否已定義」的比對。
LAYOUT_TOKENS = {"zh", "bold", "mid", "mono", "end"}


def defined_combos():
    """CSS 裡定義過的 class 組合，例如 `.dia-svg .bar.somatic` → {bar, somatic}。"""
    combos = set()
    for f in CSS_FILES:
        if not f.exists():
            continue
        src = f.read_text(encoding="utf-8")
        for m in re.finditer(r"\.dia-svg\s+((?:\.[a-z0-9-]+)+)", src):
            combos.add(frozenset(m.group(1).strip(".").split(".")))
    return combos


def check_classes(name, src, combos):
    """抓「基底 class 有定義，但修飾組合沒定義」的情形。

    為什麼要抓：這種錯誤完全不會報錯。瀏覽器只是套用基底樣式、
    忽略未定義的修飾 —— 於是「本來想標成綠色的資料點」靜靜地變成預設色，
    看起來就像設計如此。實際踩過：tradeoff-triangle 的四個資料點原本
    要以顏色分級（.mark.ok / .bad / .warn / .accent），
    但 diagram.css 只定義了 .mark.somatic / .germline / .artifact / .ref /
    .hp1 / .hp2，四個點全部渲染成同一色，圖的資訊量少了一半而沒人發現。

    ⚠️ 逐 token 比對會漏掉這類問題：`.anno.ok` 存在就讓 `ok` 變成「已知」，
    於是 `.mark.ok` 看起來也合法。必須比對**組合**。
    """
    bad = 0
    seen = set()
    for _tag, cls in re.findall(r'<(\w+)[^>]*class="([^"]+)"', src):
        toks = frozenset(cls.split()) - LAYOUT_TOKENS
        if not toks or cls in seen:
            continue
        if toks in combos or any(toks <= d for d in combos):
            continue
        seen.add(cls)
        print(f"  {name}: class 組合未定義 「{cls}」"
              f" —— 修飾會被靜默忽略，改用已定義的組合或補進 diagram-ext.css")
        bad += 1
    return bad

# class → font-size，對應 diagram.css 裡的定義
SIZE = {"ttl": 30, "lbl": 22, "anno": 18, "tick": 15, "base": 20}


def font_size(cls: str) -> int:
    for k, v in SIZE.items():
        if k in cls.split():
            return v
    return 18


def text_width(s: str, fs: int) -> float:
    w = 0.0
    for ch in s:
        # CJK、全形標點算一個字寬；其餘算 0.55
        if "⺀" <= ch <= "鿿" or "＀" <= ch <= "￯" or ch in "—·／、。「」（）":
            w += fs
        else:
            w += fs * 0.55
    return w


def rotated_aabb(x0, y0, w, h, deg, cx, cy):
    """把一個未旋轉的方框繞 (cx, cy) 轉 deg 度，回傳轉完後的軸對齊外接框。

    為什麼要這個：SVG 的 rotate() 只改繪製結果，不改屬性上的 x/y。
    先前的版本遇到 transform 就整段跳過，於是斜放的標籤等於沒被檢查 ——
    five-target-designs.svg 的「固定預算」斜標籤就是這樣溜過去的：
    它旋轉後往右下延伸約 170px，蓋住了下方的資料點標籤。

    這裡取「旋轉後四個角的軸對齊外接框」，比真正的斜方框大一些，
    也就是偏保守 —— 對 lint 而言寧可誤報也不要漏報。
    """
    rad = math.radians(deg)
    cos_r, sin_r = math.cos(rad), math.sin(rad)
    xs, ys = [], []
    for px, py in ((x0, y0), (x0 + w, y0), (x0, y0 + h), (x0 + w, y0 + h)):
        dx, dy = px - cx, py - cy
        xs.append(cx + dx * cos_r - dy * sin_r)
        ys.append(cy + dx * sin_r + dy * cos_r)
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)


def parse_transform(attrs: str):
    """回傳 (deg, cx, cy, tx, ty)；沒有 transform 就是 (0, 0, 0, 0, 0)。

    只支援 rotate 與 translate —— 本專案的圖只用到這兩種。
    出現其他 transform 時回傳 None，呼叫端會照實報成「無法檢查」而非默默跳過。
    """
    tm = re.search(r'transform="([^"]*)"', attrs)
    if not tm:
        return 0.0, 0.0, 0.0, 0.0, 0.0
    body = tm.group(1).strip()
    deg = cx = cy = tx = ty = 0.0
    seen = 0
    for fn, args in re.findall(r"(\w+)\s*\(([^)]*)\)", body):
        nums = [float(n) for n in re.findall(r"-?[\d.]+", args)]
        if fn == "rotate":
            deg = nums[0]
            if len(nums) >= 3:
                cx, cy = nums[1], nums[2]
            seen += 1
        elif fn == "translate":
            tx = nums[0]
            ty = nums[1] if len(nums) > 1 else 0.0
            seen += 1
        else:
            return None
    return (deg, cx, cy, tx, ty) if seen else (0.0, 0.0, 0.0, 0.0, 0.0)


def main():
    problems = 0
    combos = defined_combos()
    for f in sorted(SVG_DIR.glob("*.svg")):
        if f.name.startswith("_"):
            continue
        src = f.read_text(encoding="utf-8")
        src_nc = re.sub(r"<!--[\s\S]*?-->", "", src)

        # ── XML 必須 well-formed ─────────────────────────────────────────
        # 實際踩到才加的：漏一個 </text> 時，build.mjs 只是把整段字串 inline
        # 進 HTML，而 HTML parser 很寬容 —— 頁面照樣渲染，只是後面所有元素
        # 都被吞進那個沒關的 <text> 裡。沒有錯誤、沒有警告，圖悄悄壞掉。
        # 而 .svg 檔要能獨立開啟（見 CLAUDE.md §7），瀏覽器用 XML parser
        # 讀它時反而會直接拒絕整個檔案。
        try:
            ET.fromstring(src)
        except ET.ParseError as e:
            print(f"  {f.name}: XML 不合法 —— {e}")
            problems += 1
            continue

        problems += check_classes(f.name, src_nc, combos)

        vb = re.search(r'viewBox="0 0 (\d+) (\d+)"', src_nc)
        if not vb:
            print(f"  {f.name}: viewBox 格式不是 '0 0 W H'")
            problems += 1
            continue
        VW, VH = int(vb.group(1)), int(vb.group(2))

        boxes = []
        for m in re.finditer(
            r'<text\b([^>]*)>([\s\S]*?)</text>', src_nc
        ):
            attrs, inner = m.group(1), m.group(2)
            txt = re.sub(r"<[^>]+>", "", inner).strip()
            if not txt:
                continue
            cls = (re.search(r'class="([^"]*)"', attrs) or ["", ""])[1] if 'class="' in attrs else ""
            cls = re.search(r'class="([^"]*)"', attrs).group(1) if 'class="' in attrs else ""
            xm = re.search(r'\sx="(-?[\d.]+)"', attrs)
            ym = re.search(r'\sy="(-?[\d.]+)"', attrs)
            if not xm or not ym:
                continue          # 沒有 x/y 的（例如純靠 tspan 定位）跳過
            tf = parse_transform(attrs)
            if tf is None:
                print(f"  {f.name}: 無法檢查 「{txt[:26]}」"
                      f" —— 用了 rotate/translate 以外的 transform")
                problems += 1
                continue
            x, y = float(xm.group(1)), float(ym.group(1))
            fs = font_size(cls)
            # 覆寫 font-size 屬性
            fsm = re.search(r"font-size=[\"']?(\d+)", attrs)
            if fsm:
                fs = int(fsm.group(1))
            # style="font-size:20px" 也要算 —— 這是專案裡覆寫字級的「正解」寫法
            # （verify.mjs 第 12 項要求：跟 diagram.css 撞名的 property 必須走
            # inline style），所以絕大多數覆寫其實長這樣。只看 font-size= 屬性
            # 的話，這 120 多處都會被當成 class 的預設字級，寬度一路低估，
            # 重疊就測不出來。
            sfm = re.search(r"font-size\s*:\s*(\d+)", attrs)
            if sfm:
                fs = int(sfm.group(1))
            w = text_width(txt, fs)
            anchor_mid = "mid" in cls.split()
            anchor_end = "end" in cls.split()
            x0 = x - w / 2 if anchor_mid else (x - w if anchor_end else x)
            # y 是 baseline；ascent 約 0.82×fs、descent 約 0.18×fs
            y0 = y - fs * 0.82
            deg, rcx, rcy, tx, ty = tf
            x0, y0 = x0 + tx, y0 + ty
            bw, bh = w, float(fs)
            if deg:
                x0, y0, bw, bh = rotated_aabb(x0, y0, bw, bh, deg, rcx + tx, rcy + ty)
            boxes.append((x0, y0, bw, bh, txt))

        # 資料點（<circle class="mark …">）—— 文字絕不該蓋在上面。
        # 只收 mark，不收 .box 之類的容器：文字放在容器方框「裡面」是正常排版，
        # 蓋在資料點上才是版面錯誤。
        marks = []
        for m in re.finditer(r"<circle\b([^>]*)>", src_nc):
            a = m.group(1)
            cm = re.search(r'class="([^"]*)"', a)
            if not cm or "mark" not in cm.group(1).split():
                continue
            try:
                marks.append((float(re.search(r'\scx="(-?[\d.]+)"', a).group(1)),
                              float(re.search(r'\scy="(-?[\d.]+)"', a).group(1)),
                              float(re.search(r'\sr="(-?[\d.]+)"', a).group(1))))
            except AttributeError:
                continue

        for x0, y0, w, fs, txt in boxes:
            for cx, cy, r in marks:
                ox = min(x0 + w, cx + r) - max(x0, cx - r)
                oy = min(y0 + fs, cy + r) - max(y0, cy - r)
                if ox > 1.5 and oy > 1.5:
                    print(f"  {f.name}: 文字壓在資料點上（{ox:.0f}x{oy:.0f}px）"
                          f"「{txt[:26]}」 ↔ 圓心 ({cx:.0f}, {cy:.0f})")
                    problems += 1

        # 超出邊界
        for x0, y0, w, fs, txt in boxes:
            if x0 < -2 or x0 + w > VW + 2 or y0 < -2 or y0 + fs > VH + 2:
                print(f"  {f.name}: 文字超出畫布 「{txt[:26]}」"
                      f" x={x0:.0f}..{x0 + w:.0f} y={y0:.0f}..{y0 + fs:.0f} (畫布 {VW}x{VH})")
                problems += 1

        # 兩兩重疊
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                ax, ay, aw, ah, at = boxes[i]
                bx, by, bw, bh, bt = boxes[j]
                ox = min(ax + aw, bx + bw) - max(ax, bx)
                oy = min(ay + ah, by + bh) - max(ay, by)
                if ox > 1.5 and oy > 1.5:
                    print(f"  {f.name}: 文字重疊（{ox:.0f}x{oy:.0f}px）"
                          f"「{at[:20]}」 ↔ 「{bt[:20]}」")
                    problems += 1

    if problems:
        print(f"\n  共 {problems} 個版面問題")
        sys.exit(1)
    print("  ✓ 所有 SVG 正常（class 組合、文字重疊、壓住資料點、超出畫布）")


if __name__ == "__main__":
    main()
