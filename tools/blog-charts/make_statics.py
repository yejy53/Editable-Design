"""Wide (1000px) static pairwise-evaluation boards, rendered in Chinese and English.

These are internal exploratory simulations. The comparison format (pairwise blind judging +
relative rating display) is inspired by Design Arena, but no Design Arena branding is drawn and
every exported image carries a burned-in "not official" notice in the masthead.

PNG outputs are saved under site/public/blog/genclaw-next/charts/<lang>/.
HTML render sources are written under tools/blog-charts/rendered/<lang>/:
  wide_oneshot_board.png    非 agentic 排名，含 qwen 微调跃升弧线
  wide_design_compare.png   策略开启前后，基线段 + 增量段
  wide_leaderboard.png      agentic 基线排名
  wide_ref_compare.png      海报，有无视觉参考
  wide_design_ab.png        策略配对胜负
"""

from __future__ import annotations

import argparse
import math
import re
from pathlib import Path

HERE = Path(__file__).parent
ICON_DIR = HERE / "icons"
OUT = HERE.parent.parent / "site/public/blog/genclaw-next/charts"
HTML_ONLY = False

PAGE_W = 1000
ROW_H, BAR_H = 48, 24

BG = "#FFFFFF"
INK = "#1A1915"
INK_SOFT = "#3C3A35"
MUTED = "#5F5D57"
FAINT = "#8B8880"
RULE = "#ECE9E3"
RULE_STRONG = "#D8D4CB"
BAR = "#121F87"
GAIN = "#D99A2B"
LOSS = "#B4503A"
TIE = "#DCD8CE"
NEG = "#C8A27A"
RING = "#E3C332"
RING_BG = "#FDF6DC"

SANS = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", Arial, sans-serif'
MONO = '"SF Mono", "Menlo", "Consolas", monospace'

NEEDS_CHIP = {"kimi-color", "chatglm-color"}
BOLT = ('<svg width="10" height="13" viewBox="0 0 9 12" style="margin-right:6px">'
        f'<path d="M5.6 0 0 7h2.9L3.4 12 9 4.8H5.1L5.6 0Z" fill="{GAIN}"/></svg>')

RANK_W, NAME_W, MARK_W, GAP = 24, 218, 30, 12

TEXT = {
    "zh": dict(
        disclaimer="内部探索性模拟 · 非 Design Arena 官方结果",
        img="生图 {:.1f} 张 / 题",
        image_refs="配图 {:.1f} 张 / 题",
        img_delta="生图 {:.1f} → {:.1f} 张 / 题",
        t_oneshot="WebDev · 单轮直出",
        t_design="WebDev · 策略开启前后",
        t_ref="Poster · 视觉参考前后",
        t_board="WebDev · Agentic 基线",
        t_ab="WebDev · 策略配对胜负",
        leg_off="未启用策略", leg_gain="启用策略后的增量",
        leg_noref="无视觉参考", leg_refgain="加入视觉参考后的增量",
        win="胜", tie="平", loss="负", mid="中线 = 50%",
        col_rating="Rating", col_winrate="胜率", col_decisive="决胜局", col_wtl="胜-平-负",
    ),
    "en": dict(
        disclaimer="Exploratory simulation · Not official Design Arena results",
        img="{:.1f} images / task",
        image_refs="{:.1f} image refs / task",
        img_delta="{:.1f} → {:.1f} images / task",
        t_oneshot="WebDev · Single-pass",
        t_design="WebDev · Strategy Off vs. On",
        t_ref="Poster · Visual Reference Off vs. On",
        t_board="WebDev · Agentic Baseline",
        t_ab="WebDev · Strategy Head-to-Head",
        leg_off="Strategy off", leg_gain="Gain with strategy",
        leg_noref="No visual reference", leg_refgain="Gain with visual reference",
        win="Win", tie="Tie", loss="Loss", mid="Midline = 50%",
        col_rating="Rating", col_winrate="Win rate", col_decisive="Decisive", col_wtl="W-T-L",
    ),
}
LANG = "zh"
T = TEXT[LANG]


