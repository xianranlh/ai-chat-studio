/* AI Chat Studio - 后端服务(零依赖,Node >= 18)
 * 静态托管 + /api/chat 流式代理(Anthropic / OpenAI / xAI)
 * 未配置 API Key 时自动进入演示模式(模拟流式回复)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3900;
const PUB = path.join(__dirname, 'public');
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8', '.json':'application/json',
  '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };

const PROVIDERS = {
  anthropic: { url: 'https://api.anthropic.com/v1/messages', type: 'anthropic' },
  openai:    { url: 'https://api.openai.com/v1/chat/completions', type: 'openai' },
  xai:       { url: 'https://api.x.ai/v1/chat/completions', type: 'openai' },
};

/* ---------- 演示模式:模拟流式回复 ---------- */
function demoReply(userText, features, provider) {
  const brand = { anthropic: 'Claude', openai: 'ChatGPT', xai: 'Grok' }[provider] || 'AI';
  const flags = [];
  if (features?.search)   flags.push('🔍 联网搜索');
  if (features?.research) flags.push('📊 深度研究');
  if (features?.think)    flags.push('🧠 扩展思考');
  const flagLine = flags.length ? `\n> 本次启用:${flags.join(' · ')}\n` : '';
  return `你好!我是 **${brand}**(演示模式)。你说:「${userText.slice(0, 60)}」
${flagLine}
当前未配置 API Key,所以这是一条**模拟流式回复**,用于展示界面功能:

### 功能演示
| 功能 | 状态 |
|------|------|
| Markdown 渲染 | ✅ 表格 / 代码 / 引用 |
| 流式打字机输出 | ✅ 正在进行 |
| Artifacts 预览 | ✅ 点击下方代码块右上角「预览」 |

\`\`\`html
<!DOCTYPE html>
<html><head><style>
  body{display:flex;align-items:center;justify-content:center;height:100vh;
       margin:0;font-family:sans-serif;background:linear-gradient(135deg,#667eea,#764ba2)}
  .card{background:#fff;padding:40px 60px;border-radius:16px;text-align:center;
        box-shadow:0 20px 60px rgba(0,0,0,.3)}
  h1{margin:0 0 8px}
</style></head><body>
  <div class="card"><h1>🎉 Artifacts 运行成功</h1>
  <p>这个页面在侧边面板的沙箱 iframe 中实时渲染</p>
  <button onclick="this.textContent='点击了 '+(++window.n||(window.n=1))+' 次'">点我试试</button>
  </div>
</body></html>
\`\`\`

在 **设置 ⚙️** 中填入 API Key 即可接入真实模型。`;
}

/* ---------- 多智能体(Grok Heavy 模式) ---------- */
const AGENTS = [
  { name: 'Agent 1 · 事实调研', sys: '你是多智能体系统中的事实调研智能体:聚焦事实、数据与背景信息,用要点列出与用户问题相关的关键事实。' },
  { name: 'Agent 2 · 深度推理', sys: '你是多智能体系统中的推理智能体:对用户问题进行严密的分步逻辑推导与分析。' },
  { name: 'Agent 3 · 批判审查', sys: '你是多智能体系统中的批判智能体:找出该问题的风险、反例、边界条件与易错点。' },
];

async function streamOnce(conf, apiKey, baseUrl, model, messages, onDelta) {
  let resp;
  if (conf.type === 'anthropic') {
    const { system, msgs } = toAnthropic(messages);
    resp = await fetch(baseUrl || conf.url, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 2048, stream: true, ...(system && { system }), messages: msgs }) });
  } else {
    resp = await fetch(baseUrl || conf.url, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, stream: true, messages: toOpenAI(messages) }) });
  }
  if (!resp.ok) throw new Error(`${resp.status} ${(await resp.text()).slice(0, 200)}`);
  const reader = resp.body.getReader(); const dec = new TextDecoder();
  let buf = '', full = '';
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const p = line.slice(6).trim(); if (p === '[DONE]') continue;
      try {
        const j = JSON.parse(p);
        const d = conf.type === 'anthropic'
          ? (j.type === 'content_block_delta' ? j.delta?.text : '')
          : j.choices?.[0]?.delta?.content;
        if (d) { full += d; onDelta(d); }
      } catch {}
    }
  }
  return full;
}

