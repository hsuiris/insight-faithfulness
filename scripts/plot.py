"""畫三張圖：引文可驗證率、對照組的自稱趨勢比例、對照組的變化措辭比例。
用法：python3 scripts/plot.py"""
import json
import pathlib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

ROOT = pathlib.Path(__file__).resolve().parent.parent
scores = json.loads((ROOT / "data" / "scores.json").read_text())["summary"]
control = json.loads((ROOT / "data" / "control.json").read_text())

for name in ["Noto Sans CJK TC", "PingFang TC", "Heiti TC", "Arial Unicode MS", "Songti SC"]:
    if any(name in f.name for f in font_manager.fontManager.ttflist):
        plt.rcParams["font.family"] = name
        break
plt.rcParams["axes.unicode_minus"] = False

MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b", "oai:gpt-5", "oai:gpt-4o"]
short = [m.replace("oai:", "").split("/")[-1] for m in MODELS]
conds = [("free", "自由撰寫", "#d9694f"), ("cited", "要求逐字引用", "#3f8f7a")]
width = 0.36


def draw(ax, getter, title, ylabel):
    for i, (cond, label, color) in enumerate(conds):
        xs, vals = [], []
        for k, m in enumerate(MODELS):
            v = getter(m, cond)
            if v is not None:
                xs.append(k + i * width)
                vals.append(v * 100)
        bars = ax.bar(xs, vals, width, label=label, color=color)
        ax.bar_label(bars, fmt="%.0f%%", fontsize=11)
    for k, m in enumerate(MODELS):
        if getter(m, "free") is None and getter(m, "cited") is None:
            ax.text(k + width / 2, 6, "無資料", ha="center", fontsize=10, color="#888")
    ax.set_xticks([x + width / 2 for x in range(len(MODELS))])
    ax.set_xticklabels(short, fontsize=11)
    ax.set_ylabel(ylabel, fontsize=11)
    ax.set_title(title, fontsize=13, pad=10)
    ax.set_ylim(0, 112)
    ax.legend(fontsize=10, loc="upper right")


def ctrl(key):
    def get(m, c):
        v = control.get(m, {}).get(c)
        return v[key] if v else None

    return get


fig = plt.figure(figsize=(12.5, 9.5))
gs = fig.add_gridspec(2, 2, height_ratios=[1, 1], hspace=0.42, wspace=0.22)

draw(fig.add_subplot(gs[0, 0]), ctrl("selfLabelledRate"), "模型把主張自己標成「趨勢」", "自稱趨勢的主張佔比")
draw(fig.add_subplot(gs[0, 1]), ctrl("directionalRate"), "句子真的寫出方向（越來越、逐漸增加）", "有明確變化措辭的主張佔比")
draw(
    fig.add_subplot(gs[1, :]),
    lambda m, c: scores["byModel"].get(m, {}).get(c, {}).get("quoteRate"),
    "模型附的引用，有多少真的在日誌裡（全部三位人物）",
    "引文可逐字對回原文的比例",
)

fig.suptitle(
    "上排是對照組：一位三週毫無變化的虛構人物，她的報告裡任何「變化」都沒有依據",
    fontsize=14,
    y=0.97,
)
out = ROOT / "docs" / "results.png"
out.parent.mkdir(exist_ok=True)
fig.savefig(out, dpi=160)
print("寫入", out)