def use(lang):
    global LANG, T
    LANG, T = lang, TEXT[lang]


def hatch(color):
    return f"repeating-linear-gradient(135deg,{color} 0 9.4px,#FFFFFF 9.4px 11.4px)"


def mark(name, size=22):
    svg = (ICON_DIR / f"{name}.svg").read_text(encoding="utf-8")
    svg = re.sub(r"<title>.*?</title>", "", svg)
    inner = size - 5 if name in NEEDS_CHIP else size
    svg = svg.replace('height="1em"', f'height="{inner}"').replace('width="1em"', f'width="{inner}"')
    svg = svg.replace('fill="currentColor"', f'fill="{INK}"')
    if name not in NEEDS_CHIP:
        return svg
    return (f'<span style="width:{size + 4}px;height:{size + 4}px;border-radius:6px;'
            f'background:{INK};display:flex;align-items:center;justify-content:center">{svg}</span>')


def css(value_w, aside_w, legend_inset):
    left = RANK_W + NAME_W + MARK_W + GAP * 3
    right = value_w + aside_w + GAP * 2
    return f"""
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; padding: 22px 38px 16px; width: {PAGE_W}px; background: {BG};
    color: {INK}; font-family: {SANS}; text-rendering: geometricPrecision;
  }}
  .masthead {{ display: flex; align-items: flex-start; gap: 24px; margin-bottom: 20px; }}
  h1 {{
    margin: 0; font-family: {SANS}; font-weight: 600; font-size: 26px; line-height: 34px;
    letter-spacing: -0.2px; display: flex; align-items: center; gap: 14px; white-space: nowrap;
  }}
  .autoeval {{
    display: inline-flex; align-items: center; font-family: {SANS}; font-size: 13.5px;
    font-weight: 400; letter-spacing: 0; color: #9A6B12; background: #FBF2DC;
    border: 1px solid #EBD9A8; border-radius: 999px; padding: 5px 15px 5px 12px;
  }}
  .scope {{
    font-family: {MONO}; font-size: 12.5px; letter-spacing: 2px; color: {INK_SOFT}; margin-top: 8px;
  }}
  .scope em {{ font-style: normal; color: {FAINT}; }}
  .disclaimer {{
    margin-left: auto; margin-top: 3px; flex-shrink: 0; white-space: nowrap;
    font-size: 12.5px; line-height: 18px; color: {MUTED};
    border: 1px solid {RULE_STRONG}; border-radius: 5px; padding: 5px 11px;
  }}
  .legend {{
    display: flex; gap: 22px; align-items: center; margin: 0 0 14px {legend_inset}px;
    font-size: 12px; color: {INK_SOFT};
  }}
  .legend .item {{ display: flex; align-items: center; gap: 8px; }}
  .legend .sw {{ width: 15px; height: 15px; border-radius: 2px; }}
  .colhead {{
    display: grid; column-gap: {GAP}px; margin-bottom: 8px;
    grid-template-columns: {RANK_W}px {NAME_W}px {MARK_W}px 1fr {value_w}px {aside_w}px;
    font-family: {MONO}; font-size: 10.5px; letter-spacing: 1.2px; color: {FAINT};
    text-transform: uppercase; white-space: nowrap;
  }}
  .colhead div:nth-child(5), .colhead div:nth-child(6) {{ text-align: right; direction: rtl; }}
  .rows {{ position: relative; }}
  .gridlayer {{
    position: absolute; top: 0; bottom: 0; left: {left}px; right: {right}px; pointer-events: none;
  }}
  .gline {{ position: absolute; top: 0; bottom: 0; width: 1px; background: {RULE}; }}
  .row {{
    position: relative; z-index: 1; display: grid; align-items: center; height: {ROW_H}px;
    column-gap: {GAP}px;
    grid-template-columns: {RANK_W}px {NAME_W}px {MARK_W}px 1fr {value_w}px {aside_w}px;
  }}
  .row.hot .ring {{
    position: absolute; z-index: -1; left: -10px; right: -10px; top: 2px; bottom: 2px;
    background: {RING_BG}; border-radius: 7px; box-shadow: 0 0 0 1.5px {RING};
  }}
  .rank {{
    width: 22px; height: 22px; border-radius: 50%; border: 1px solid {RULE_STRONG};
    display: flex; align-items: center; justify-content: center;
    font-family: {MONO}; font-size: 11.5px; color: {MUTED};
  }}
  .name {{ font-size: 15px; line-height: 19px; color: {INK}; white-space: nowrap; }}
  .name .sub {{
    display: block; font-family: {MONO}; font-size: 12.5px; line-height: 16px;
    color: {MUTED}; font-weight: 600;
  }}
  .mark-cell {{ display: flex; align-items: center; }}
  .barcell {{ position: relative; height: {BAR_H}px; }}
  .bar {{ position: absolute; top: 0; height: {BAR_H}px; }}
  .value {{ font-family: {MONO}; font-size: 15px; text-align: right; color: {INK_SOFT}; }}
  .aside {{ font-family: {MONO}; font-size: 13.5px; text-align: right; color: {MUTED}; }}
  .axis {{
    position: relative; height: 24px; margin-top: 4px;
    margin-left: {left}px; margin-right: {right}px; border-top: 1px solid {RULE_STRONG};
  }}
  .tick {{
    position: absolute; top: 6px; transform: translateX(-50%);
    font-family: {MONO}; font-size: 12.5px; color: {MUTED};
  }}
  .leap {{ position: absolute; right: 0; z-index: 2; }}
  .seg {{ display: flex; align-items: center; justify-content: center; }}
  .seg span {{ font-family: {MONO}; font-size: 12px; font-weight: 600; }}
  .half {{ position: absolute; left: 50%; top: -3px; bottom: -3px; width: 1px; background: {RULE_STRONG}; }}
"""


