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

/* ═══════════ REAL web search (DuckDuckGo HTML, no key needed) ═══════════ */
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const stripTags = s => String(s)
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#x?\w+;/g, ' ')
  .replace(/\s+/g, ' ').trim();

async function webSearch(query, max = 6) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query),
      { headers: { 'User-Agent': UA }, signal: ctl.signal });
    const html = await r.text();
    const out = [];
    const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && out.length < max) {
      let url = m[1];
      const uddg = url.match(/uddg=([^&]+)/);
      if (uddg) url = decodeURIComponent(uddg[1]);
      if (!/^https?:/.test(url)) continue;
      out.push({ title: stripTags(m[2]).slice(0, 120), url, snippet: stripTags(m[3]).slice(0, 240) });
    }
    return out;
  } finally { clearTimeout(t); }
}

async function fetchPage(url, maxLen = 4000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal, redirect: 'follow' });
    const type = r.headers.get('content-type') || '';
    if (!type.includes('html') && !type.includes('text')) return `(non-text content: ${type})`;
    return stripTags(await r.text()).slice(0, maxLen);
  } finally { clearTimeout(t); }
}

/* Runs real search, streams REAL progress steps, returns context + sources */
async function runSearch(res, query, deep) {
  const t0 = Date.now();
  const step = s => res.write(`data: ${JSON.stringify({ step: s })}\n\n`);
  step(`Searching the web: "${query.slice(0, 80)}"`);
  let results = [];
  try { results = await webSearch(query, deep ? 8 : 6); }
  catch (e) { step('Search failed: ' + e.message); }
  if (results.length) {
    step(`Found ${results.length} results: ` + [...new Set(results.map(r => {
      try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch { return ''; }
    }))].filter(Boolean).slice(0, 5).join(', '));
  }
  const pages = [];
  if (deep && results.length) {
    for (const r of results.slice(0, 2)) {
      let host = ''; try { host = new URL(r.url).hostname; } catch {}
      step(`Reading ${host}…`);
      try { pages.push({ url: r.url, text: await fetchPage(r.url, 3000) }); }
      catch { step(`Could not read ${host}`); }
    }
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1) + 's · ' + results.length + ' sources';
  res.write(`data: ${JSON.stringify({ stepsDone: true, elapsed })}\n\n`);
  return { results, pages, elapsed };
}

/* ═══════════ REAL connector tools (public APIs) ═══════════ */
const TOOL_DEFS = {
  web: [{
    type: 'function', function: {
      name: 'web_search', description: 'Search the live web (DuckDuckGo). Returns titles, URLs, snippets.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  }, {
    type: 'function', function: {
      name: 'fetch_webpage', description: 'Fetch a URL and return its readable text content.',
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    },
  }],
  github: [{
    type: 'function', function: {
      name: 'github_search', description: 'Search GitHub for repositories, issues, or code.',
      parameters: { type: 'object', properties: {
        type: { type: 'string', enum: ['repositories', 'issues', 'code'] },
        query: { type: 'string', description: 'GitHub search syntax supported' },
      }, required: ['type', 'query'] },
    },
  }, {
    type: 'function', function: {
      name: 'github_get_file', description: 'Read a file from a GitHub repository.',
      parameters: { type: 'object', properties: {
        repo: { type: 'string', description: 'owner/name' },
        path: { type: 'string' }, ref: { type: 'string' },
      }, required: ['repo', 'path'] },
    },
  }],
  weather: [{
    type: 'function', function: {
      name: 'get_weather', description: 'Current weather and 3-day forecast for a city (Open-Meteo).',
      parameters: { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] },
    },
  }],
  hn: [{
    type: 'function', function: {
      name: 'hn_search', description: 'Search Hacker News stories (Algolia API).',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  }],
};

async function execTool(name, args, ctx) {
  const jfetch = async (url, headers = {}) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ctl.signal });
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
      return r.json();
    } finally { clearTimeout(t); }
  };
  switch (name) {
    case 'web_search':
      return JSON.stringify(await webSearch(String(args.query || ''), 6));
    case 'fetch_webpage':
      if (!/^https?:\/\//.test(args.url || '')) throw new Error('invalid url');
      return await fetchPage(args.url, 5000);
    case 'github_search': {
      const type = ['repositories', 'issues', 'code'].includes(args.type) ? args.type : 'repositories';
      const gh = ctx.ghToken ? { Authorization: 'Bearer ' + ctx.ghToken } : {};
      const j = await jfetch(`https://api.github.com/search/${type}?per_page=5&q=` +
        encodeURIComponent(String(args.query || '')), { Accept: 'application/vnd.github+json', ...gh });
      return JSON.stringify((j.items || []).map(it => type === 'repositories'
        ? { repo: it.full_name, stars: it.stargazers_count, desc: (it.description || '').slice(0, 150), url: it.html_url }
        : type === 'issues'
          ? { title: it.title, state: it.state, url: it.html_url, comments: it.comments }
          : { repo: it.repository?.full_name, path: it.path, url: it.html_url }));
    }
    case 'github_get_file': {
      if (!/^[\w.-]+\/[\w.-]+$/.test(args.repo || '')) throw new Error('repo must be owner/name');
      const gh = ctx.ghToken ? { Authorization: 'Bearer ' + ctx.ghToken } : {};
      const j = await jfetch(`https://api.github.com/repos/${args.repo}/contents/` +
        encodeURI(String(args.path || '')) + (args.ref ? `?ref=${encodeURIComponent(args.ref)}` : ''),
        { Accept: 'application/vnd.github+json', ...gh });
      if (j.content) return Buffer.from(j.content, 'base64').toString('utf8').slice(0, 6000);
      throw new Error('not a file');
    }
    case 'get_weather': {
      const g = await jfetch('https://geocoding-api.open-meteo.com/v1/search?count=1&name=' +
        encodeURIComponent(String(args.location || '')));
      const loc = g.results?.[0];
      if (!loc) throw new Error('location not found');
      const w = await jfetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
        '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m' +
        '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3');
      return JSON.stringify({ place: `${loc.name}, ${loc.country}`, current: w.current, daily: w.daily });
    }
    case 'hn_search': {
      const j = await jfetch('https://hn.algolia.com/api/v1/search?hitsPerPage=5&query=' +
        encodeURIComponent(String(args.query || '')));
      return JSON.stringify((j.hits || []).map(h => ({
        title: h.title, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        points: h.points, comments: h.num_comments })));
    }
    default: throw new Error('unknown tool ' + name);
  }
}

