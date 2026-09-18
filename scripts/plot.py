"""繪製主張標籤、措辭與引文匹配的描述統計；python3 scripts/plot.py。"""
import json
import math
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import Patch
from matplotlib.ticker import PercentFormatter

ROOT = Path(__file__).resolve().parent.parent
scores = json.loads((ROOT / "data/scores.json").read_text())
control = json.loads((ROOT / "data/control.json").read_text())
reports = json.loads((ROOT / "data/reports.json").read_text())
MODELS = list(scores["summary"]["byModel"])
CONDITIONS = [("free", "基本提示", "#315C88", None),
              ("cited", "加強引用約束", "#BA7929", "///")]

available = {font.name for font in font_manager.fontManager.ttflist}
for name in ["Noto Sans CJK TC", "PingFang TC", "Heiti TC", "Arial Unicode MS", "Songti SC"]:
    if name in available:
        plt.rcParams["font.family"] = name
        break
else:
    raise RuntimeError("請先安裝中文字型，例如 Noto Sans CJK TC。")
plt.rcParams.update({"font.size": 12, "axes.unicode_minus": False,
                     "text.color": "#26313D", "axes.labelcolor": "#26313D"})


def counts(model, condition, metric):
    """讀取整數筆數，核對已儲存比例，避免繪圖時把缺漏當成零。"""
    if metric != "quotes":
        cell = control[model][condition]
        source = [r for r in reports if r["persona"] == "C" and
                  r["model"] == model and r["condition"] == condition and r["claims"]]
        if cell is None:
            assert not source, "Ruby 統計缺漏，但 reports.json 有資料"
            return None
        numerator, denominator = cell[metric], cell["claims"]
        assert cell["reports"] == len(source)
        assert denominator == sum(len(r["claims"]) for r in source)
        if metric == "selfLabelled":
            assert numerator == sum(c["type"] == "trend" for r in source for c in r["claims"])
        stored_rate = cell[metric + "Rate"]
    else:
        rows = [r for r in scores["rows"] if r["model"] == model and r["condition"] == condition]
        numerator = sum(r["quotesOk"] for r in rows)
        denominator = sum(r["quotesTotal"] for r in rows)
        stored_rate = scores["summary"]["byModel"][model][condition]["quoteRate"]
        if not denominator:
            assert stored_rate is None
            return None
    assert 0 <= numerator <= denominator and denominator > 0
    assert math.isclose(numerator / denominator, stored_rate)
    return numerator, denominator


fig, axes = plt.subplots(3, 1, figsize=(12, 17))
fig.subplots_adjust(left=0.20, right=0.76, top=0.835, bottom=0.13, hspace=0.53)
fig.suptitle("自我覺察報告：標籤、措辭與引文匹配", x=0.06, y=0.978,
             ha="left", fontsize=23, weight="bold")
fig.text(0.06, 0.944, "描述統計｜6 個模型 · 70 份報告 · 695 個主張｜未經人工語意標註", fontsize=13)
fig.legend(handles=[Patch(facecolor=color, edgecolor=color, hatch=hatch, label=label,
                          alpha=1 if hatch is None else 0.65)
                    for _, label, color, hatch in CONDITIONS],
           loc="upper left", bbox_to_anchor=(0.05, 0.929), ncol=2, frameon=False)

panels = [
    ("selfLabelled", "A  趨勢標籤比例", "Ruby｜type = trend 的主張數 ÷ 全部主張數"),
    ("directional", "B  變化措辭命中率", "Ruby｜命中變化詞規則的主張數 ÷ 全部主張數"),
    ("quotes", "C  引文可驗證率", "全部三位人物｜通過正規化文字匹配的引文數 ÷ 全部引文數"),
]
for ax, (metric, title, subtitle) in zip(axes, panels):
    ax.set_title(title, loc="left", fontsize=17, weight="bold", pad=40)
    ax.text(0, 1.065, subtitle, transform=ax.transAxes, fontsize=12)
    ax.text(1.025, 1.02, "比例（分子／分母）", transform=ax.transAxes, fontsize=11)
    for index, model in enumerate(MODELS):
        for offset, (condition, _, color, hatch) in zip([-0.18, 0.18], CONDITIONS):
            y = index + offset
            pair = counts(model, condition, metric)
            if pair is None:
                ax.text(2, y, "缺資料", va="center", color="#687481", fontsize=11)
                label = "未取得報告"
            else:
                numerator, denominator = pair
                rate = numerator / denominator * 100
                ax.barh(y, rate, height=0.29, color=color, edgecolor=color,
                        hatch=hatch, alpha=1 if hatch is None else 0.65, zorder=3)
                # 零值保留可見標記；缺資料不畫標記。
                if numerator == 0:
                    ax.plot(0, y, "|", color=color, markersize=10, clip_on=False, zorder=4)
                label = f"{rate:.1f}%  ({numerator}/{denominator})"
            ax.text(1.025, y, label, transform=ax.get_yaxis_transform(),
                    va="center", fontsize=11, color=color)
    ax.set_yticks(range(len(MODELS)), [m.replace("oai:", "").split("/")[-1] for m in MODELS])
    ax.set_ylim(len(MODELS) - 0.5, -0.6)
    ax.set_xlim(0, 100)
    ax.set_xticks([0, 25, 50, 75, 100])
    ax.xaxis.set_major_formatter(PercentFormatter(100, decimals=0))
    ax.grid(axis="x", color="#E2E6EB", linewidth=0.7, zorder=0)
    ax.tick_params(axis="both", length=0, pad=8)
    for edge in ["top", "right"]:
        ax.spines[edge].set_visible(False)
    for edge in ["left", "bottom"]:
        ax.spines[edge].set_color("#ADB6C0")

fig.text(0.06, 0.087,
         "A、B 每個模型／條件各 2 份報告；gpt-oss-120b 的加強引用約束缺少 Ruby 的 2 份。\n"
         "C 基本提示共 36 份報告，加強引用約束共 34 份；兩條件的樣本組成不同。\n"
         "標籤與措辭比例不代表幻覺率；Ruby 的無趨勢設定尚未經人工驗證。\n"
         "引文匹配不代表主張獲得支持。比例按筆數合計；未估計信賴區間。",
         fontsize=11, linespacing=1.7, va="top")
fig.text(0.06, 0.010, "資料：data/control.json、data/scores.json｜定義與限制：README.md", fontsize=10, color="#687481")
out = ROOT / "docs/results.png"
fig.savefig(out, dpi=180, facecolor="white")
plt.close(fig)
print(f"已驗證計數與比例，寫入 {out}")
