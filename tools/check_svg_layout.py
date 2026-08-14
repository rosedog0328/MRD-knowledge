#!/usr/bin/env python3
"""
check_svg_layout.py — 抓 SVG 圖裡的文字重疊與超出邊界

為什麼需要這支：CJK 字形是<b>滿高滿寬</b>的，跟拉丁文字很不一樣。
18px 的中文如果只給 18–20px 行距，實際上會擠在一起；至少要 26px。
這種問題在原始碼上看不出來，要算出 bounding box 才會發現。

字寬估法：CJK 一個字約等於 font-size，拉丁字母約 0.55×font-size。

用法：python3 tools/check_svg_layout.py
"""

import pathlib
import re
import sys
import xml.etree.ElementTree as ET

SVG_DIR = pathlib.Path("src/svg")

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


def main():
    problems = 0
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
                continue          # 有 transform 的（例如旋轉的軸標）跳過
            if "transform" in attrs:
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
            boxes.append((x0, y0, w, fs, txt))

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
    print("  ✓ 所有 SVG 版面正常（無文字重疊、無超出畫布）")


if __name__ == "__main__":
    main()
