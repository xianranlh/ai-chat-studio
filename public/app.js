/* Grok · frontend (1:1 grok.com) */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* Modes — Fast / Auto / Expert / Heavy */
const MODES = [
  { id: 'fast',   name: 'Fast',   desc: 'Quick answers · Grok 3 mini', ic: 'zap' },
  { id: 'auto',   name: 'Auto',   desc: 'Routes between Fast and Expert', ic: 'sparkles' },
  { id: 'expert', name: 'Expert', desc: 'Deep reasoning · Grok 4', ic: 'brain', think: true },
  { id: 'heavy',  name: 'Heavy',  desc: 'Multi-agent · SuperGrok', ic: 'blocks' },
];
const MODE_MODEL = {
  fast: 'grok-3-mini', auto: 'grok-4', expert: 'grok-4', heavy: 'grok-4-heavy',
};
let modeSel = localStorage.getItem('acs.modeSel') || 'fast';
const curMode = () => MODES.find(m => m.id === modeSel) || MODES[0];

/* State */
let convs = JSON.parse(localStorage.getItem('acs.convs') || '[]');
let curId = localStorage.getItem('acs.cur') || null;
let apiKey = localStorage.getItem('acs.apiKey') || '';
let baseUrl = localStorage.getItem('acs.baseUrl') || '';
let attachments = [], streaming = false, abortCtl = null, privateMode = false;
const features = { search: false, think: false, imagine: false };

/* Grok document skills */
const SKILLS = [
  { id: 'docx', ic: 'file-text', name: 'docx', desc: 'Create or edit Word documents' },
  { id: 'pdf',  ic: 'file-text', name: 'pdf',  desc: 'Create or edit PDF files' },
  { id: 'pptx', ic: 'file-text', name: 'pptx', desc: 'Create or edit presentations' },
  { id: 'xlsx', ic: 'file-text', name: 'xlsx', desc: 'Create or edit spreadsheets' },
];
let activeSkill = localStorage.getItem('acs.skill') || '';

const CONNECTORS = [
  { id: 'github',   ic: 'github',     name: 'GitHub',       desc: 'Repos, issues & PRs' },
  { id: 'gdrive',   ic: 'hard-drive', name: 'Google Drive', desc: 'Docs & sheets' },
  { id: 'gmail',    ic: 'mail',       name: 'Gmail',        desc: 'Search & summarize mail' },
  { id: 'calendar', ic: 'calendar',   name: 'Calendar',     desc: 'Events & scheduling' },
  { id: 'notion',   ic: 'book-open',  name: 'Notion',       desc: 'Pages & databases' },
  { id: 'x',        ic: 'link-2',     name: 'X',            desc: 'Posts & trends' },
];
let connectedIds = JSON.parse(localStorage.getItem('acs.connectors') || '[]');

/* Official grok.com Customize response styles (UI labels match product) */
const RESPONSE_STYLES = [
  {
    id: 'concise', name: 'Concise',
    desc: 'Responds briefly and directly.',
    prompt: 'Respond briefly and directly, using as few words as possible. Focus on the core point without elaboration or follow-up questions.',
  },
  {
    id: 'formal', name: 'Formal',
    desc: 'Responds using a formal tone.',
    prompt: 'Respond in a formal, professional tone. Use clear structure and polished language.',
  },
  {
    id: 'socratic', name: 'Socratic',
    desc: 'Responds in a way to help you learn.',
    prompt: 'Respond in a Socratic style to help the user learn: ask guiding questions and teach step by step rather than only giving final answers.',
  },
  {
    id: 'custom', name: 'Custom',
    desc: 'Write your own instructions.',
    prompt: '',
  },
];

const DEFAULT_AGENTS = [
  { id: 'a1', name: 'Research', sys: 'You are a research agent. List key facts, data, and background relevant to the user question as bullet points.' },
  { id: 'a2', name: 'Reasoning', sys: 'You are a reasoning agent. Work through the problem step by step with clear logic and intermediate conclusions.' },
  { id: 'a3', name: 'Critique', sys: 'You are a critique agent. Find risks, edge cases, counterexamples, and weak assumptions.' },
  { id: 'a4', name: 'Synthesis', sys: 'You are a synthesis agent. Propose a clear, balanced draft answer that resolves the question for the user.' },
];
const DEFAULT_PREFS = {
  themeChoice: 'dark',
  connBannerDismissed: false,
  cuMemory: false,
  cuName: '', cuJob: '', cuAbout: '', cuTraits: [],
  cuStyle: 'concise',       /* response style id */
  cuStyleCustom: '',        /* custom instructions when cuStyle === custom */
  memories: [],
  agents: DEFAULT_AGENTS.map(a => ({ ...a })),
};
let prefs = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem('acs.prefs') || '{}') };
if (!Array.isArray(prefs.memories)) prefs.memories = [];
if (!Array.isArray(prefs.cuTraits)) prefs.cuTraits = [];
if (!Array.isArray(prefs.agents)) prefs.agents = DEFAULT_AGENTS.map(a => ({ ...a }));
/* 旧版 cuEnabled 迁移：有自定义内容则视为启用过 */
if (!RESPONSE_STYLES.some(s => s.id === prefs.cuStyle)) prefs.cuStyle = 'concise';
if (prefs.cuStyleCustom == null && prefs.cuSystem) prefs.cuStyleCustom = prefs.cuSystem;
prefs.agents = prefs.agents.map((a, i) => ({
  id: a.id || ('a' + (i + 1) + '-' + Date.now()),
  name: a.name || `Agent ${i + 1}`,
  sys: a.sys || '',
}));
const savePrefs = () => localStorage.setItem('acs.prefs', JSON.stringify(prefs));

function stylePrompt() {
  if (prefs.cuStyle === 'custom') return (prefs.cuStyleCustom || '').trim();
  const s = RESPONSE_STYLES.find(x => x.id === prefs.cuStyle);
  return (s?.prompt || '').trim();
}
function activeAgents() {
  const list = (prefs.agents || []).filter(a => a.name || a.sys).slice(0, 4);
  if (list.length) {
    return list.map((a, i) => ({
      name: (a.name || `Agent ${i + 1}`).trim(),
      sys: (a.sys || 'Analyze the user question carefully and contribute your specialty.').trim(),
    }));
  }
  return DEFAULT_AGENTS.map(a => ({ name: a.name, sys: a.sys }));
}
/* Official Grok Customize trait chips */
const TRAITS = [
  'Professional',
  'Friendly',
  'Encouraging',
  'Witty',
  'Direct',
  'Concise',
  'Curious',
  'Skeptical',
  'Empathetic',
  'Forward-thinking',
  'Tell it like it is',
  'Don\'t sugarcoat',
];

const save = () => {
  if (privateMode) return;
  localStorage.setItem('acs.convs', JSON.stringify(convs));
  localStorage.setItem('acs.cur', curId || '');
};
const cur = () => convs.find(c => c.id === curId);
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* Markdown */
function md(text) {
  if (window.marked) return marked.parse(text, { breaks: true, mangle: false, headerIds: false });
  return '<p>' + esc(text).replace(/\n/g, '<br>') + '</p>';
}
function renderBubble(el, text, done) {
  el.innerHTML = md(text);
  el.classList.toggle('cursor', !done);
}

