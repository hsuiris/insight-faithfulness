// 共用：Groq 呼叫、JSON 解析、文字正規化
import { readFileSync } from 'node:fs';

export const MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];

export function groqKey() {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
  // ponytail: 沿用 HeartU-Social 已設定好的金鑰，不另外複製一份到這個 repo
  const envFile = '/Volumes/X10 Pro/Iris_agent/Project/HeartU-Social/.env';
  const line = readFileSync(envFile, 'utf8').split('\n').find((l) => /GROQ_API_KEY=/.test(l));
  if (!line) throw new Error('找不到 GROQ_API_KEY');
  return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
}

// Groq 免費方案每分鐘 8000 token，輸出上限也算進去。每次呼叫後依實際用量等待。
let lastCall = 0;
const TPM = 8000;

export async function chat({ model, system, user, temperature = 0.6, json = true, retries = 8, maxTokens = 2000 }) {
  const key = groqKey();
  for (let attempt = 0; attempt < retries; attempt++) {
    const since = Date.now() - lastCall;
    const minGap = Math.max(32000, Math.round(((user.length / 2 + system.length / 2 + maxTokens) / TPM) * 60000));
    if (since < minGap) await new Promise((r) => setTimeout(r, minGap - since));
    lastCall = Date.now();
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(180000),
      body: JSON.stringify({
        model,
        temperature,
        max_completion_tokens: maxTokens,
        // gpt-oss 是推理模型，預設會先花大量 token 思考，導致 JSON 還沒輸出就用完額度
        ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (res.status === 413) {
      maxTokens = Math.max(700, Math.floor(maxTokens * 0.6));
      console.error(`  413 超過每分鐘額度，輸出上限降到 ${maxTokens}，等 25 秒`);
      await new Promise((r) => setTimeout(r, 25000));
      continue;
    }
    if (res.status === 429) {
      const body429 = await res.clone().text();
      if (/tokens per day|TPD/i.test(body429)) {
        const err = new Error(`每日額度用完：${model}`);
        err.code = 'TPD';
        throw err;
      }
      console.error('  429 內容：' + body429.slice(0, 220));
      const wait = Math.min(120, Math.max(45, Number(res.headers.get('retry-after')) || 0) + 15 * attempt);
      console.error(`  429，等 ${wait} 秒`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      if (attempt === retries - 1) throw new Error(`Groq ${res.status}: ${body.slice(0, 300)}`);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    const data = await res.json();
    const text = data.choices[0].message.content;
    if (!json) return text;
    try {
      return JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      if (attempt === retries - 1) throw new Error('模型沒有回傳合法 JSON');
    }
  }
  throw new Error('重試用盡');
}

// 引文比對前的正規化：去掉空白與全半形標點差異，避免因排版誤判
export function normalize(s) {
  return String(s || '')
    .replace(/[\s　]/g, '')
    .replace(/[，,]/g, '，')
    .replace(/[。.]/g, '。')
    .replace(/[？?]/g, '？')
    .replace(/[！!]/g, '！')
    .replace(/[「」『』"'"']/g, '');
}

export function countMarkers(text, markers) {
  const t = normalize(text);
  return markers.reduce((n, m) => n + (t.split(normalize(m)).length - 1), 0);
}
