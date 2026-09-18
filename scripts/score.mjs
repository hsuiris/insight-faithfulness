// 評分：引文逐字比對（全自動）＋趨勢主張與真相表比對
// 用法：node scripts/score.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { normalize } from './lib.mjs';

const { journals, counts } = JSON.parse(readFileSync(new URL('../data/journals.json', import.meta.url), 'utf8'));
const reports = JSON.parse(readFileSync(new URL('../data/reports.json', import.meta.url), 'utf8'));

const corpus = {};
for (const j of journals) corpus[j.persona] = (corpus[j.persona] || '') + normalize(j.text);

// 依實際計數把主題分類：真趨勢（上升或下降）、持平、雜訊（不計分）
function classify(series) {
  const range = Math.max(...series) - Math.min(...series);
  const [a, b, c] = series;
  if (a < b && b <= c && range >= 3) return 'up';
  if (a > b && b >= c && range >= 3) return 'down';
  if (range <= 1) return 'flat';
  return 'noise';
}
const topicClass = {};
for (const [p, byTopic] of Object.entries(counts)) {
  topicClass[p] = Object.fromEntries(Object.entries(byTopic).map(([t, s]) => [t, classify(s)]));
}

// 主題比對，順序重要：先看情緒與自責，再看睡眠，最後才是工作與關係
const TOPIC_RULES = [
  ['self_blame', /自責|責備|自我批評|愧疚|都是我的錯|我不夠好|我搞砸|怪自己|檢討自己/],
  ['sleep', /睡|失眠|作息|入睡|淺眠|醒來/],
  // 衝突要同時出現對象與衝突行為，避免把「對伴侶的支持變多」這種主張也算進來
  ['conflict', /(伴侶|另一半|女友|男友).{0,12}(吵|冷戰|爭執|衝突|不講話)|(吵|冷戰|爭執|衝突|不講話).{0,12}(伴侶|另一半|女友|男友)/],
  ['workload', /工作量|案子|加班|事情做不完|工作負荷/],
];
// 這些對象不在真相表裡，出現就不判定
const UNTRACKED = /教授|老師|主管|同事|家人|父親|母親|室友/;
function topicOf(text) {
  const n = normalize(text);
  if (UNTRACKED.test(n)) return null;
  for (const [topic, re] of TOPIC_RULES) if (re.test(n)) return topic;
  return null;
}

// 主張的方向。先判有沒有明說沒變化，再看極性詞，最後才看「逐漸」這類中性的變化詞
const NO_CHANGE = /未見|未改善|沒有改善|沒有變好|沒有變化|無變化|持平|差不多|依然|仍然|一直都|持續不佳|持續未|維持/;
const RISE = /增加|變多|上升|加劇|惡化|升高|更頻繁|更嚴重|變得更/;
const FALL = /減少|變少|下降|降低|緩和|改善|好轉|趨緩|變得更好/;
const CHANGE_NEUTRAL = /越來越|逐漸|漸漸|日益|一週比一週|隨時間|趨勢/;
function directionOf(text, declaredTrend) {
  const n = normalize(text);
  if (NO_CHANGE.test(n)) return 'flat';
  const rise = RISE.test(n);
  const fall = FALL.test(n);
  if (rise && !fall) return 'up';
  if (fall && !rise) return 'down';
  if (rise && fall) return 'unspecified'; // 同時出現，語意要人看才知道
  if (CHANGE_NEUTRAL.test(n) || declaredTrend) return 'unspecified';
  return null;
}