/* Conversations */
let convFilter = '';
function groupLabel(ts) {
  const d = new Date(+ts), now = new Date();
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= day0) return 'Today';
  if (d.getTime() >= day0 - 864e5) return 'Yesterday';
  if (d.getTime() >= day0 - 7 * 864e5) return 'Previous 7 days';
  if (d.getTime() >= day0 - 30 * 864e5) return 'Previous 30 days';
  return 'Older';
}
function renderConvs() {
  const list = $('#convList'); list.innerHTML = '';
  let items = convs.filter(c => !c.private && (!convFilter ||
    (c.title || '').toLowerCase().includes(convFilter) ||
    c.messages.some(m => (m.content || '').toLowerCase().includes(convFilter))));

  /* Project filter view */
  if (activeProj) {
    const p = projects.find(x => x.id === activeProj);
    if (p) {
      items = items.filter(c => c.proj === activeProj);
      const head = document.createElement('div'); head.className = 'proj-head';
      head.innerHTML = `${icon('folder')}<b>${esc(p.name)}</b><span>${items.length} chats</span>
        <button title="Exit project">${icon('x')}</button>`;
      head.querySelector('button').onclick = () => { activeProj = ''; renderConvs(); };
      list.append(head);
    } else activeProj = '';
  }

  $('#convEmpty').classList.toggle('hidden', !!items.length);
  $('#convEmpty').textContent = convFilter ? 'No matches' : (activeProj ? 'No chats in this project' : 'No conversations');

  let lastLabel = null, bucket = [];
  const flush = () => {
    if (!bucket.length || !lastLabel) return;
    const h = document.createElement('div'); h.className = 'conv-group'; h.textContent = lastLabel;
    list.append(h); bucket.forEach(c => list.append(convItemEl(c))); bucket = [];
  };
  items.forEach(c => {
    const l = groupLabel(c.id);
    if (l !== lastLabel) { flush(); lastLabel = l; }
    bucket.push(c);
  });
  flush();
}
function convItemEl(c) {
  const div = document.createElement('div');
  div.className = 'conv-item' + (c.id === curId ? ' active' : '');
  const projTag = c.proj && !activeProj
    ? `<span class="conv-proj">${esc((projects.find(p => p.id === c.proj) || {}).name || '')}</span>` : '';
  div.innerHTML = `<span class="conv-ic">${icon('message-square')}</span>
    <span class="conv-title">${esc(c.title || 'New chat')}${projTag}</span>
    <span class="conv-ops">
      <button data-op="proj" title="Move to project">${icon('folder')}</button>
      <button data-op="rename" title="Rename">${icon('pen-square')}</button>
      <button data-op="del" title="Delete">${icon('trash-2')}</button>
    </span>`;
  div.onclick = () => { curId = c.id; save(); renderConvs(); renderChat(); };
  div.querySelector('[data-op=proj]').onclick = e => { e.stopPropagation(); assignProj(c); };
  div.querySelector('[data-op=rename]').onclick = e => {
    e.stopPropagation();
    const t = prompt('Rename', c.title || 'New chat');
    if (t !== null) { c.title = t.trim() || c.title; save(); renderConvs(); }
  };
  div.querySelector('[data-op=del]').onclick = e => {
    e.stopPropagation();
    convs = convs.filter(x => x.id !== c.id);
    if (curId === c.id) curId = convs[0]?.id || null;
    save(); renderConvs(); renderChat();
  };
  return div;
}

/* ── Projects ── */
let projects = JSON.parse(localStorage.getItem('acs.projects') || '[]');
let activeProj = '';
const saveProjects = () => localStorage.setItem('acs.projects', JSON.stringify(projects));
function assignProj(c) {
  if (!projects.length) {
    const name = prompt('No projects yet. Name your first project:');
    if (!name?.trim()) return;
    projects.push({ id: 'pj-' + Date.now(), name: name.trim() }); saveProjects();
  }
  const menu = projects.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
  const ans = prompt(`Move "${c.title || 'New chat'}" to which project?\n\n${menu}\n\nEnter number (0 = remove from project):`);
  if (ans === null) return;
  const n = parseInt(ans);
  if (n === 0) delete c.proj;
  else if (projects[n - 1]) c.proj = projects[n - 1].id;
  save(); renderConvs();
}
function renderProjects() {
  const list = $('#projList'); list.innerHTML = '';
  if (!projects.length) list.innerHTML = '<p class="hint">No projects yet. Create one below.</p>';
  projects.forEach(p => {
    const count = convs.filter(c => c.proj === p.id).length;
    const d = document.createElement('div');
    d.className = 'conn-item';
    d.innerHTML = `<span class="conn-ic">${icon('folder')}</span>
      <div class="p-info"><div class="p-name">${esc(p.name)}</div><div class="p-meta">${count} chats</div></div>
      <div class="p-acts">
        <button data-a="open" title="Open">${icon('message-square')}</button>
        <button data-a="edit" title="Rename">${icon('pen-square')}</button>
        <button data-a="del" title="Delete">${icon('trash-2')}</button>
      </div>`;
    d.querySelector('[data-a=open]').onclick = () => {
      activeProj = p.id; renderConvs(); $('#dlgProjects').close();
      $('#sidebar').classList.remove('collapsed'); setNavActive('chat');
    };
    d.querySelector('[data-a=edit]').onclick = () => {
      const t = prompt('Rename project', p.name);
      if (t?.trim()) { p.name = t.trim(); saveProjects(); renderProjects(); renderConvs(); }
    };
    d.querySelector('[data-a=del]').onclick = () => {
      if (!confirm(`Delete project "${p.name}"? Chats are kept, just unfiled.`)) return;
      convs.forEach(c => { if (c.proj === p.id) delete c.proj; });
      projects = projects.filter(x => x.id !== p.id);
      if (activeProj === p.id) activeProj = '';
      saveProjects(); save(); renderProjects(); renderConvs();
    };
    list.append(d);
  });
}

/* Chat render */
function renderChat() {
  const c = cur(), chat = $('#chat');
  chat.innerHTML = '';
  $('#welcome').style.display = (!c || !c.messages.length) ? '' : 'none';
  if (!c) return;
  c.messages.forEach((m, i) =>
    chat.append(msgEl(m, i === c.messages.length - 1 && m.role === 'assistant')));
  scrollBottom();
}
function msgEl(m, isLastAi) {
  const div = document.createElement('div');
  div.className = 'msg ' + (m.role === 'user' ? 'user' : 'ai');
  const bubble = document.createElement('div'); bubble.className = 'bubble';

  if (m.role === 'user') {
    if (m.images?.length) {
      const imgs = document.createElement('div'); imgs.className = 'msg-imgs';
      m.images.forEach(u => { const i = new Image(); i.src = u; imgs.append(i); });
      bubble.append(imgs);
    }
    const p = document.createElement('div'); p.textContent = m.content; bubble.append(p);
    div.append(bubble);
  } else {
    const av = document.createElement('div'); av.className = 'avatar';
    if (m.think || m.steps?.length || m.agents?.length) {
      if (m.think) bubble.append(thinkPanelEl(m.think, true).panel);
      if (m.steps?.length) bubble.append(dsPanelEl(m.steps, true, m.stepsElapsed).panel);
      if (m.agents?.length) bubble.append(agentGridEl(m.agents, true).grid);
      const fin = document.createElement('div');
      renderBubble(fin, m.content, true); bubble.append(fin);
    } else {
      renderBubble(bubble, m.content, true);
    }
    if (m.gen) {
      const g = document.createElement('div'); g.className = 'gen-grid';
      if (m.gen.loading) {
        g.innerHTML = [0,1,2,3].map(() =>
          `<div class="img-cell loading"><span class="ds-spin"></span></div>`).join('');
      } else {
        (m.gen.images || []).forEach(u => {
          const cell = document.createElement('div'); cell.className = 'img-cell';
          cell.innerHTML = `<img src="${u}" alt="" loading="lazy">
            <div class="img-acts"><button data-a="dl" title="Download">${icon('download')}</button></div>`;
          cell.querySelector('[data-a=dl]').onclick = () => {
            const a = document.createElement('a'); a.href = u; a.download = 'imagine.png'; a.click();
          };
          g.append(cell);
        });
      }
      bubble.append(g);
    }
    if (m.content) {
      const acts = document.createElement('div'); acts.className = 'msg-acts';
      acts.innerHTML = `<button data-a="copy" title="Copy">${icon('copy')}</button>
        <button data-a="regen" title="Regenerate">${icon('refresh-cw')}</button>`;
      const cp = acts.querySelector('[data-a=copy]');
      cp.onclick = () => {
        navigator.clipboard.writeText(m.content);
        cp.innerHTML = '✓'; setTimeout(() => cp.innerHTML = icon('copy'), 1200);
      };
      acts.querySelector('[data-a=regen]').onclick = () => regenerate();
      bubble.append(acts);
    }
    if (isLastAi && m.content && !m.gen?.loading) {
      const fus = document.createElement('div'); fus.className = 'followups';
      ['Explain more', 'Give examples', 'Summarize'].forEach(q => {
        const b = document.createElement('button'); b.className = 'followup'; b.textContent = q;
        b.onclick = () => { $('#input').value = q; updateSendState(); send(); };
        fus.append(b);
      });
      bubble.append(fus);
    }
    div.append(av, bubble);
  }
  return div;
}