def page(title, style, headline, scope, body):
    return f"""<!doctype html>
<html lang="{LANG}"><head><meta charset="utf-8"><title>{title}</title><style>{style}</style></head>
<body>
  <div class="masthead">
    <div><h1>{headline}</h1><div class="scope">{scope}</div></div>
    <div class="disclaimer">{T['disclaimer']}</div>
  </div>
  {body}
</body></html>"""


def shoot(html_path, png_path):
    if HTML_ONLY:
        print(f"HTML -> {html_path}")
        return
    from playwright.sync_api import sync_playwright
    with sync_playwright() as play:
        b = play.chromium.launch()
        pg = b.new_page(viewport={"width": PAGE_W, "height": 900}, device_scale_factor=3)
        pg.goto(html_path.resolve().as_uri())
        pg.wait_for_timeout(450)
        h = pg.evaluate("document.body.getBoundingClientRect().height")
        pg.set_viewport_size({"width": PAGE_W, "height": math.ceil(h)})
        pg.wait_for_timeout(200)
        pg.screenshot(path=str(png_path))
        b.close()
    print("PNG  -> %s  (%.0f KB)" % (png_path, png_path.stat().st_size / 1024))


def axis_bits(amin, amax, ticks):
    p = lambda v: (v - amin) / (amax - amin) * 100
    grid = "".join('<div class="gline" style="left:%.3f%%"></div>' % p(t) for t in ticks)
    axis = "".join('<div class="tick" style="left:%.3f%%">%s</div>' % (p(t), format(t, ","))
                   for t in ticks)
    return p, grid, axis


def emit(stem, style, headline, scope, body):
    html_dir, png_dir = HERE / "rendered" / LANG, OUT / LANG
    html_dir.mkdir(parents=True, exist_ok=True)
    png_dir.mkdir(parents=True, exist_ok=True)
    html = html_dir / (stem + ".html")
    html.write_text(page(stem, style, headline, scope, body), encoding="utf-8")
    shoot(html, png_dir / (stem + ".png"))


