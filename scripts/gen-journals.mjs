// 依 data/spec.json 生成日誌，寫到 data/journals.json
// 用法：node scripts/gen-journals.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chat, countMarkers } from './lib.mjs';

const spec = JSON.parse(readFileSync(new URL('../data/spec.json', import.meta.url), 'utf8'));
const GEN_MODEL = 'openai/gpt-oss-120b';
const START = new Date('2026-08-24'); // 第一週週一

const SYSTEM = `你是虛構人物日誌的寫手。寫的是完全虛構的人物，不是真人。
規則：
1. 繁體中文，台灣用語（資料、程式碼、捷運、便利商店）。
2. 第一人稱，像真的日記：有日期當天的具體事件、對話片段、身體感覺。
3. 不要寫成勵志文，不要每篇都收在正向結尾。有些篇就是平淡或沒結論。
4. 不要出現自傷、自殺或求助專線的內容。
5. 只輸出 JSON。`;

function weekPrompt(p, week) {
  const blame = p.real_trend?.topic === 'self_blame' ? p.real_trend.plan[`w${week}`] : null;
  const conflict = p.real_trend?.topic === 'conflict' ? p.real_trend.plan[`w${week}`] : null;
  const lines = [
    `人物：${p.name}。${p.setting}`,
    `寫作習慣：${p.voice}`,
    `這是第 ${week} 週，要寫 ${spec.entries_per_week} 篇，每篇 150 到 300 字。`,
  ];
  if (blame !== null) {
    lines.push(
      `這一週整週合計要出現 ${blame} 次自責的句子，用這些說法：${spec.markers.self_blame.join('、')}。不要多也不要少，分散在不同篇。`,
    );
  }
  if (conflict !== null) {
    lines.push(
      `這一週要寫到 ${conflict} 次與伴侶的衝突事件（用「吵」「冷戰」「爭執」「不講話」這些字描述）。不要多也不要少。`,
    );
  }
  if (p.flat_trap.topic === 'sleep') {
    lines.push('這一週剛好提到一次睡眠狀況，寫成跟前幾週差不多，沒有變好也沒有變壞。');
  }
  if (p.flat_trap.topic === 'workload') {
    lines.push('這一週要提到工作量，並且明確寫出「跟上週差不多」這個意思。');
  }
  if (p.flat_trap.topic === 'all') {
    lines.push('三週之間不要有任何方向性的變化：情緒起伏隨機，主題分散，不要讓任何主題逐週變多或變少。');
  }
  if (p.one_off.week === week) lines.push(`這一週有一件只發生一次的事：${p.one_off.text}。後面幾週不會再提。`);
  lines.push(
    `輸出 JSON：{"entries":[{"day":1,"text":"..."}]}，day 是這一週的第幾天（1 到 7 之間挑 ${spec.entries_per_week} 天）。`,
  );
  return lines.join('\n');
}

const journals = [];
for (const p of spec.personas) {
  for (let week = 1; week <= spec.weeks; week++) {
    process.stderr.write(`生成 ${p.name} 第 ${week} 週... `);
    const out = await chat({ model: GEN_MODEL, system: SYSTEM, user: weekPrompt(p, week), temperature: 0.9 });
    for (const e of out.entries.slice(0, spec.entries_per_week)) {
      const d = new Date(START);
      d.setDate(d.getDate() + (week - 1) * 7 + (Number(e.day) || 1) - 1);
      journals.push({
        id: `${p.id}-w${week}-d${e.day}`,
        persona: p.id,
        week,
        date: d.toISOString().slice(0, 10),
        text: String(e.text).trim(),
      });
    }
    process.stderr.write('好\n');
  }
}

// 實際計數，之後以這份計數為準，不以計畫為準
const counts = {};
for (const p of spec.personas) {
  counts[p.id] = {};
  for (const [topic, markers] of Object.entries(spec.markers)) {
    counts[p.id][topic] = [1, 2, 3].map((w) =>
      journals
        .filter((j) => j.persona === p.id && j.week === w)
        .reduce((n, j) => n + countMarkers(j.text, markers), 0),
    );
  }
}

mkdirSync(new URL('../data', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/journals.json', import.meta.url), JSON.stringify({ journals, counts }, null, 2));
console.log(`寫入 ${journals.length} 篇日誌`);
console.log('各人物各主題的每週實際出現次數：');
console.log(JSON.stringify(counts, null, 2));