function dsPanelEl(steps, done, elapsed) {
  const panel = document.createElement('div');
  panel.className = 'ds-panel' + (done ? ' done collapsed' : '');
  panel.innerHTML = `<div class="ds-head"><span class="ds-spin"></span><b>DeepSearch</b>
    <span class="ds-time">${done ? esc(elapsed || 'Done') : 'Searching…'}</span>
    <span class="ds-caret">${icon('chevron-down')}</span></div><div class="ds-steps"></div>`;
  const list = panel.querySelector('.ds-steps');
  const add = s => {
    const d = document.createElement('div'); d.className = 'ds-step'; d.textContent = s; list.append(d);
  };
  steps.forEach(add);
  panel.querySelector('.ds-head').onclick = () => panel.classList.toggle('collapsed');
  return {
    panel, add,
    finish: t => {
      panel.classList.add('done');
      panel.querySelector('.ds-time').textContent = t || 'Done';
    },
  };
}
function thinkPanelEl(text, done) {
  const panel = document.createElement('div');
  panel.className = 'think-panel' + (done ? ' collapsed' : '');
  panel.innerHTML = `<div class="think-head">${icon('brain')}<b>Thoughts</b>
    <span class="ds-caret" style="margin-left:auto">${icon('chevron-down')}</span></div>
    <div class="think-body"></div>`;
  panel.querySelector('.think-body').textContent = text || '';
  panel.querySelector('.think-head').onclick = () => panel.classList.toggle('collapsed');
  return { panel, body: panel.querySelector('.think-body') };
}
function agentGridEl(agents, done) {
  const grid = document.createElement('div'); grid.className = 'agents';
  grid.innerHTML = `<div class="agents-head">Multi-agent · ${agents.length} agents</div>`;
  const row = document.createElement('div'); row.className = 'agents-grid'; grid.append(row);
  const els = agents.map(a => {
    const card = document.createElement('div');
    card.className = 'agent-card' + (done ? ' done' : '');
    const head = document.createElement('div'); head.className = 'agent-name';
    head.innerHTML = `<i></i>${esc(a.name)}`;
    const body = document.createElement('div'); body.className = 'agent-body';
    body.textContent = a.content || '';
    card.append(head, body); row.append(card);
    head.onclick = () => card.classList.toggle('open');
    return { card, body };
  });
  return { grid, els };
}
const scrollBottom = () => {
  const s = $('#chatScroll'); s.scrollTop = s.scrollHeight;
};

/* Send / stream */
async function send() {
  if (streaming) { abortCtl?.abort(); return; }
  const text = $('#input').value.trim();
  if (!text && !attachments.length) return;

  if (!cur()) {
    convs.unshift({
      id: Date.now() + '', title: '', mode: curMode().name,
      ...(privateMode && { private: true }),
      ...(activeProj && !privateMode && { proj: activeProj }), messages: [],
    });
    curId = convs[0].id;
  }
  cur().mode = curMode().name;
  const c = cur();

  if (features.imagine && text) {
    c.messages.push({ role: 'user', content: text });
    if (!c.title) c.title = text.slice(0, 28);
    $('#input').value = ''; $('#input').style.height = 'auto';
    updateSendState(); renderConvs(); renderChat();
    return imagineInChat(c, text);
  }

  let content = text;
  attachments.filter(a => a.kind === 'text').forEach(a => {
    content += `\n\n[File: ${a.name}]\n\`\`\`\n${a.data.slice(0, 8000)}\n\`\`\``;
  });
  const images = attachments.filter(a => a.kind === 'image').map(a => a.data);
  c.messages.push({ role: 'user', content, ...(images.length && { images }) });
  if (!c.title) c.title = text.slice(0, 28) || 'Image chat';
  $('#input').value = ''; $('#input').style.height = 'auto';
  attachments = []; renderAttach(); updateSendState(); renderConvs(); renderChat();
  await streamReply(c);
}

async function imagineInChat(c, prompt) {
  const aiMsg = { role: 'assistant', content: '', gen: { prompt, images: [], loading: true } };
  c.messages.push(aiMsg); renderChat();
  try {
    const j = await callImageAPI(prompt);
    aiMsg.gen.loading = false;
    if (j.error) aiMsg.content = 'Image generation failed: ' + j.error;
    else {
      aiMsg.gen.images = j.images || [];
      aiMsg.content = j.demo
        ? `Generated ${aiMsg.gen.images.length} images (demo placeholders — add an API key for real images):`
        : `Generated ${aiMsg.gen.images.length} images:`;
    }
  } catch (e) {
    aiMsg.gen.loading = false; aiMsg.content = 'Error: ' + e.message;
  }
  save(); renderChat();
}

async function regenerate() {
  const c = cur(); if (!c || streaming) return;
  while (c.messages.length && c.messages.at(-1).role === 'assistant') c.messages.pop();
  if (!c.messages.length) return;
  renderChat();
  await streamReply(c);
}