const rows = [];
for (const r of reports) {
  const s = {
    persona: r.persona,
    model: r.model,
    condition: r.condition,
    run: r.run,
    claims: r.claims.length,
    quotesTotal: 0,
    quotesOk: 0,
    claimsNoValidQuote: 0,
    changeClaims: 0, // 有方向的主張（up / down / flat）
    correct: 0, // 方向與實際計數相符
    wrong: 0, // 對持平主題宣稱變化，或方向與資料相反
    unclassified: 0, // 主題不在真相表內，無法判定
    wrongExamples: [],
    correctExamples: [],
  };

  for (const c of r.claims) {
    const valid = c.quotes.filter((q) => {
      const n = normalize(q);
      return n.length >= 6 && corpus[r.persona].includes(n);
    });
    s.quotesTotal += c.quotes.length;
    s.quotesOk += valid.length;
    if (valid.length === 0) s.claimsNoValidQuote++;

    const dir = directionOf(c.text, c.type === 'trend');
    if (!dir) continue;
    const topic = topicOf(c.text);
    const cls = topic ? topicClass[r.persona][topic] : null;
    if (!cls || cls === 'noise' || dir === 'unspecified') {
      s.unclassified++;
      continue;
    }
    s.changeClaims++;
    const ok = (cls === 'flat' && dir === 'flat') || (cls === 'up' && dir === 'up') || (cls === 'down' && dir === 'down');
    if (ok) {
      s.correct++;
      if (s.correctExamples.length < 2) s.correctExamples.push(`[${topic}|${cls}] ${c.text}`);
    } else {
      s.wrong++;
      if (s.wrongExamples.length < 3) s.wrongExamples.push(`[${topic}|實際${cls}|宣稱${dir}] ${c.text}`);
    }
  }
  rows.push(s);
}

function agg(filter) {
  const s = rows.filter(filter);
  const sum = (k) => s.reduce((n, r) => n + (r[k] || 0), 0);
  return {
    reports: s.length,
    claims: sum('claims'),
    quotesTotal: sum('quotesTotal'),
    quoteRate: sum('quotesTotal') ? sum('quotesOk') / sum('quotesTotal') : null,
    noQuoteRate: sum('claims') ? sum('claimsNoValidQuote') / sum('claims') : null,
    changeClaims: sum('changeClaims'),
    correct: sum('correct'),
    wrong: sum('wrong'),
    wrongRate: sum('changeClaims') ? sum('wrong') / sum('changeClaims') : null,
    unclassified: sum('unclassified'),
  };
}

const summary = { topicClass, overall: {}, byModel: {}, byPersona: {} };
for (const cond of ['free', 'cited']) summary.overall[cond] = agg((r) => r.condition === cond);
for (const m of [...new Set(rows.map((r) => r.model))]) {
  summary.byModel[m] = Object.fromEntries(
    ['free', 'cited'].map((c) => [c, agg((r) => r.model === m && r.condition === c)]),
  );
}
for (const p of ['A', 'B', 'C']) {
  summary.byPersona[p] = Object.fromEntries(
    ['free', 'cited'].map((c) => [c, agg((r) => r.persona === p && r.condition === c)]),
  );
}

writeFileSync(new URL('../data/scores.json', import.meta.url), JSON.stringify({ rows, summary }, null, 2));

const pct = (x) => (x === null ? '  無  ' : `${(x * 100).toFixed(1)}%`);
console.log('各主題依實際計數的分類');
console.log(JSON.stringify(topicClass, null, 1));
console.log('\n總表（wrong = 對持平主題宣稱變化，或方向與資料相反）');
console.log('條件    報告 主張  引文可驗證  無有效引文  可判定的變化主張  正確  錯誤  錯誤率  無法判定');
for (const [k, v] of Object.entries(summary.overall)) {
  console.log(
    `${k.padEnd(6)} ${String(v.reports).padStart(4)} ${String(v.claims).padStart(4)}   ${pct(v.quoteRate).padStart(7)}    ${pct(v.noQuoteRate).padStart(7)}        ${String(v.changeClaims).padStart(5)}      ${String(v.correct).padStart(3)}  ${String(v.wrong).padStart(4)}  ${pct(v.wrongRate)}   ${String(v.unclassified).padStart(4)}`,
  );
}
console.log('\n分模型');
for (const [m, v] of Object.entries(summary.byModel)) {
  console.log(`${m}`);
  for (const k of ['free', 'cited']) {
    console.log(
      `  ${k.padEnd(6)} 引文可驗證 ${pct(v[k].quoteRate)}  無有效引文 ${pct(v[k].noQuoteRate)}  變化主張錯誤率 ${pct(v[k].wrongRate)}（${v[k].wrong}/${v[k].changeClaims}）`,
    );
  }
}
console.log('\n分人物');
for (const [p, v] of Object.entries(summary.byPersona)) {
  console.log(`  ${p}  free ${v.free.correct}對/${v.free.wrong}錯　cited ${v.cited.correct}對/${v.cited.wrong}錯`);
}
console.log('\n判錯的例子');
for (const r of rows) for (const e of r.wrongExamples.slice(0, 1)) console.log(`  ${r.persona} ${r.model.split('/')[1]} ${r.condition}: ${e}`);