def legend_html(*items, extra=""):
    return ('<div class="legend">' + "".join(
        f'<div class="item"><span class="sw" style="background:{bg}"></span>{label}</div>'
        for bg, label in items) + extra + '</div>')


# ---------------------------------------------------------------- 单轮直出

def oneshot():
    amin, amax, ticks = 740, 1250, [800, 900, 1000, 1100, 1200]
    value_w, aside_w = 60, 110
    rows = [
        ("GPT-5.6 Sol", "openai", 1209, 7.8, "solid"),
        ("Kimi K3", "kimi-color", 1179, 11.0, "solid"),
        ("Qwen3.6 27B SFT", "qwen-color", 1060, 16.0, "hatch"),
        ("Gemini 3.5 Flash", "gemini-color", 999, 10.1, "solid"),
        ("GPT-5.5", "openai", 995, 3.8, "solid"),
        ("MiniMax M3", "minimax-color", 980, 4.6, "solid"),
        ("Claude Opus 4.8", "claude-color", 924, 1.9, "solid"),
        ("Qwen3.6 27B Base", "qwen-color", 851, 3.8, "amber"),
        ("DeepSeek V4 Pro preview", "deepseek-color", 802, 2.5, "solid"),
    ]
    hot, frm = 2, 7
    p, grid, axis = axis_bits(amin, amax, ticks)
    fills = {"solid": BAR, "amber": GAIN, "hatch": hatch(GAIN)}
    html_rows = []
    for i, (name, icon, rating, img, kind) in enumerate(rows):
        html_rows.append(f"""
    <div class="row{' hot' if i == hot else ''}">
      {'<div class="ring"></div>' if i == hot else ''}
      <div class="rank">{i + 1}</div>
      <div class="name">{name}<span class="sub">{T['image_refs'].format(img)}</span></div>
      <div class="mark-cell">{mark(icon)}</div>
      <div class="barcell"><div class="bar" style="left:0;width:{p(rating):.3f}%;background:{fills[kind]}"></div></div>
      <div class="value">{rating:,}</div><div class="aside"></div>
    </div>""")

    top, bottom = hot * ROW_H + ROW_H // 2, frm * ROW_H + ROW_H // 2
    height = bottom - top + 36
    x, y_end, y_start = 18, 24, height - 12
    cx, cy = 84, height / 2
    ang = math.degrees(math.atan2(y_end - cy, x - cx)) + 90
    leap = f"""
    <svg class="leap" width="{aside_w}" height="{height}" style="top:{top - 24}px"
         viewBox="0 0 {aside_w} {height}" fill="none">
      <path d="M{x} {y_start} Q {cx} {cy:.0f} {x} {y_end}" stroke="{GAIN}"
            stroke-width="2.8" fill="none" stroke-linecap="round"/>
      <path d="M{x} {y_end - 9} l7 13 -14 0 Z" fill="{GAIN}"
            transform="rotate({ang:.1f} {x} {y_end - 1})"/>
      <text x="56" y="{cy + 5:.0f}" fill="{GAIN}" font-family='{MONO}'
            font-size="15" font-weight="700">+209</text>
    </svg>"""

    body = f"""<div class="rows"><div class="gridlayer">{grid}</div>{''.join(html_rows)}{leap}</div>
  <div class="axis">{axis}</div>"""
    emit("wide_oneshot_board", css(value_w, aside_w, 0),
         f'{T["t_oneshot"]}<span class="autoeval">{BOLT}AutoEval</span>',
         "NON-AGENTIC <em>· 50 CASES</em>", body)


# ------------------------------------------------------- 拆段柱：前后对照