async function streamReply(c) {
  const aiMsg = { role: 'assistant', content: '' };
  c.messages.push(aiMsg);
  const el = msgEl(aiMsg, false); $('#chat').append(el);
  const bubble = el.querySelector('.bubble'); bubble.classList.add('cursor');
  streaming = true; setSendBtn(true);
  abortCtl = new AbortController();
  let target = bubble, agentUI = null, dsUI = null, thinkUI = null;

  const reqModel = MODE_MODEL[modeSel] || 'grok-4';
  const reqFeatures = {
    search: features.search,
    think: features.think || !!curMode().think,
    imagine: features.imagine,
  };

  let outMsgs = c.messages.slice(0, -1).map(({ role, content, images }) => ({ role, content, images }));
  const sysParts = [];
  const skill = SKILLS.find(s => s.id === activeSkill);
  if (skill) {
    sysParts.push(`User armed the ${skill.name} skill: ${skill.desc}. Prefer outputs that help with that document type.`);
  }
  const cu = buildCustomSystem(); if (cu) sysParts.push(cu);
  if (connectedIds.length) {
    sysParts.push('Connected apps: ' + connectedIds.map(id =>
      (CONNECTORS.find(x => x.id === id) || {}).name).filter(Boolean).join(', ') + ' (demo).');
  }
  if (sysParts.length) outMsgs = [{ role: 'system', content: sysParts.join('\n\n') }, ...outMsgs];

  try {
    const resp = await fetch('/api/chat', {
      method: 'POST', signal: abortCtl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'xai', model: reqModel, features: reqFeatures,
        apiKey, baseUrl, messages: outMsgs,
        agents: /heavy/i.test(reqModel) ? activeAgents() : undefined,
        agentCount: prefs.agentCount || 4,
      }),
    });
    const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const p = line.slice(6).trim(); if (p === '[DONE]') continue;
        try {
          const j = JSON.parse(p);
          if (j.think) {
            aiMsg.think = (aiMsg.think || '') + j.think;
            if (!thinkUI) {
              bubble.classList.remove('cursor'); bubble.innerHTML = '';
              thinkUI = thinkPanelEl('', false);
              bubble.append(thinkUI.panel);
              target = document.createElement('div'); bubble.append(target);
            }
            thinkUI.body.textContent = aiMsg.think; scrollBottom();
          } else if (j.step) {
            (aiMsg.steps ??= []).push(j.step);
            if (!dsUI) {
              if (!thinkUI) { bubble.classList.remove('cursor'); bubble.innerHTML = ''; }
              dsUI = dsPanelEl([], false);
              bubble.append(dsUI.panel);
              if (!target || target === bubble) {
                target = document.createElement('div'); bubble.append(target);
              }
            }
            dsUI.add(j.step); scrollBottom();
          } else if (j.stepsDone) {
            aiMsg.stepsElapsed = j.elapsed || '';
            dsUI?.finish(j.elapsed);
          } else if (j.agents) {
            aiMsg.agents = j.agents.map(n => ({ name: n, content: '' }));
            bubble.classList.remove('cursor');
            if (!dsUI && !thinkUI) bubble.innerHTML = '';
            agentUI = agentGridEl(aiMsg.agents, false);
            bubble.append(agentUI.grid);
            target = document.createElement('div'); bubble.append(target);
          } else if (j.agent !== undefined) {
            const a = agentUI?.els[j.agent];
            if (a) {
              if (j.done) a.card.classList.add('done');
              else {
                aiMsg.agents[j.agent].content += j.delta;
                a.body.textContent = aiMsg.agents[j.agent].content;
                a.body.scrollTop = a.body.scrollHeight;
              }
              scrollBottom();
            }
          } else if (j.delta) {
            aiMsg.content += j.delta;
            renderBubble(target, aiMsg.content, false); scrollBottom();
          }
        } catch {}
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') aiMsg.content += '\n\nConnection error: ' + e.message;
  }
  if (!aiMsg.content) aiMsg.content = '(stopped)';
  streaming = false; setSendBtn(false); save();
  renderChat();
}

function setSendBtn(stop) {
  const b = $('#btnSend');
  b.innerHTML = stop ? icon('square') : icon('arrow-up');
  b.classList.toggle('stop', stop);
  if (stop) b.disabled = false; else updateSendState();
}
function updateSendState() {
  if (streaming) return;
  $('#btnSend').disabled = !($('#input').value.trim() || attachments.length);
}

/* Attachments */
function renderAttach() {
  const bar = $('#attachBar');
  bar.classList.toggle('hidden', !attachments.length);
  bar.innerHTML = '';
  attachments.forEach((a, i) => {
    const d = document.createElement('div'); d.className = 'attach-item';
    if (a.kind === 'image') {
      d.innerHTML = `<img src="${a.data}" alt=""><button class="attach-x">${icon('x')}</button>`;
    } else {
      d.innerHTML = `${icon('file-text')}<span>${esc(a.name)}</span><button class="attach-x">${icon('x')}</button>`;
    }
    d.querySelector('.attach-x').onclick = () => {
      attachments.splice(i, 1); renderAttach(); updateSendState();
    };
    bar.append(d);
  });
}

function renderChipBar() {
  const bar = $('#chipBar');
  const chips = [];
  if (features.search) chips.push({ id: 'search', label: 'DeepSearch', ic: 'globe' });
  if (features.think) chips.push({ id: 'think', label: 'Think', ic: 'brain' });
  if (features.imagine) chips.push({ id: 'imagine', label: 'Imagine', ic: 'image' });
  const skill = SKILLS.find(s => s.id === activeSkill);
  if (skill) chips.push({ id: 'skill', label: skill.name, ic: skill.ic, skill: true });

  bar.classList.toggle('hidden', !chips.length);
  bar.innerHTML = '';
  chips.forEach(c => {
    const el = document.createElement('span');
    el.className = 'scope-chip';
    el.innerHTML = `${icon(c.ic)} ${esc(c.label)} <button title="Remove">${icon('x')}</button>`;
    el.querySelector('button').onclick = () => {
      if (c.skill) { activeSkill = ''; localStorage.setItem('acs.skill', ''); }
      else features[c.id] = false;
      renderChipBar();
    };
    bar.append(el);
  });
}

