// 對照組專用：Ruby 三週毫無變化，模型講了多少「變化」
// 兩個分開的指標，避免把「反覆出現的模式」誤算成「宣稱變化」
// 用法：node scripts/control.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { normalize } from './lib.mjs';

const reports = JSON.parse(readFileSync(new URL('../data/reports.json', import.meta.url), 'utf8'));

// 只有明確指出方向或跨時間比較的措辭才算
const DIRECTIONAL = /越來越|逐漸|漸漸|日益|一週比一週|隨時間|一次比一次|增加|變多|上升|加劇|惡化|升高|更頻繁|更嚴重|減少|變少|下降|降低|趨緩|好轉|從.{0,8}(到|變成)|相較(於)?(前|上)/;

const MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'oai:gpt-5', 'oai:gpt-4o'];
const out = {};
for (const m of MODELS) {
  out[m] = {};
  for (const cond of ['free', 'cited']) {
    const rs = reports.filter((r) => r.persona === 'C' && r.model === m && r.condition === cond && r.claims.length);
    const total = rs.reduce((n, r) => n + r.claims.length, 0);
    if (!total) {
      out[m][cond] = null;
      continue;
    }
    let selfLabelled = 0;
    let directional = 0;
    const examples = [];
    for (const r of rs) {
      for (const c of r.claims) {
        if (c.type === 'trend') selfLabelled++;
        if (DIRECTIONAL.test(normalize(c.text))) {
          directional++;
          if (examples.length < 3) examples.push(c.text);
        }
      }
    }
    out[m][cond] = {
      reports: rs.length,
      claims: total,
      selfLabelled,
      selfLabelledRate: selfLabelled / total,
      directional,
      directionalRate: directional / total,
      examples,
    };
  }
}

writeFileSync(new URL('../data/control.json', import.meta.url), JSON.stringify(out, null, 2));

const pct = (x) => `${(x * 100).toFixed(0)}%`;
console.log('對照組 Ruby：三週沒有任何方向性變化\n');
console.log('模型              條件    主張數  模型自稱趨勢      句子有變化措辭');
for (const m of MODELS) {
  for (const cond of ['free', 'cited']) {
    const v = out[m][cond];
    const name = m.replace('oai:', '').split('/').pop();
    if (!v) {
      console.log(`${name.padEnd(16)} ${cond.padEnd(7)} 無資料`);
      continue;
    }
    console.log(
      `${name.padEnd(16)} ${cond.padEnd(7)} ${String(v.claims).padStart(5)}   ${String(v.selfLabelled).padStart(3)} (${pct(v.selfLabelledRate).padStart(4)})      ${String(v.directional).padStart(3)} (${pct(v.directionalRate).padStart(4)})`,
    );
  }
}
console.log('\n有明確變化措辭的例子（這些在資料裡都沒有依據）');
for (const m of MODELS)
  for (const cond of ['free', 'cited'])
    for (const e of out[m][cond]?.examples?.slice(0, 2) || [])
      console.log(`  [${m.replace('oai:', '').split('/').pop()}｜${cond}] ${e}`);
