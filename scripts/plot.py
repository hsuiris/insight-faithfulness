"""畫兩張圖：引文可驗證率、對無趨勢人物的變化型主張比例。用法：python3 scripts/plot.py"""
import json
import pathlib
import re
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

ROOT = pathlib.Path(__file__).resolve().parent.parent
scores = json.loads((ROOT / "data" / "scores.json").read_text())["summary"]
reports = json.loads((ROOT / "data" / "reports.json").read_text())

for name in ["Noto Sans CJK TC", "PingFang TC", "Heiti TC", "Arial Unicode MS", "Songti SC"]:
    if any(name in f.name for f in font_manager.fontManager.ttflist):
        plt.rcParams["font.family"] = name
        break
plt.rcParams["axes.unicode_minus"] = False

CHANGE = re.compile("越來越|逐漸|漸漸|日益|一週比一週|隨時間|增加|變多|上升|加劇|惡化|升高|減少|變少|下降|降低|改善|好轉|趨勢|更頻繁")


def change_share(persona, model, condition):
    rs = [r for r in reports if r["persona"] == persona and r["condition"] == condition and r["claims"]
          and (model is None or r["model"] == model)]
    total = sum(len(r["claims"]) for r in rs)
    if not total:
        return None
    ch = sum(1 for r in rs for c in r["claims"] if c["type"] == "trend" or CHANGE.search(c["text"]))
    return ch / total * 100


models = list(scores["byModel"].keys())
short = [m.split("/")[-1] for m in models]
conds = [("free", "自由撰寫", "#d9694f"), ("cited", "要求逐字引用", "#3f8f7a")]
width = 0.36

fig, axes = plt.subplots(1, 2, figsize=(12.5, 4.8))

ax = axes[0]
for i, (cond, label, color) in enumerate(conds):
    vals = [(scores["byModel"][m][cond]["quoteRate"] or 0) * 100 for m in models]
    bars = ax.bar([x + i * width for x in range(len(models))], vals, width, label=label, color=color)
    ax.bar_label(bars, fmt="%.0f%%", fontsize=9)
ax.set_xticks([x + width / 2 for x in range(len(models))])
ax.set_xticklabels(short, fontsize=9)
ax.set_ylabel("引文可逐字對回原文的比例")
ax.set_title("模型附的引用，有多少真的在日誌裡")
ax.set_ylim(0, 112)
ax.legend(fontsize=9, loc="lower right")

ax = axes[1]
for i, (cond, label, color) in enumerate(conds):
    xs, vals = [], []
    for k, m in enumerate(models):
        v = change_share("C", m, cond)
        if v is not None:
            xs.append(k + i * width)
            vals.append(v)
    bars = ax.bar(xs, vals, width, label=label, color=color)
    ax.bar_label(bars, fmt="%.0f%%", fontsize=9)
# 沒有資料的模型標註原因，不要畫成 0
for k, m in enumerate(models):
    if change_share("C", m, "free") is None:
        ax.text(k + width / 2, 6, "當日額度用完\n無資料", ha="center", fontsize=9, color="#888")
ax.set_xticks([x + width / 2 for x in range(len(models))])
ax.set_xticklabels(short, fontsize=9)
ax.set_ylabel("變化型主張佔所有主張的比例")
ax.set_title("對照組 Ruby 三週毫無變化，模型卻說了多少「變化」")
ax.set_ylim(0, 112)
ax.legend(fontsize=9, loc="lower right")

fig.suptitle("跨週自我覺察報告的忠實度｜Groq 上三個開源模型、三位虛構人物、29 份報告", fontsize=13)
fig.tight_layout()
out = ROOT / "docs" / "results.png"
out.parent.mkdir(exist_ok=True)
fig.savefig(out, dpi=160)
print("寫入", out)
for m in models:
    print(m, "C free", change_share("C", m, "free"), "C cited", change_share("C", m, "cited"))