/* Theme / mode menu */
function resolveMode(choice) {
  if (choice === 'system') {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return choice || 'dark';
}
function applyMode(m) {
  document.documentElement.dataset.mode = m;
  localStorage.setItem('acs.mode', m);
}
function applyPrefs() {
  applyMode(resolveMode(prefs.themeChoice));
}
function setMode(id) {
  modeSel = MODES.some(m => m.id === id) ? id : 'fast';
  localStorage.setItem('acs.modeSel', modeSel);
  $('#modelName').textContent = curMode().name;
  /* Expert implies Think chip visually optional — Expert already thinks server-side */
  renderModeMenu();
}
function renderModeMenu() {
  const menu = $('#modelMenu'); menu.innerHTML = '';
  MODES.forEach(m => {
    const d = document.createElement('div');
    d.className = 'model-item' + (m.id === modeSel ? ' sel' : '');
    d.innerHTML = `<span class="mode-ic">${icon(m.ic)}</span>
      <span><b>${m.name}</b><small>${m.desc}</small></span>`;
    d.onclick = () => { setMode(m.id); menu.classList.add('hidden'); };
    menu.append(d);
  });
  const sep = document.createElement('div'); sep.className = 'model-sep'; menu.append(sep);
  const cu = document.createElement('div');
  cu.className = 'model-item';
  const st = RESPONSE_STYLES.find(s => s.id === prefs.cuStyle) || RESPONSE_STYLES[0];
  cu.innerHTML = `<span class="mode-ic">${icon('pen-square')}</span>
    <span><b>Customize Grok</b><small>${st.name}${prefs.agents?.length ? ' · ' + prefs.agents.length + ' agents' : ''}</small></span>`;
  cu.onclick = () => { menu.classList.add('hidden'); openSettings('customize'); };
  menu.append(cu);
}

/* Events */
$('#btnNew').onclick = () => {
  if (privateMode) togglePrivate(false);
  curId = null; save(); renderConvs(); renderChat(); $('#input').focus();
};
$('#btnSide').onclick = () => $('#sidebar').classList.toggle('collapsed');
$('#btnCollapse').onclick = () => $('#sidebar').classList.toggle('collapsed');
$('#convSearch').addEventListener('input', e => {
  convFilter = e.target.value.trim().toLowerCase(); renderConvs();
});
$('#btnTopImagine').onclick = () => openImagine();

/* Sidebar nav: Chat / Imagine / Skills / Connectors */
function setNavActive(view) {
  $$('.nav-link').forEach(x => x.classList.toggle('active', x.dataset.view === view));
}
$$('.nav-link').forEach(a => a.onclick = () => {
  const v = a.dataset.view;
  if (v === 'chat') {
    setNavActive('chat');
    $('#imagineView').classList.add('hidden');
    return;
  }
  if (v === 'imagine') {
    setNavActive('imagine');
    openImagine();
    return;
  }
  if (v === 'skills') {
    setNavActive('skills');
    renderSkills();
    $('#dlgSkills').showModal();
    return;
  }
  if (v === 'connectors') {
    setNavActive('connectors');
    renderConnectors();
    $('#dlgConnectors').showModal();
    return;
  }
  if (v === 'projects') {
    setNavActive('projects');
    renderProjects();
    $('#dlgProjects').showModal();
    return;
  }
});
$('#btnAddProj').onclick = () => {
  const name = prompt('Project name:');
  if (!name?.trim()) return;
  projects.push({ id: 'pj-' + Date.now(), name: name.trim() });
  saveProjects(); renderProjects();
};

function togglePrivate(on) {
  privateMode = on ?? !privateMode;
  document.body.classList.toggle('private-mode', privateMode);
  $('#btnPrivate').classList.toggle('active', privateMode);
  if (privateMode) {
    curId = null; renderChat();
    $('#wTitle').textContent = 'Private chat';
  } else {
    $('#wTitle').textContent = 'What do you want to know?';
    renderConvs(); renderChat();
  }
}
$('#btnPrivate').onclick = () => togglePrivate();

$('#btnSend').onclick = send;
$('#input').addEventListener('keydown', e => {
  if (e.isComposing) return;
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
$('#input').addEventListener('input', e => {
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
  updateSendState();
});

$('#modelBtn').onclick = e => {
  e.stopPropagation();
  $('#modelMenu').classList.toggle('hidden');
  $('#plusMenu').classList.add('hidden');
  $('#btnPlus').classList.remove('open');
};
document.addEventListener('click', e => {
  if (!e.target.closest('.model-select')) $('#modelMenu').classList.add('hidden');
  if (!e.target.closest('.plus-wrap')) {
    $('#plusMenu').classList.add('hidden');
    $('#btnPlus').classList.remove('open');
  }
});

/* + menu */
$('#btnPlus').onclick = e => {
  e.stopPropagation();
  const open = !$('#plusMenu').classList.toggle('hidden');
  $('#btnPlus').classList.toggle('open', open);
  $('#modelMenu').classList.add('hidden');
  if (open) syncPlusChecks();
};
$('#plusMenu').onclick = e => e.stopPropagation();
function syncPlusChecks() {
  ['search', 'imagine'].forEach(k => {
    const id = '#pm' + k.charAt(0).toUpperCase() + k.slice(1);
    const btn = $(id);
    if (btn) btn.classList.toggle('on', !!features[k]);
  });
}
$('#plusMenu').querySelectorAll('button').forEach(btn => {
  btn.onclick = () => {
    const act = btn.dataset.act;
    if (act === 'upload') { closePlus(); $('#fileInput').click(); }
    else if (act === 'skills') { closePlus(); renderSkills(); $('#dlgSkills').showModal(); }
    else if (act === 'connectors') { closePlus(); renderConnectors(); $('#dlgConnectors').showModal(); }
    else if (act === 'search' || act === 'imagine') {
      features[act] = !features[act];
      syncPlusChecks();
      renderChipBar();
    }
  };
});
function closePlus() {
  $('#plusMenu').classList.add('hidden');
  $('#btnPlus').classList.remove('open');
}

/* Connectors banner */
function updateConnBanner() {
  const show = !prefs.connBannerDismissed && !connectedIds.length;
  $('#connBanner').classList.toggle('hidden', !show);
}
$('#connBannerDismiss').onclick = () => {
  prefs.connBannerDismissed = true; savePrefs(); updateConnBanner();
};
$('#connBannerGo').onclick = () => {
  renderConnectors(); $('#dlgConnectors').showModal();
};

/* Skills */
function renderSkills() {
  const grid = $('#skillGrid'); grid.innerHTML = '';
  SKILLS.forEach(s => {
    const d = document.createElement('button');
    d.className = 'skill-card' + (s.id === activeSkill ? ' sel' : '');
    d.innerHTML = `${icon(s.ic)}<b>${s.name}</b><small>${s.desc}</small>
      ${s.id === activeSkill ? icon('circle-check', 'skill-check') : ''}`;
    d.onclick = () => {
      activeSkill = activeSkill === s.id ? '' : s.id;
      localStorage.setItem('acs.skill', activeSkill);
      renderSkills(); renderChipBar();
    };
    grid.append(d);
  });
}

/* Connectors */
function renderConnectors() {
  const list = $('#connList'); list.innerHTML = '';
  CONNECTORS.forEach(c => {
    const on = connectedIds.includes(c.id);
    const d = document.createElement('div');
    d.className = 'conn-item';
    d.innerHTML = `<span class="conn-ic">${icon(c.ic)}</span>
      <div class="p-info"><div class="p-name">${c.name}</div><div class="p-meta">${c.desc}</div></div>
      <button class="btn-outline conn-btn ${on ? 'on' : ''}" type="button">
        ${on ? icon('circle-check') + ' Connected' : 'Connect'}</button>`;
    d.querySelector('.conn-btn').onclick = async e => {
      const btn = e.currentTarget;
      if (on) connectedIds = connectedIds.filter(x => x !== c.id);
      else {
        btn.textContent = 'Authorizing…';
        await new Promise(r => setTimeout(r, 700));
        connectedIds.push(c.id);
      }
      localStorage.setItem('acs.connectors', JSON.stringify(connectedIds));
      renderConnectors(); updateConnBanner();
    };
    list.append(d);
  });
}

/* Imagine */
let imgRatio = '1:1';
let gallery = JSON.parse(localStorage.getItem('acs.imagine') || '[]');
$('#imgRatio').querySelectorAll('button').forEach(b => b.onclick = () => {
  imgRatio = b.dataset.v;
  $('#imgRatio').querySelectorAll('button').forEach(x =>
    x.classList.toggle('active', x.dataset.v === imgRatio));
});
function openImagine() {
  $('#imagineView').classList.remove('hidden');
  setNavActive('imagine');
  renderGallery();
  $('#imaginePrompt').focus();
}
$('#imagineClose').onclick = () => {
  $('#imagineView').classList.add('hidden');
  setNavActive('chat');
};
$('#imagineGo').onclick = generateImages;
$('#imaginePrompt').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault(); generateImages();
  }
});
async function callImageAPI(prompt) {
  const resp = await fetch('/api/image', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'xai', prompt, ratio: imgRatio, apiKey, baseUrl }),
  });
  return resp.json();
}
async function generateImages() {
  const prompt = $('#imaginePrompt').value.trim();
  if (!prompt) return;
  const go = $('#imagineGo');
  go.disabled = true; go.innerHTML = icon('sparkles') + ' Generating…';
  const grid = $('#imagineGrid');
  grid.insertAdjacentHTML('afterbegin',
    [0,1,2,3].map(() =>
      `<div class="img-cell loading r${imgRatio.replace(':','x')}"><span class="ds-spin"></span></div>`
    ).join(''));
  try {
    const j = await callImageAPI(prompt);
    grid.querySelectorAll('.img-cell.loading').forEach(x => x.remove());
    if (j.error) { alert(j.error); return; }
    (j.images || []).forEach(u => gallery.unshift({ u, p: prompt, r: imgRatio, t: Date.now() }));
    gallery = gallery.slice(0, 24);
    localStorage.setItem('acs.imagine', JSON.stringify(gallery));
    renderGallery();
  } finally {
    go.disabled = false;
    go.innerHTML = icon('sparkles') + ' Generate';
  }
}
function renderGallery() {
  const grid = $('#imagineGrid');
  grid.innerHTML = gallery.length ? '' :
    '<p class="hint" style="grid-column:1/-1;text-align:center;padding:40px">No images yet</p>';
  gallery.forEach((g, i) => {
    const d = document.createElement('div');
    d.className = `img-cell r${(g.r || '1:1').replace(':', 'x')}`;
    d.innerHTML = `<img src="${g.u}" alt="" loading="lazy">
      <div class="img-acts">
        <button data-a="dl" title="Download">${icon('download')}</button>
        <button data-a="del" title="Delete">${icon('trash-2')}</button>
      </div>
      <div class="img-cap">${esc(g.p.slice(0, 40))}</div>`;
    d.querySelector('[data-a=dl]').onclick = () => {
      const a = document.createElement('a'); a.href = g.u; a.download = `imagine-${g.t}.png`; a.click();
    };
    d.querySelector('[data-a=del]').onclick = () => {
      gallery.splice(i, 1);
      localStorage.setItem('acs.imagine', JSON.stringify(gallery));
      renderGallery();
    };
    grid.append(d);
  });
}