/* Agentic tool loop: model decides which real APIs to call, we execute, repeat */
async function toolLoop(res, { apiKey, baseUrl, model, messages, connectors, ghToken }) {
  const tools = connectors.flatMap(c => TOOL_DEFS[c] || []);
  const step = s => res.write(`data: ${JSON.stringify({ step: s })}\n\n`);
  const url = baseUrl || XAI_CHAT;
  const t0 = Date.now();
  let msgs = toOpenAI(messages), calls = 0;
  for (let round = 0; round < 5; round++) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: msgs, tools, tool_choice: 'auto' }),
    });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    const m = j.choices?.[0]?.message;
    if (!m) throw new Error('empty response');
    if (m.tool_calls?.length) {
      msgs.push(m);
      for (const tc of m.tool_calls.slice(0, 4)) {
        let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
        calls++;
        step(`${tc.function.name}(${JSON.stringify(args).slice(0, 90)})`);
        let result;
        try { result = await execTool(tc.function.name, args, { ghToken }); }
        catch (e) { result = 'Error: ' + e.message; }
        msgs.push({ role: 'tool', tool_call_id: tc.id, content: String(result).slice(0, 9000) });
      }
      continue;
    }
    if (calls) res.write(`data: ${JSON.stringify({ stepsDone: true,
      elapsed: ((Date.now() - t0) / 1000).toFixed(1) + 's · ' + calls + ' tool calls' })}\n\n`);
    return m.content || '';
  }
  res.write(`data: ${JSON.stringify({ stepsDone: true, elapsed: 'tool limit reached' })}\n\n`);
  return 'I hit the tool-call limit before finishing. Here is what I gathered so far — please narrow the question.';
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
        connectors = [],
        githubToken = '',
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

      /* ── REAL DeepSearch: actual DuckDuckGo search with live progress ── */
      let search = null;
      if ((features.search || features.research) && lastUser?.content) {
        search = await runSearch(res, lastUser.content, !!features.research);
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
        /* Demo mode + search: answer built from REAL results */
        if (search?.results.length) {
          const list = search.results.map((r, i) =>
            `${i + 1}. **[${r.title || r.url}](${r.url})**\n   ${r.snippet}`).join('\n');
          return streamDemo(res, `### Live web results for "${(lastUser.content || '').slice(0, 60)}"

${list}

> These are **real search results** fetched just now (DuckDuckGo, ${search.elapsed}).
> Add an xAI API key in Settings and Grok will read the sources and synthesize a full answer.`);
        }
        return streamDemo(res, demoReply(lastUser?.content || '', features));
      }

      /* ── Search context + citation instructions ── */
      const sysExtra = [];
      if (search?.results.length) {
        const ctx = search.results.map((r, i) => `[${i + 1}] ${r.title} — ${r.url}\n${r.snippet}`).join('\n\n')
          + search.pages.map(p => `\n\n[page] ${p.url}\n${p.text}`).join('');
        sysExtra.push(`Live web search results fetched ${new Date().toISOString()} (cite as [n] where used):\n\n${ctx}`);
      }
      if (features.think) sysExtra.push('Think carefully before answering. Prefer rigorous reasoning.');
      const allMsgs = sysExtra.length
        ? [{ role: 'system', content: sysExtra.join('\n\n') }, ...messages]
        : messages;

      /* ── REAL connectors: agentic tool-calling loop over public APIs ── */
      const validConns = (Array.isArray(connectors) ? connectors : []).filter(c => TOOL_DEFS[c]);
      if (validConns.length) {
        try {
          const content = await toolLoop(res, { apiKey, baseUrl, model,
            messages: allMsgs, connectors: validConns, ghToken: githubToken });
          for (const chunk of content.match(/[\s\S]{1,8}/g) || []) {
            res.write(`data: ${JSON.stringify({ delta: chunk })}\n\n`);
            await new Promise(r => setTimeout(r, 6));
          }
          appendSources(res, search);
          res.write('data: [DONE]\n\n');
          return res.end();
        } catch (e) {
          res.write(`data: ${JSON.stringify({ delta: `Tool loop error: ${e.message}\n\nFalling back to direct answer.\n\n` })}\n\n`);
        }
      }

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
      appendSources(res, search);
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

/* Append verified real sources under the model answer */
function appendSources(res, search) {
  if (!search?.results?.length) return;
  const list = search.results.map((r, i) => {
    let host = ''; try { host = new URL(r.url).hostname.replace(/^www\./, ''); } catch {}
    return `${i + 1}. [${r.title || host}](${r.url})`;
  }).join('\n');
  res.write(`data: ${JSON.stringify({ delta: `\n\n---\n**Sources**\n${list}\n` })}\n\n`);
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