def split_board(stem, headline, scope, rows, amin, amax, ticks,
                legend, sub_fmt=None, value_w=60, aside_w=64):
    p, grid, axis = axis_bits(amin, amax, ticks)
    left = RANK_W + NAME_W + MARK_W + GAP * 3
    html_rows = []
    for i, row in enumerate(rows):
        name, icon, after, before = row[:4]
        gain = after - before
        lo, hi = min(after, before), max(after, before)
        fill = hatch(GAIN) if gain > 0 else LOSS
        tone = GAIN if gain > 0 else LOSS
        width = max(p(hi) - p(lo), 0.4)
        sub = ""
        if sub_fmt and len(row) > 4:
            sub = f'<span class="sub">{sub_fmt.format(*row[4:])}</span>'
        html_rows.append(f"""
    <div class="row">
      <div class="rank">{i + 1}</div>
      <div class="name">{name}{sub}</div>
      <div class="mark-cell">{mark(icon)}</div>
      <div class="barcell">
        <div class="bar" style="left:0;width:{p(lo):.3f}%;background:{BAR}"></div>
        <div class="bar" style="left:{p(lo):.3f}%;width:{width:.3f}%;background:{fill}"></div>
      </div>
      <div class="value">{after:,}</div>
      <div class="aside" style="color:{tone};font-weight:600">{'+' if gain > 0 else '−'}{abs(gain)}</div>
    </div>""")
    body = f"""{legend}
  <div class="rows"><div class="gridlayer">{grid}</div>{''.join(html_rows)}</div>
  <div class="axis">{axis}</div>"""
    emit(stem, css(value_w, aside_w, left), headline, scope, body)


def design_compare():
    split_board(
        "wide_design_compare", T["t_design"], "AGENTIC <em>· 50 CASES</em>",
        [("Claude Opus 4.8", "claude-color", 1225, 1039, 5.09, 13.41),
         ("MiniMax M3", "minimax-color", 1174, 1024, 4.68, 13.41),
         ("Kimi K3", "kimi-color", 1105, 1107, 7.95, 7.52),
         ("Gemini 3.5 Flash", "gemini-color", 1009, 844, 3.09, 6.45),
         ("GPT-5.5", "openai", 958, 831, 1.09, 5.26),
         ("Qwen3.6 27B", "qwen-color", 939, 762, 1.50, 4.70),
         ("DeepSeek V4 Pro preview", "deepseek-color", 924, 762, 1.00, 10.19)],
        700, 1270, [800, 900, 1000, 1100, 1200],
        legend_html((BAR, T["leg_off"]), (hatch(GAIN), T["leg_gain"])), T["img_delta"])


def ref_compare():
    split_board(
        "wide_ref_compare", T["t_ref"], "AGENTIC <em>· 30 CASES</em>",
        [("Claude Opus 4.8", "claude-color", 1169, 924),
         ("Kimi K3", "kimi-color", 1143, 926),
         ("Gemini 3.5 Flash", "gemini-color", 1061, 853),
         ("GPT-5.5", "openai", 1047, 982),
         ("MiniMax M3", "minimax-color", 966, 957)],
        780, 1215, [850, 950, 1050, 1150],
        legend_html((BAR, T["leg_noref"]), (hatch(GAIN), T["leg_refgain"])))


# ---------------------------------------------------------------- 基线排名