$$('[data-close]').forEach(b => b.onclick = () => {
  $('#' + b.dataset.close).close();
  setNavActive('chat');
});
/* When skills/connectors dialogs close via Esc/backdrop, reset nav */
['dlgSkills', 'dlgConnectors'].forEach(id => {
  const el = $('#' + id);
  if (el) el.addEventListener('close', () => setNavActive('chat'));
});

$('#fileInput').onchange = e => {
  [...e.target.files].forEach(f => {
    const r = new FileReader();
    if (f.type.startsWith('image/')) {
      r.onload = () => {
        attachments.push({ kind: 'image', name: f.name, data: r.result });
        renderAttach(); updateSendState();
      };
      r.readAsDataURL(f);
    } else {
      r.onload = () => {
        attachments.push({ kind: 'text', name: f.name, data: r.result });
        renderAttach(); updateSendState();
      };
      r.readAsText(f);
    }
  });
  e.target.value = '';
};

/* Voice */
$('#btnVoice').onclick = () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return alert('Speech recognition requires Chrome or Edge');
  const rec = new SR(); rec.lang = navigator.language || 'en-US'; rec.interimResults = true;
  $('#btnVoice').classList.add('active');
  rec.onresult = e => {
    $('#input').value = [...e.results].map(r => r[0].transcript).join('');
    updateSendState();
  };
  rec.onend = () => $('#btnVoice').classList.remove('active');
  rec.onerror = () => $('#btnVoice').classList.remove('active');
  rec.start();
};

let voiceRec = null;
$('#btnVoiceMode').onclick = () => {
  $('#voiceView').classList.remove('hidden');
  startVoiceSession();
};
$('#voiceStop').onclick = () => stopVoiceSession();
$('#voiceAttach').onclick = () => $('#fileInput').click();
function startVoiceSession() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  $('#voiceHint').textContent = 'You may start speaking';
  if (!SR) {
    $('#voiceHint').textContent = 'Speech recognition not supported';
    return;
  }
  voiceRec = new SR();
  voiceRec.lang = navigator.language || 'en-US';
  voiceRec.continuous = true;
  voiceRec.interimResults = true;
  voiceRec.onresult = async e => {
    const last = e.results[e.results.length - 1];
    if (!last.isFinal) { $('#voiceHint').textContent = last[0].transcript; return; }
    const text = last[0].transcript.trim();
    if (!text) return;
    $('#voiceHint').textContent = 'Thinking…';
    stopVoiceSession(false);
    $('#input').value = text;
    await send();
  };
  voiceRec.onerror = () => { $('#voiceHint').textContent = 'Could not hear you — try again'; };
  voiceRec.start();
}
function stopVoiceSession(hide = true) {
  try { voiceRec?.stop(); } catch {}
  voiceRec = null;
  if (hide) $('#voiceView').classList.add('hidden');
}

/* Settings */
function openSettings(tab) {
  $('#apiKey').value = apiKey;
  $('#baseUrl').value = baseUrl;
  $('#setName').textContent = prefs.cuName || 'Guest';
  $('#setPlan').textContent = apiKey ? 'API connected' : 'Demo mode';
  buildAppearance();
  buildCustomize();
  switchSetTab(tab || 'account');
  $('#dlgSettings').showModal();
}
function switchSetTab(tab) {
  $$('.set-tab[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.set-panel').forEach(s => s.classList.toggle('active', s.dataset.panel === tab));
  if (tab === 'usage') buildUsage();
}
$$('.set-tab[data-tab]').forEach(b => b.onclick = () => switchSetTab(b.dataset.tab));
$('#btnSettings').onclick = () => openSettings('account');
$('#dlgClose').onclick = () => $('#dlgSettings').close();

$('#btnSaveKey').onclick = () => {
  apiKey = $('#apiKey').value.trim();
  baseUrl = $('#baseUrl').value.trim();
  localStorage.setItem('acs.apiKey', apiKey);
  localStorage.setItem('acs.baseUrl', baseUrl);
  updateUserCard();
  $('#setPlan').textContent = apiKey ? 'API connected' : 'Demo mode';
  alert(apiKey ? 'Saved' : 'Cleared — demo mode');
};
function updateUserCard() {
  $('#userPlan').textContent = prefs.cuName || (apiKey ? 'Grok' : 'Guest');
  $('#userSub').textContent = apiKey ? 'API connected' : 'Demo mode · Settings';
}

function syncSeg(seg, val) {
  seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === val));
}
function buildAppearance() {
  const seg = $('#segTheme');
  syncSeg(seg, prefs.themeChoice);
  seg.querySelectorAll('button').forEach(b => b.onclick = () => {
    prefs.themeChoice = b.dataset.v; savePrefs(); syncSeg(seg, b.dataset.v);
    applyMode(resolveMode(b.dataset.v));
  });
}
function buildCustomize() {
  renderStyleList();
  $('#cuName').value = prefs.cuName || '';
  $('#cuJob').value = prefs.cuJob || '';
  $('#cuAbout').value = prefs.cuAbout || '';
  $('#cuMemory').checked = !!prefs.cuMemory;
  const bind = (id, key) => $(id).oninput = () => {
    prefs[key] = $(id).value; savePrefs(); updateUserCard(); renderModeMenu();
  };
  bind('#cuName', 'cuName'); bind('#cuJob', 'cuJob'); bind('#cuAbout', 'cuAbout');
  $('#cuMemory').onchange = () => { prefs.cuMemory = $('#cuMemory').checked; savePrefs(); };
  const box = $('#cuTraits'); box.innerHTML = '';
  TRAITS.forEach(t => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gcu-chip' + (prefs.cuTraits.includes(t) ? ' sel' : '');
    b.textContent = t;
    b.onclick = () => {
      const i = prefs.cuTraits.indexOf(t);
      i >= 0 ? prefs.cuTraits.splice(i, 1) : prefs.cuTraits.push(t);
      savePrefs(); b.classList.toggle('sel'); renderModeMenu();
    };
    box.append(b);
  });
  renderAgentLibrary();
  refreshMemUI();
}

