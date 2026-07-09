/* Grok — local proxy (Node >= 18, zero deps)
 * Static files + /api/chat (xAI stream) + /api/image
 * Empty API key → demo mode
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3900;
const PUB = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const XAI_CHAT = 'https://api.x.ai/v1/chat/completions';
const XAI_IMG = 'https://api.x.ai/v1/images/generations';

function demoReply(userText, features) {
  const flags = [];
  if (features?.search) flags.push('DeepSearch');
  if (features?.think) flags.push('Think');
  if (features?.imagine) flags.push('Imagine');
  const flagLine = flags.length ? `\n> Enabled: ${flags.join(' · ')}\n` : '';
  return `I'm **Grok** (demo mode). You said: "${(userText || '').slice(0, 80)}"
${flagLine}
No API key is configured, so this is a **simulated streaming reply**.

### What's working
| Feature | Status |
|---------|--------|
| Streaming | ✅ |
| Markdown | ✅ tables / code / lists |
| DeepSearch panel | ✅ via features.search |
| Think / Thoughts | ✅ via features.think |
| Heavy multi-agent | ✅ model \`grok-4-heavy\` |
| Imagine | ✅ /api/image |

Add your **xAI API key** in Settings → Account to call real Grok models.

\`\`\`js
// Example: call Grok via the local proxy
fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'grok-4',
    apiKey: 'xai-…',
    messages: [{ role: 'user', content: 'Hello' }],
  }),
});
\`\`\``;
}

const DEFAULT_AGENTS = [
  { name: 'Research', sys: 'You are a research agent. List key facts and sources relevant to the user question as bullet points.' },
  { name: 'Reasoning', sys: 'You are a reasoning agent. Work through the problem step by step with clear logic.' },
  { name: 'Critique', sys: 'You are a critique agent. Find risks, edge cases, counterexamples, and weak assumptions.' },
  { name: 'Synthesis', sys: 'You are a synthesis agent. Propose a clear draft answer for the user.' },
];

function normalizeAgents(agents) {
  if (!Array.isArray(agents) || !agents.length) return DEFAULT_AGENTS.map(a => ({ ...a }));
  return agents.slice(0, 16).map((a, i) => ({
    name: String(a.name || `Agent ${i + 1}`).slice(0, 48),
    sys: String(a.sys || DEFAULT_AGENTS[i % DEFAULT_AGENTS.length].sys).slice(0, 4000),
  }));
}

function toOpenAI(messages) {
  return messages.map(m => {
    if (m.images?.length) {
      return {
        role: m.role,
        content: [
          ...m.images.map(u => ({ type: 'image_url', image_url: { url: u } })),
          { type: 'text', text: m.content || '' },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
}

async function streamOnce(apiKey, baseUrl, model, messages, onDelta) {
  const url = baseUrl || XAI_CHAT;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, stream: true, messages: toOpenAI(messages) }),
  });
  if (!resp.ok) throw new Error(`${resp.status} ${(await resp.text()).slice(0, 200)}`);
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const p = line.slice(6).trim();
      if (p === '[DONE]') continue;
      try {
        const j = JSON.parse(p);
        const d = j.choices?.[0]?.delta?.content;
        if (d) { full += d; onDelta(d); }
      } catch {}
    }
  }
  return full;
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

async function multiAgent(res, { apiKey, baseUrl, model, messages, lastUser, agents: agentsIn }) {
  const AGENTS = normalizeAgents(agentsIn);
  res.write(`data: ${JSON.stringify({ agents: AGENTS.map(a => a.name) })}\n\n`);

  if (!apiKey) {
    const q = (lastUser?.content || '').slice(0, 40);
    const drafts = AGENTS.map((a, i) =>
      `[${a.name}] Draft for "${q}":\n· Working with role instructions\n· Parallel pass ${i + 1}/${AGENTS.length}\n· Ready for synthesis`);
    const queues = drafts.map(t => t.match(/[\s\S]{1,4}/g) || []);
    let active = true;
    while (active) {
      active = false;
      for (let i = 0; i < queues.length; i++) {
        if (queues[i].length) {
          active = true;
          res.write(`data: ${JSON.stringify({ agent: i, delta: queues[i].shift() })}\n\n`);
        }
      }
      await new Promise(r => setTimeout(r, 14));
    }
    AGENTS.forEach((_, i) => res.write(`data: ${JSON.stringify({ agent: i, done: true })}\n\n`));
    const table = AGENTS.map(a => `| ${a.name} | ${(a.sys || '').slice(0, 48)}… |`).join('\n');
    return streamDemo(res, `### Synthesis (demo)

**${AGENTS.length} agents** finished in parallel on **"${q}"**:

| Agent | Instructions |
|-------|----------------|
${table}

Configure an **xAI API key** to run real multi-agent Heavy mode with your Customize agents.`);
  }

  const workModel = model.replace(/-?heavy/i, '') || 'grok-4';
  const outputs = await Promise.all(AGENTS.map((a, i) =>
    streamOnce(apiKey, baseUrl, workModel,
      [{ role: 'system', content: a.sys }, ...messages],
      d => res.write(`data: ${JSON.stringify({ agent: i, delta: d })}\n\n`))
      .then(t => {
        res.write(`data: ${JSON.stringify({ agent: i, done: true })}\n\n`);
        return t;
      })
      .catch(e => {
        res.write(`data: ${JSON.stringify({ agent: i, done: true })}\n\n`);
        return `(agent failed: ${e.message})`;
      })
  ));

  const synth = [
    {
      role: 'system',
      content: 'You are the lead agent. Synthesize the drafts into one clear final answer for the user. Do not mention drafts or agents.',
    },
    ...messages.slice(0, -1),
    {
      role: 'user',
      content: `${lastUser?.content || ''}\n\n=== Agent drafts ===\n` +
        outputs.map((t, i) => `【${AGENTS[i].name}】\n${t}`).join('\n\n'),
    },
  ];
  try {
    await streamOnce(apiKey, baseUrl, workModel, synth,
      d => res.write(`data: ${JSON.stringify({ delta: d })}\n\n`));
  } catch (e) {
    res.write(`data: ${JSON.stringify({ delta: 'Lead agent failed: ' + e.message })}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

async function handleChat(req, res) {
  let body = '';
  req.on('data', d => { body += d; if (body.length > 30e6) req.destroy(); });
  req.on('end', async () => {
    try {
      const {
        model = 'grok-4',
        messages = [],
        features = {},
        apiKey = '',
        baseUrl = '',
        agents = null,
      } = JSON.parse(body);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const lastUser = [...messages].reverse().find(m => m.role === 'user');

      if (/heavy/i.test(model || '')) {
        return multiAgent(res, { apiKey, baseUrl, model, messages, lastUser, agents });
      }

      if (!apiKey) {
        if (features.think) {
          const thoughts = [
            'Clarify the ask and constraints.\n',
            'List candidate approaches; discard weak ones.\n',
            'Check consistency and edge cases.\n',
            'Lock the answer structure.\n',
          ];
          for (const t of thoughts) {
            res.write(`data: ${JSON.stringify({ think: t })}\n\n`);
            await new Promise(r => setTimeout(r, 260));
          }
        }
        if (features.search) {
          const steps = [
            'Planning search queries…',
            'Searching the web and X…',
            'Reading top sources…',
            'Cross-checking facts…',
            'Synthesizing answer…',
          ];
          for (const s of steps) {
            res.write(`data: ${JSON.stringify({ step: s })}\n\n`);
            await new Promise(r => setTimeout(r, 420));
          }
          res.write(`data: ${JSON.stringify({ stepsDone: true, elapsed: '2.1s · 12 sources' })}\n\n`);
        }
        return streamDemo(res, demoReply(lastUser?.content || '', features));
      }

      const sysExtra = [];
      if (features.search) sysExtra.push('Use live knowledge when relevant; cite sources when possible.');
      if (features.think) sysExtra.push('Think carefully before answering. Prefer rigorous reasoning.');
      const allMsgs = sysExtra.length
        ? [{ role: 'system', content: sysExtra.join(' ') }, ...messages]
        : messages;

      const url = baseUrl || XAI_CHAT;
      const upstream = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, stream: true, messages: toOpenAI(allMsgs) }),
      });

      if (!upstream.ok) {
        const err = await upstream.text();
        res.write(`data: ${JSON.stringify({
          delta: `API error (${upstream.status}):\n\`\`\`\n${err.slice(0, 800)}\n\`\`\``,
        })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
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
            const delta = j.choices?.[0]?.delta?.content;
            if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          } catch {}
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (e) {
      try {
        res.write(`data: ${JSON.stringify({ delta: 'Server error: ' + e.message })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } catch {}
    }
  });
}

function demoImage(prompt, ratio, i) {
  const [w, h] = ratio === '16:9' ? [640, 360] : ratio === '9:16' ? [360, 640] : [480, 480];
  const hues = [[258, 200], [210, 330], [160, 40], [20, 300]][i % 4];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${hues[0]},70%,55%)"/>
    <stop offset="1" stop-color="hsl(${hues[1]},70%,40%)"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <text x="50%" y="50%" text-anchor="middle" fill="rgba(255,255,255,.92)"
    font-family="sans-serif" font-size="${Math.round(Math.min(w, h) / 16)}" font-weight="700">Imagine ${i + 1}</text>
  <text x="50%" y="58%" text-anchor="middle" fill="rgba(255,255,255,.7)"
    font-family="sans-serif" font-size="${Math.round(Math.min(w, h) / 28)}">${String(prompt).slice(0, 28).replace(/[<>&"]/g, '')}</text>
</svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

async function handleImage(req, res) {
  let body = '';
  req.on('data', d => { body += d; if (body.length > 1e6) req.destroy(); });
  req.on('end', async () => {
    try {
      const { prompt = '', ratio = '1:1', apiKey = '', baseUrl = '' } = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (!apiKey) {
        await new Promise(r => setTimeout(r, 900));
        return res.end(JSON.stringify({
          demo: true,
          images: [0, 1, 2, 3].map(i => demoImage(prompt, ratio, i)),
        }));
      }
      const url = baseUrl || XAI_IMG;
      const up = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'grok-2-image',
          prompt,
          n: 4,
          response_format: 'b64_json',
        }),
      });
      if (!up.ok) {
        return res.end(JSON.stringify({
          error: `Upstream ${up.status}: ${(await up.text()).slice(0, 400)}`,
        }));
      }
      const j = await up.json();
      const images = (j.data || [])
        .map(d => (d.b64_json ? 'data:image/png;base64,' + d.b64_json : d.url))
        .filter(Boolean);
      res.end(JSON.stringify({ images }));
    } catch (e) {
      try { res.end(JSON.stringify({ error: e.message })); } catch {}
    }
  });
}

/* ---------- Share: store & serve read-only snapshots ---------- */
const SHARES = path.join(__dirname, 'shares');
function handleShare(req, res) {
  let body = '';
  req.on('data', d => { body += d; if (body.length > 2e6) req.destroy(); });
  req.on('end', () => {
    try {
      const { title = 'Shared chat', messages = [] } = JSON.parse(body);
      if (!Array.isArray(messages) || !messages.length) throw new Error('empty');
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      fs.mkdirSync(SHARES, { recursive: true });
      fs.writeFileSync(path.join(SHARES, id + '.json'), JSON.stringify({
        title: String(title).slice(0, 120),
        date: new Date().toISOString(),
        messages: messages.slice(0, 200).map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: String(m.content || '').slice(0, 50000),
        })),
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}
function serveShare(req, res, id) {
  if (!/^[a-z0-9]{6,24}$/.test(id)) { res.writeHead(404); return res.end('Not Found'); }
  fs.readFile(path.join(SHARES, id + '.json'), 'utf8', (err, raw) => {
    if (err) { res.writeHead(404); return res.end('Share not found or expired'); }
    let j; try { j = JSON.parse(raw); } catch { res.writeHead(500); return res.end(); }
    const escH = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const msgs = j.messages.map(m => `
      <div class="m ${m.role}"><div class="who">${m.role === 'user' ? 'You' : 'Grok'}</div>
      <div class="body">${escH(m.content)}</div></div>`).join('');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escH(j.title)} — Shared</title><style>
  body{margin:0;background:#000;color:#e7e9ea;font:15px/1.7 ui-sans-serif,system-ui,'PingFang SC',sans-serif}
  .wrap{max-width:760px;margin:0 auto;padding:32px 20px 60px}
  h1{font-size:21px;margin:0 0 4px}
  .date{color:#71767b;font-size:12.5px;margin-bottom:28px}
  .m{margin:18px 0}
  .who{font-size:12px;color:#71767b;font-weight:600;margin-bottom:4px}
  .m.user .body{background:#202327;border:1px solid #2f3336;border-radius:16px;padding:10px 15px;display:inline-block;max-width:85%}
  .m .body{white-space:pre-wrap;word-break:break-word}
  .foot{margin-top:44px;padding-top:16px;border-top:1px solid #2f3336;color:#71767b;font-size:12.5px}
  .foot a{color:#1d9bf0;text-decoration:none}
</style></head><body><div class="wrap">
<h1>${escH(j.title)}</h1><div class="date">Shared · ${escH(j.date.slice(0, 10))} · read-only</div>
${msgs}
<div class="foot">Shared from <a href="/">Grok</a></div>
</div></body></html>`);
  });
}

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/chat') return handleChat(req, res);
  if (req.method === 'POST' && req.url === '/api/image') return handleImage(req, res);
  if (req.method === 'POST' && req.url === '/api/share') return handleShare(req, res);
  const shareMatch = req.url.match(/^\/s\/([a-z0-9]+)$/);
  if (req.method === 'GET' && shareMatch) return serveShare(req, res, shareMatch[1]);
  let p = path.normalize(path.join(
    PUB,
    req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]),
  ));
  if (!p.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(p)] || 'application/octet-stream',
      'Cache-Control': 'no-cache, must-revalidate',
    });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Grok → http://localhost:${PORT}`));