def leaderboard():
    amin, amax, ticks = 640, 1220, [700, 800, 900, 1000, 1100, 1200]
    value_w, aside_w = 60, 76
    rows = [("Kimi K3", "kimi-color", 1143, 7.95, 0.698),
            ("Claude Opus 4.8", "claude-color", 1117, 5.09, 0.668),
            ("MiniMax M3", "minimax-color", 1116, 4.79, 0.652),
            ("GLM 5.2", "chatglm-color", 1109, 5.67, 0.648),
            ("GPT-5.5", "openai", 939, 1.09, 0.430),
            ("Gemini 3.5 Flash", "gemini-color", 873, 3.09, 0.338),
            ("DeepSeek V4 Pro preview", "deepseek-color", 704, 1.05, 0.147)]
    sparse = {"GPT-5.5", "DeepSeek V4 Pro preview"}
    p, grid, axis = axis_bits(amin, amax, ticks)
    html_rows = []
    for i, (name, icon, rating, img, win) in enumerate(rows):
        tone = f"color:{LOSS}" if name in sparse else ""
        html_rows.append(f"""
    <div class="row">
      <div class="rank">{i + 1}</div>
      <div class="name">{name}<span class="sub" style="{tone}">{T['img'].format(img)}</span></div>
      <div class="mark-cell">{mark(icon)}</div>
      <div class="barcell"><div class="bar" style="left:0;width:{p(rating):.3f}%;background:{BAR}"></div></div>
      <div class="value">{rating:,}</div><div class="aside">{win:.0%}</div>
    </div>""")
    body = f"""
  <div class="colhead"><div></div><div></div><div></div><div></div><div>{T['col_rating']}</div><div>{T['col_winrate']}</div></div>
  <div class="rows"><div class="gridlayer">{grid}</div>{''.join(html_rows)}</div>
  <div class="axis">{axis}</div>"""
    emit("wide_leaderboard", css(value_w, aside_w, 0), T["t_board"],
         "AGENTIC <em>· 3 JUDGES · 50 CASES</em>", body)


# ------------------------------------------------------------ 配对胜负

def design_ab():
    value_w, aside_w = 54, 96
    left = RANK_W + NAME_W + MARK_W + GAP * 3
    rows = [("GPT-5.5", "openai", 15, 4, 4, 1.09, 5.26),
            ("Claude Opus 4.8", "claude-color", 14, 4, 3, 5.09, 13.41),
            ("DeepSeek V4 Pro preview", "deepseek-color", 11, 3, 5, 1.00, 10.19),
            ("Gemini 3.5 Flash", "gemini-color", 11, 4, 6, 3.09, 6.45),
            ("MiniMax M3", "minimax-color", 7, 3, 4, 4.68, 13.41),
            ("Kimi K3", "kimi-color", 7, 5, 7, 7.95, 7.52)]
    html_rows = []
    for i, (name, icon, w, t, l, a, b) in enumerate(rows):
        total = w + t + l
        segs = "".join(
            '<div class="seg" style="width:%.3f%%;background:%s"><span style="color:%s">%d%%</span></div>'
            % (c / total * 100, col, txt, round(c / total * 100))
            for c, col, txt in ((w, BAR, "#FBFAF6"), (t, TIE, INK_SOFT), (l, NEG, "#3A2A18")))
        html_rows.append(f"""
    <div class="row">
      <div class="rank">{i + 1}</div>
      <div class="name">{name}<span class="sub">{T['img_delta'].format(a, b)}</span></div>
      <div class="mark-cell">{mark(icon)}</div>
      <div class="barcell" style="display:flex;border-radius:2px;overflow:hidden">{segs}<div class="half"></div></div>
      <div class="value">{w / (w + l):.0%}</div>
      <div class="aside">{w}-{t}-{l}</div>
    </div>""")
    legend = legend_html((BAR, T["win"]), (TIE, T["tie"]), (NEG, T["loss"]),
                         extra=f'<div class="item" style="color:{FAINT}">{T["mid"]}</div>')
    body = f"""{legend}
  <div class="colhead"><div></div><div></div><div></div><div></div><div>{T['col_decisive']}</div><div>{T['col_wtl']}</div></div>
  <div class="rows">{''.join(html_rows)}</div>"""
    emit("wide_design_ab", css(value_w, aside_w, left), T["t_ab"],
         "AGENTIC <em>· PAIRED</em>", body)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--html-only", action="store_true", help="Write HTML without starting a renderer")
    HTML_ONLY = parser.parse_args().html_only
    for lang in ("zh", "en"):
        use(lang)
        oneshot()
        design_compare()
        leaderboard()
        ref_compare()
        design_ab()