function renderStyleList() {
  const list = $('#styleList');
  if (!list) return;
  list.innerHTML = '';
  RESPONSE_STYLES.forEach(s => {
    const on = prefs.cuStyle === s.id;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'gcu-style' + (on ? ' sel' : '');
    row.setAttribute('role', 'radio');
    row.setAttribute('aria-checked', on ? 'true' : 'false');
    row.innerHTML = `
      <span class="gcu-radio" aria-hidden="true"></span>
      <span class="gcu-style-text">
        <span class="gcu-style-name">${s.name}</span>
        <span class="gcu-style-desc">${esc(s.desc)}</span>
      </span>`;
    row.onclick = () => {
      prefs.cuStyle = s.id;
      savePrefs();
      renderStyleList();
      renderModeMenu();
      if (s.id === 'custom') {
        const ta = $('#cuStyleCustom');
        if (ta) ta.focus();
      }
    };
    list.append(row);

    /* Custom: instructions box expands under Custom row */
    if (s.id === 'custom' && on) {
      const box = document.createElement('div');
      box.className = 'gcu-custom';
      box.innerHTML = `
        <textarea id="cuStyleCustom" rows="5" maxlength="4000"
          placeholder="Respond briefly and directly, using as few words as possible. Focus on the core point without elaboration or follow-up questions."></textarea>
        <div class="gcu-char" id="cuStyleCount">0 / 4000</div>`;
      list.append(box);
      const ta = box.querySelector('#cuStyleCustom');
      ta.value = prefs.cuStyleCustom || '';
      const count = box.querySelector('#cuStyleCount');
      const sync = () => {
        prefs.cuStyleCustom = ta.value;
        count.textContent = `${ta.value.length} / 4000`;
        savePrefs();
        renderModeMenu();
      };
      count.textContent = `${ta.value.length} / 4000`;
      ta.oninput = sync;
    }
  });
}

/* Your Agents — list rows (grok.com) */
function renderAgentLibrary() {
  const box = $('#agentLibrary');
  if (!box) return;
  const agents = prefs.agents || [];
  if (!agents.length) {
    box.innerHTML = '<div class="gcu-agents-empty">No agents yet</div>';
    return;
  }
  box.innerHTML = '';
  agents.forEach((a, i) => {
    const initials = (a.name || 'A').trim().slice(0, 1).toUpperCase();
    const preview = (a.sys || 'No instructions').replace(/\s+/g, ' ').slice(0, 90);
    const row = document.createElement('div');
    row.className = 'gcu-agent';
    row.innerHTML = `
      <span class="gcu-agent-av">${esc(initials)}</span>
      <div class="gcu-agent-meta">
        <div class="gcu-agent-name">${esc(a.name || 'Untitled')}</div>
        <div class="gcu-agent-desc">${esc(preview)}</div>
      </div>
      <div class="gcu-agent-ops">
        <button type="button" data-a="edit" title="Edit">${icon('pen-square')}</button>
        <button type="button" data-a="del" title="Delete">${icon('trash-2')}</button>
      </div>`;
    row.querySelector('[data-a=edit]').onclick = e => { e.stopPropagation(); openAgentEdit(i); };
    row.querySelector('[data-a=del]').onclick = e => {
      e.stopPropagation();
      if (!confirm(`Delete “${a.name || 'Untitled'}”?`)) return;
      prefs.agents.splice(i, 1);
      savePrefs();
      renderAgentLibrary();
      renderModeMenu();
    };
    row.onclick = () => openAgentEdit(i);
    box.append(row);
  });
}

let editingAgentIdx = null;
function openAgentEdit(idx) {
  editingAgentIdx = idx;
  const isNew = idx == null || idx < 0;
  $('#agentEditTitle').textContent = isNew ? 'Create agent' : 'Edit agent';
  if (isNew) {
    $('#aeName').value = '';
    $('#aeSys').value = '';
  } else {
    const a = prefs.agents[idx];
    $('#aeName').value = a?.name || '';
    $('#aeSys').value = a?.sys || '';
  }
  $('#dlgAgentEdit').showModal();
  $('#aeName').focus();
}
$('#btnAddAgent').onclick = () => {
  if ((prefs.agents || []).length >= 4) return alert('Grok allows up to 4 agents');
  openAgentEdit(null);
};
$('#aeCancel').onclick = () => $('#dlgAgentEdit').close();
$('#aeSave').onclick = () => {
  const name = $('#aeName').value.trim();
  const sys = $('#aeSys').value.trim();
  if (!name) return alert('Name is required');
  if (!prefs.agents) prefs.agents = [];
  if (editingAgentIdx == null) {
    prefs.agents.push({ id: 'a' + Date.now(), name, sys });
  } else {
    prefs.agents[editingAgentIdx] = { ...prefs.agents[editingAgentIdx], name, sys };
  }
  savePrefs();
  $('#dlgAgentEdit').close();
  renderAgentLibrary();
  renderModeMenu();
};
function getMemoryList() {
  if (prefs.memories?.length) return prefs.memories.map(String);
  if (prefs.cuMemory) {
    return convs.filter(c => !c.private && c.title).slice(0, 12).map(c => c.title);
  }
  return [];
}
function refreshMemUI() {
  const items = getMemoryList();
  const el = $('#memCount');
  if (el) {
    el.textContent = items.length
      ? `${items.length} memor${items.length === 1 ? 'y' : 'ies'} from recent chats`
      : 'No memories yet';
  }
  const list = $('#memList');
  if (!list || list.classList.contains('hidden')) return;
  list.innerHTML = items.length
    ? ''
    : '<p class="hint">No memories yet. Turn on Memory and chat to build context.</p>';
  items.forEach((text, i) => {
    const d = document.createElement('div');
    d.className = 'mem-item';
    d.innerHTML = `<div><b>${esc(text)}</b>Saved memory</div>
      <button type="button" title="Remove">${icon('x')}</button>`;
    d.querySelector('button').onclick = () => {
      prefs.memories = items.filter((_, j) => j !== i);
      savePrefs();
      refreshMemUI();
    };
    list.append(d);
  });
}
$('#btnManageMem').onclick = () => {
  const list = $('#memList');
  list.classList.toggle('hidden');
  if (!list.classList.contains('hidden')) {
    if (!prefs.memories.length) {
      prefs.memories = convs.filter(c => !c.private && c.title).slice(0, 12).map(c => c.title);
      savePrefs();
    }
    refreshMemUI();
  }
};
function buildCustomSystem() {
  const parts = [];
  /* 1) 回应方式 */
  const sp = stylePrompt();
  if (sp) parts.push(sp);
  /* 2) 关于你 */
  if (prefs.cuName) parts.push(`Call the user "${prefs.cuName}".`);
  if (prefs.cuJob) parts.push(`The user is: ${prefs.cuJob}.`);
  if (prefs.cuAbout) parts.push(`About the user: ${prefs.cuAbout}`);
  if (prefs.cuTraits?.length) parts.push(`Traits: ${prefs.cuTraits.join('; ')}.`);
  /* 3) 记忆 */
  if (prefs.cuMemory) {
    const mems = (prefs.memories && prefs.memories.length)
      ? prefs.memories
      : convs.filter(c => c.id !== curId && c.title).slice(0, 6).map(c => c.title);
    if (mems.length) parts.push(`Known context / memories: ${mems.join('; ')}.`);
  }
  return parts.join('\n');
}