async function multiAgent(res, { conf, apiKey, baseUrl, model, messages, lastUser }) {
  res.write(`data: ${JSON.stringify({ agents: AGENTS.map(a => a.name) })}\n\n`);

  /* 演示模式:交错模拟三个 agent 并行输出 */
  if (!apiKey || !conf) {
    const q = (lastUser?.content || '').slice(0, 30);
    const drafts = [
      `📚 已检索相关事实:\n· 关键背景与定义\n· 相关数据与统计\n· 历史先例参考\n\n针对「${q}」的事实基础已就绪,交由主控汇总。`,
      `🧮 分步推理:\n1. 拆解问题核心\n2. 建立因果链条\n3. 推导中间结论\n4. 交叉验证一致性 ✓\n\n推理链完整,置信度较高。`,
      `⚖️ 审查意见:\n· 潜在反例:边界条件需注意\n· 隐含假设:已标注 2 处\n· 建议:最终结论应附适用范围\n\n未发现致命缺陷,准予通过。`,
    ];
    const queues = drafts.map(t => t.match(/[\s\S]{1,4}/g) || []);
    let active = true;
    while (active) {
      active = false;
      for (let i = 0; i < queues.length; i++) {
        if (queues[i].length) { active = true;
          res.write(`data: ${JSON.stringify({ agent: i, delta: queues[i].shift() })}\n\n`); }
      }
      await new Promise(r => setTimeout(r, 20));
    }
    AGENTS.forEach((_, i) => res.write(`data: ${JSON.stringify({ agent: i, done: true })}\n\n`));
    return streamDemo(res, `### 🧠 主控综合结论(演示模式)

三个子智能体已完成对「${q}」的**并行分析**:

| 智能体 | 贡献 |
|--------|------|
| 事实调研 | 提供事实与数据基础 |
| 深度推理 | 给出完整逻辑链条 |
| 批判审查 | 标注风险与适用边界 |

> 在设置中配置 **xAI API Key** 后,此模式将真实并行调用 3 个 Grok 实例,并由主控模型汇总输出 —— 即 Grok 4 Heavy 的多智能体工作方式。`);
  }

  /* 真实模式:并行调用子智能体 + 主控流式汇总 */
  const workModel = model.replace(/-?heavy/i, '') || 'grok-4';
  const outputs = await Promise.all(AGENTS.map((a, i) =>
    streamOnce(conf, apiKey, baseUrl, workModel, [{ role: 'system', content: a.sys }, ...messages],
      d => res.write(`data: ${JSON.stringify({ agent: i, delta: d })}\n\n`))
      .then(t => { res.write(`data: ${JSON.stringify({ agent: i, done: true })}\n\n`); return t; })
      .catch(e => { res.write(`data: ${JSON.stringify({ agent: i, done: true })}\n\n`); return `(该智能体失败: ${e.message})`; })
  ));
  const synth = [
    { role: 'system', content: '你是多智能体系统的主控。请综合各子智能体的草稿,输出一份结构清晰、观点最优的最终回答,直接回答用户,不要提及草稿或汇总过程。' },
    ...messages.slice(0, -1),
    { role: 'user', content: `${lastUser?.content || ''}\n\n=== 各子智能体草稿 ===\n` +
      outputs.map((t, i) => `【${AGENTS[i].name}】\n${t}`).join('\n\n') },
  ];
  try {
    await streamOnce(conf, apiKey, baseUrl, workModel, synth,
      d => res.write(`data: ${JSON.stringify({ delta: d })}\n\n`));
  } catch (e) { res.write(`data: ${JSON.stringify({ delta: '⚠️ 主控汇总失败: ' + e.message })}\n\n`); }
  res.write('data: [DONE]\n\n'); res.end();
}

async function streamDemo(res, text) {
  const chunks = text.match(/[\s\S]{1,6}/g) || [];
  for (const c of chunks) {
    res.write(`data: ${JSON.stringify({ delta: c })}\n\n`);
    await new Promise(r => setTimeout(r, 12));
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

/* ---------- 消息格式转换 ---------- */
function toOpenAI(messages) {
  return messages.map(m => {
    if (m.images?.length) {
      return { role: m.role, content: [
        ...m.images.map(u => ({ type: 'image_url', image_url: { url: u } })),
        { type: 'text', text: m.content || '' },
      ]};
    }
    return { role: m.role, content: m.content };
  });
}
function toAnthropic(messages) {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
  const msgs = messages.filter(m => m.role !== 'system').map(m => {
    if (m.images?.length) {
      return { role: m.role, content: [
        ...m.images.map(u => {
          const [, media, data] = u.match(/^data:(.+?);base64,(.+)$/) || [];
          return { type: 'image', source: { type: 'base64', media_type: media, data } };
        }).filter(x => x.source?.data),
        { type: 'text', text: m.content || ' ' },
      ]};
    }
    return { role: m.role, content: m.content };
  });
  return { system, msgs };
}

/* ---------- 聊天接口 ---------- */
async function handleChat(req, res) {
  let body = '';
  req.on('data', d => { body += d; if (body.length > 30e6) req.destroy(); });
  req.on('end', async () => {
    try {
      const { provider = 'anthropic', model, messages = [], features = {}, apiKey, baseUrl } = JSON.parse(body);
      const conf = PROVIDERS[provider];
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });

      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      /* Heavy 模型 → 多智能体编排 */
      if (/heavy/i.test(model || '')) {
        return multiAgent(res, { conf, apiKey, baseUrl, model, messages, lastUser });
      }
      if (!apiKey || !conf) {
        /* 演示模式:DeepSearch / 研究 → 先流式输出过程步骤 */
        if (features.search || features.research) {
          const steps = [
            '正在解析问题,生成搜索计划…',
            '正在搜索 X 上的实时帖子与讨论…',
            '正在抓取 6 个网页来源…',
            '正在阅读并交叉验证关键信息…',
            '已综合 14 条来源,开始生成回答',
          ];
          for (const s of steps) {
            res.write(`data: ${JSON.stringify({ step: s })}\n\n`);
            await new Promise(r => setTimeout(r, 480));
          }
          res.write(`data: ${JSON.stringify({ stepsDone: true, elapsed: '用时 2.4 秒 · 14 个来源' })}\n\n`);
        }
        return streamDemo(res, demoReply(lastUser?.content || '', features, provider));
      }

      // 功能开关 → 注入系统提示
      const sysExtra = [];
      if (features.search)   sysExtra.push('用户开启了联网搜索意图,若无实时能力请说明并尽力回答。');
      if (features.research) sysExtra.push('用户要求深度研究:请结构化、多角度、带小结地详细回答。');
      if (features.think)    sysExtra.push('请先仔细推理再回答。');
      const allMsgs = sysExtra.length ? [{ role: 'system', content: sysExtra.join(' ') }, ...messages] : messages;

      let upstream, headers;
      if (conf.type === 'anthropic') {
        const { system, msgs } = toAnthropic(allMsgs);
        headers = { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
        upstream = await fetch(baseUrl || conf.url, { method: 'POST', headers,
          body: JSON.stringify({ model, max_tokens: 4096, stream: true, ...(system && { system }), messages: msgs }) });
      } else {
        headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
        upstream = await fetch(baseUrl || conf.url, { method: 'POST', headers,
          body: JSON.stringify({ model, stream: true, messages: toOpenAI(allMsgs) }) });
      }

      if (!upstream.ok) {
        const err = await upstream.text();
        res.write(`data: ${JSON.stringify({ delta: `⚠️ 上游 API 错误 (${upstream.status}):\n\`\`\`\n${err.slice(0, 800)}\n\`\`\`` })}\n\n`);
        res.write('data: [DONE]\n\n'); return res.end();
      }

      const reader = upstream.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;
          try {
            const j = JSON.parse(payload);
            const delta = conf.type === 'anthropic'
              ? (j.type === 'content_block_delta' ? j.delta?.text : '')
              : j.choices?.[0]?.delta?.content;
            if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          } catch {}
        }
      }
      res.write('data: [DONE]\n\n'); res.end();
    } catch (e) {
      try {
        res.write(`data: ${JSON.stringify({ delta: '⚠️ 服务器错误: ' + e.message })}\n\n`);
        res.write('data: [DONE]\n\n'); res.end();
      } catch {}
    }
  });
}

/* ---------- Imagine 图像生成 ---------- */
const IMG_URL = {
  xai:    'https://api.x.ai/v1/images/generations',
  openai: 'https://api.openai.com/v1/images/generations',
};
/* 演示模式:生成本地 SVG 渐变占位图(不调用外部服务) */
function demoImage(prompt, ratio, i) {
  const [w, h] = ratio === '16:9' ? [640, 360] : ratio === '9:16' ? [360, 640] : [480, 480];
  const hues = [[258, 200], [210, 330], [160, 40], [20, 300]][i % 4];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${hues[0]},70%,55%)"/>
    <stop offset="1" stop-color="hsl(${hues[1]},70%,40%)"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <circle cx="${w*0.3}" cy="${h*0.35}" r="${Math.min(w,h)*0.18}" fill="rgba(255,255,255,.25)"/>
  <circle cx="${w*0.72}" cy="${h*0.62}" r="${Math.min(w,h)*0.28}" fill="rgba(0,0,0,.15)"/>
  <text x="50%" y="52%" text-anchor="middle" fill="rgba(255,255,255,.92)" font-family="sans-serif"
    font-size="${Math.round(Math.min(w,h)/16)}" font-weight="700">✦ 演示图 ${i + 1}</text>
  <text x="50%" y="60%" text-anchor="middle" fill="rgba(255,255,255,.7)" font-family="sans-serif"
    font-size="${Math.round(Math.min(w,h)/30)}">${prompt.slice(0, 24).replace(/[<>&"]/g, '')}</text>
</svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}
async function handleImage(req, res) {
  let body = '';
  req.on('data', d => { body += d; if (body.length > 1e6) req.destroy(); });
  req.on('end', async () => {
    try {
      const { provider = 'xai', prompt = '', ratio = '1:1', style = 'realistic', apiKey, baseUrl } = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (!apiKey) {   // 演示模式
        await new Promise(r => setTimeout(r, 1200));
        return res.end(JSON.stringify({ demo: true,
          images: [0, 1, 2, 3].map(i => demoImage(prompt, ratio, i)) }));
      }
      const styleHint = { realistic:'photorealistic, high detail', anime:'anime style, vibrant',
        art:'artistic, painterly', '3d':'3D render, octane' }[style] || '';
      const fullPrompt = styleHint ? `${prompt}, ${styleHint}` : prompt;
      const url = baseUrl || IMG_URL[provider] || IMG_URL.xai;
      const payload = provider === 'openai'
        ? { model:'gpt-image-1', prompt: fullPrompt, n: 4,
            size: ratio === '16:9' ? '1536x1024' : ratio === '9:16' ? '1024x1536' : '1024x1024' }
        : { model:'grok-2-image', prompt: fullPrompt, n: 4, response_format:'b64_json' };
      const up = await fetch(url, { method:'POST',
        headers: { 'Content-Type':'application/json', Authorization:`Bearer ${apiKey}` },
        body: JSON.stringify(payload) });
      if (!up.ok) return res.end(JSON.stringify({ error:`上游 ${up.status}: ${(await up.text()).slice(0, 400)}` }));
      const j = await up.json();
      const images = (j.data || []).map(d => d.b64_json ? 'data:image/png;base64,' + d.b64_json : d.url).filter(Boolean);
      res.end(JSON.stringify({ images }));
    } catch (e) {
      try { res.end(JSON.stringify({ error: e.message })); } catch {}
    }
  });
}

/* ---------- 静态服务 ---------- */
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/chat') return handleChat(req, res);
  if (req.method === 'POST' && req.url === '/api/image') return handleImage(req, res);
  let p = path.normalize(path.join(PUB, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache, must-revalidate' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`✦ AI Chat Studio → http://localhost:${PORT}`));