/* ── Usage (SVG charts, no deps) ── */
function tokenEst(str) {
  let en = 0, cn = 0;
  for (const ch of str || '') (/[一-龥]/.test(ch) ? cn++ : en++);
  return Math.round(cn / 1.5 + en / 4);
}
function buildUsage() {
  let totalMsg = 0, tokIn = 0, tokOut = 0;
  const byMode = {}, byDay = {};
  convs.forEach(c => {
    c.messages.forEach(m => {
      totalMsg++;
      const t = tokenEst(m.content);
      if (m.role === 'user') tokIn += t;
      else { tokOut += t; const mm = c.mode || 'Auto'; byMode[mm] = (byMode[mm] || 0) + t; }
    });
    const day = new Date(+c.id).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + c.messages.length;
  });
  const stat = (label, val, ic) => `<div class="usage-card">${icon(ic)}
    <div class="usage-val">${val}</div><div class="usage-lbl">${label}</div></div>`;
  $('#usageStats').innerHTML =
    stat('Chats', convs.length, 'message-square') +
    stat('Messages', totalMsg, 'sparkles') +
    stat('Input tokens', tokIn.toLocaleString(), 'upload') +
    stat('Output tokens', tokOut.toLocaleString(), 'download');

  /* Bar chart: last 14 days */
  const days = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10)); }
  const vals = days.map(d => byDay[d] || 0);
  const vmax = Math.max(1, ...vals);
  const W = 560, H = 180, PB = 24, PL = 30, bw = (W - PL - 10) / 14;
  let bars = '', grid = '', labels = '';
  for (let i = 0; i <= 3; i++) {
    const y = 10 + (H - PB - 10) * i / 3, v = Math.round(vmax * (3 - i) / 3);
    grid += `<line x1="${PL}" y1="${y}" x2="${W - 6}" y2="${y}" class="cg-line"/>
      <text x="${PL - 6}" y="${y + 4}" class="cg-ytick">${v}</text>`;
  }
  days.forEach((d, i) => {
    const h = Math.max(vals[i] ? 4 : 0, (H - PB - 10) * vals[i] / vmax);
    const x = PL + i * bw + bw * 0.18, y = H - PB - h;
    bars += `<rect x="${x}" y="${y}" width="${bw * 0.64}" height="${h}" rx="4" class="cg-bar${vals[i] ? '' : ' zero'}">
      <title>${d}: ${vals[i]} messages</title></rect>`;
    if (i % 2 === 1) labels += `<text x="${PL + i * bw + bw / 2}" y="${H - 7}" class="cg-xtick">${d.slice(5).replace('-', '/')}</text>`;
  });
  $('#usageChart').innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${grid}${bars}${labels}</svg>`;

  /* Donut: tokens by mode */
  const entries = Object.entries(byMode).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (!total) { $('#usageDonut').innerHTML = ''; $('#usageLegend').innerHTML = '<p class="hint">No data yet</p>'; return; }
  const COLORS = ['#1d9bf0', '#8b7cf0', '#10a37f', '#f59e0b', '#e0245e', '#71767b'];
  const R = 56, CX = 70, CY = 70, SW = 22, CIRC = 2 * Math.PI * R;
  let off = 0, segs = '', legend = '';
  entries.forEach(([name, v], i) => {
    const frac = v / total, len = frac * CIRC, color = COLORS[i % COLORS.length];
    segs += `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${color}" stroke-width="${SW}"
      stroke-dasharray="${Math.max(0, len - 2)} ${CIRC - len + 2}" stroke-dashoffset="${-off}"
      transform="rotate(-90 ${CX} ${CY})"><title>${name}: ${Math.round(frac * 100)}%</title></circle>`;
    off += len;
    legend += `<div class="lg-item"><i style="background:${color}"></i>
      <span class="lg-name">${esc(name)}</span>
      <span class="lg-val">${v.toLocaleString()} · ${Math.round(frac * 100)}%</span></div>`;
  });
  $('#usageDonut').innerHTML = `<svg viewBox="0 0 140 140">${segs}
    <text x="${CX}" y="${CY - 4}" class="dn-total">${total > 9999 ? (total / 1000).toFixed(1) + 'k' : total}</text>
    <text x="${CX}" y="${CY + 14}" class="dn-sub">tokens</text></svg>`;
  $('#usageLegend').innerHTML = legend;
}

/* ── Share chat ── */
$('#btnShare').onclick = async () => {
  const c = cur();
  if (!c || !c.messages.length) return alert('Nothing to share yet.');
  if (c.private) return alert('Private chats cannot be shared.');
  const btn = $('#btnShare');
  btn.disabled = true;
  try {
    const resp = await fetch('/api/share', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: c.title || 'Shared chat',
        messages: c.messages.map(({ role, content }) => ({ role, content })) }) });
    const j = await resp.json();
    if (!j.id) throw new Error(j.error || 'share failed');
    const url = location.origin + '/s/' + j.id;
    await navigator.clipboard.writeText(url).catch(() => {});
    prompt('Share link (copied to clipboard):', url);
  } catch (e) { alert('Share failed: ' + e.message); }
  finally { btn.disabled = false; }
};

/* Data */
function downloadFile(name, content) {
  const blob = new Blob([content], { type: 'application/octet-stream' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  a.click(); URL.revokeObjectURL(a.href);
}
$('#btnExport').onclick = () => {
  const dump = {};
  for (const k of Object.keys(localStorage)) if (k.startsWith('acs.')) dump[k] = localStorage[k];
  downloadFile('grok-backup-' + Date.now() + '.json',
    JSON.stringify({ _app: 'Grok', _date: new Date().toISOString(), data: dump }, null, 2));
};
$('#btnImport').onclick = () => $('#importFile').click();
$('#importFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const j = JSON.parse(r.result); const d = j.data || j;
      if (!confirm('Import will overwrite current data. Continue?')) return;
      Object.keys(d).forEach(k => { if (k.startsWith('acs.')) localStorage[k] = d[k]; });
      location.reload();
    } catch { alert('Invalid file'); }
  };
  r.readAsText(f); e.target.value = '';
};
$('#btnClearChats').onclick = () => {
  if (!confirm('Delete all conversations?')) return;
  convs = []; curId = null; save(); renderConvs(); renderChat();
};
$('#btnResetAll').onclick = () => {
  if (!confirm('Reset everything? This cannot be undone.')) return;
  Object.keys(localStorage).filter(k => k.startsWith('acs.')).forEach(k => localStorage.removeItem(k));
  location.reload();
};

/* Init */
function injectIcons(root = document) {
  root.querySelectorAll('[data-ic]').forEach(el => {
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.ic));
    el.removeAttribute('data-ic');
  });
}
injectIcons();
applyPrefs();
setMode(modeSel);
renderConvs();
renderChat();
updateUserCard();
renderChipBar();
updateConnBanner();
updateSendState();

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (prefs.themeChoice === 'system') applyMode(resolveMode('system'));
});

const TITLES = [
  'What do you want to know?',
  'How can I help you today?',
  'Ask anything',
];
if (!cur()?.messages?.length) {
  $('#wTitle').textContent = TITLES[Math.floor(Math.random() * TITLES.length)];
}
