/* ═══════════ AI Chat Studio 前端逻辑 ═══════════ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ---------- Grok 模式选择(Auto / Fast / Expert / Heavy) ---------- */
const MODES = [
  { id:'auto',  name:'Auto',  desc:'自动选择最佳模型', model:'grok-4',       ic:'sparkles' },
  { id:'fast',  name:'Fast',  desc:'最快响应,日常问答', model:'grok-3-mini', ic:'zap' },
  { id:'expert',name:'Expert',desc:'深度推理,复杂问题', model:'grok-4',      ic:'brain', think:true },
  { id:'heavy', name:'Heavy', desc:'多智能体并行协作',  model:'grok-4-heavy', ic:'blocks' },
];
let modeSel = localStorage.getItem('acs.modeSel') || 'auto';
const curMode = () => MODES.find(m => m.id === modeSel) || MODES[0];
/* 供多厂商 API 配置使用的模型映射(切到 Claude/OpenAI 配置时自动换模型) */
const MODE_MODEL = {
  xai:       { auto:'grok-4', fast:'grok-3-mini', expert:'grok-4', heavy:'grok-4-heavy' },
  anthropic: { auto:'claude-sonnet-4-20250514', fast:'claude-3-5-haiku-20241022',
               expert:'claude-opus-4-20250514', heavy:'claude-opus-4-20250514' },
  openai:    { auto:'gpt-4o', fast:'o4-mini', expert:'o3', heavy:'o3' },
};
const findModel = id => ({ id, name: id, provider: 'xai' });   // 兼容旧引用

/* ---------- 状态 ---------- */
let convs = JSON.parse(localStorage.getItem('acs.convs') || '[]');
let curId = localStorage.getItem('acs.cur') || null;
let mode = localStorage.getItem('acs.mode') ||
  (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
/* API 配置(CC-Switch 式多套切换) */
let profiles = JSON.parse(localStorage.getItem('acs.profiles') || '[]');
let activePf = localStorage.getItem('acs.activePf') || '';
/* 从旧版三键存储自动迁移 */
(() => {
  const old = JSON.parse(localStorage.getItem('acs.keys') || '{}');
  if (!profiles.length && (old.anthropic || old.openai || old.xai)) {
    const names = { anthropic:'Claude 官方', openai:'OpenAI 官方', xai:'xAI 官方' };
    for (const t of ['anthropic','openai','xai']) if (old[t])
      profiles.push({ id: 'mig-'+t, name: names[t], type: t, baseUrl: old.baseUrl || '', apiKey: old[t] });
    if (profiles[0]) activePf = profiles[0].id;
    localStorage.setItem('acs.profiles', JSON.stringify(profiles));
    localStorage.setItem('acs.activePf', activePf);
    localStorage.removeItem('acs.keys');
  }
})();
const activeProfile = () => profiles.find(p => p.id === activePf) || null;
let model = null, attachments = [], streaming = false, abortCtl = null;
const features = { search:false, research:false, think:false, imagine:false };

/* ---------- 技能(预设智能体) ---------- */
const SKILLS = [
  { id:'coder',    ic:'code-2',        name:'代码专家',  desc:'编写、审查与调试代码',
    sys:'你是资深软件工程师。给出可运行的代码,解释关键决策,主动指出边界情况与潜在 bug,遵循最佳实践。' },
  { id:'writer',   ic:'pen-tool',      name:'写作助手',  desc:'文案、文章与润色',
    sys:'你是专业中文写作助手。行文流畅自然,结构清晰,根据场景把握语气,主动给出 2-3 个可选表达。' },
  { id:'tutor',    ic:'graduation-cap',name:'耐心导师',  desc:'循序渐进讲解概念',
    sys:'你是耐心的导师。用类比和示例由浅入深讲解,每讲完一个要点确认理解后再继续,鼓励提问。' },
  { id:'translator',ic:'languages',    name:'翻译官',    desc:'中英互译与本地化',
    sys:'你是专业翻译。保持原意与语气,给出地道译文;术语附原文,必要时提供直译/意译两个版本。' },
  { id:'analyst',  ic:'chart-column',  name:'数据分析师',desc:'数据洞察与图表建议',
    sys:'你是数据分析师。用结构化方式分析数据,指出趋势、异常与相关性,给出可视化建议与下一步行动。' },
  { id:'lawyer',   ic:'scale',         name:'法律顾问',  desc:'法律条文与合同解读',
    sys:'你是法律顾问。解读条文与合同要点,标注风险等级,提醒这不构成正式法律意见,建议必要时咨询执业律师。' },
  { id:'pm',       ic:'briefcase',     name:'产品经理',  desc:'需求梳理与 PRD',
    sys:'你是资深产品经理。用用户故事拆解需求,输出结构化 PRD 要点,主动质疑伪需求,关注优先级与 ROI。' },
  { id:'doctor',   ic:'heart-pulse',   name:'健康参谋',  desc:'健康知识与生活建议',
    sys:'你是健康知识助手。提供循证的健康信息与生活建议,明确说明不能替代医生诊断,紧急情况建议就医。' },
];
let activeSkill = localStorage.getItem('acs.skill') || '';

/* ---------- 连接器(第三方数据源,演示模拟) ---------- */
const CONNECTORS = [
  { id:'github',  ic:'github',     name:'GitHub',       desc:'仓库、Issue 与 PR' },
  { id:'gdrive',  ic:'hard-drive', name:'Google Drive', desc:'文档与表格' },
  { id:'gmail',   ic:'mail',       name:'Gmail',        desc:'邮件搜索与摘要' },
  { id:'calendar',ic:'calendar',   name:'日历',          desc:'日程查询与安排' },
  { id:'notion',  ic:'book-open',  name:'Notion',       desc:'页面与数据库' },
  { id:'x',       ic:'link-2',     name:'X (Twitter)',  desc:'实时帖子与趋势' },
];
let connectedIds = JSON.parse(localStorage.getItem('acs.connectors') || '[]');

/* ---------- 项目(文件夹式组织对话) ---------- */
let projects = JSON.parse(localStorage.getItem('acs.projects') || '[]');
let activeProj = '';   // 当前筛选的项目 id,空 = 全部
const saveProjects = () => localStorage.setItem('acs.projects', JSON.stringify(projects));

/* ---------- 偏好设置(外观 / 行为 / Customize) ---------- */
const DEFAULT_PREFS = {
  themeChoice:'dark', accent:'#1d9bf0', fontSize:'md', density:'cozy',
  cmdEnter:false, stream:true, autoScroll:true, showChips:true, confirmDel:false,
  defaultMode:'', cuEnabled:false, cuMemory:false, cuName:'', cuJob:'', cuAbout:'', cuSystem:'', cuTraits:[],
};
let prefs = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem('acs.prefs') || '{}') };
const savePrefs = () => localStorage.setItem('acs.prefs', JSON.stringify(prefs));
const ACCENTS = ['#8b7cf0','#1d9bf0','#10a37f','#d97757','#e0245e','#f59e0b','#6366f1','#111111'];
const TRAITS = ['专业严谨','简洁直接','友好亲切','幽默风趣','鼓励式','循循善诱','批判思维','富有创意'];

const save = () => { localStorage.setItem('acs.convs', JSON.stringify(convs));
                     localStorage.setItem('acs.cur', curId || ''); };
const cur = () => convs.find(c => c.id === curId);
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

/* ---------- Markdown 渲染(marked + 降级) ---------- */
function md(text) {
  if (window.marked) return marked.parse(text, { breaks:true, mangle:false, headerIds:false });
  return '<p>' + esc(text).replace(/\n/g,'<br>') + '</p>';   // CDN 失败降级
}
function renderBubble(el, text, done) {
  el.innerHTML = md(text);
  el.querySelectorAll('pre').forEach(pre => {
    const code = pre.querySelector('code'); if (!code) return;
    const lang = (code.className.match(/language-(\w+)/) || [,'code'])[1];
    const wrap = document.createElement('div'); wrap.className = 'codeblock';
    const head = document.createElement('div'); head.className = 'codehead';
    head.innerHTML = `<span>${lang}</span><div class="cbtns">
      <button data-act="copy">${icon('copy')} 复制</button>
      ${/^(html|svg|xml)$/.test(lang) || /<html|<!DOCTYPE/i.test(code.textContent)
        ? `<button data-act="preview">${icon('wand-2')} 预览</button>` : ''}</div>`;
    pre.replaceWith(wrap); wrap.append(head, pre);
    const cp = head.querySelector('[data-act=copy]');
    cp.onclick = () => {
      navigator.clipboard.writeText(code.textContent);
      cp.innerHTML = '✓ 已复制'; setTimeout(() => cp.innerHTML = `${icon('copy')} 复制`, 1200);
    };
    const pv = head.querySelector('[data-act=preview]');
    if (pv) pv.onclick = () => openArtifact(code.textContent);
  });
  el.classList.toggle('cursor', !done);
}

/* ---------- 会话列表 ---------- */
/* ---------- 会话列表(搜索 + 置顶 + 按时间分组) ---------- */
let convFilter = '';
function groupLabel(ts) {
  const d = new Date(+ts), now = new Date();
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= day0) return '今天';
  if (d.getTime() >= day0 - 864e5) return '昨天';
  if (d.getTime() >= day0 - 7 * 864e5) return '近 7 天';
  if (d.getTime() >= day0 - 30 * 864e5) return '近 30 天';
  return '更早';
}
function renderConvs() {
  const list = $('#convList'); list.innerHTML = '';
  let items = convs.filter(c => !convFilter ||
    (c.title || '').toLowerCase().includes(convFilter) ||
    c.messages.some(m => (m.content || '').toLowerCase().includes(convFilter)));
  $('#convEmpty').classList.toggle('hidden', !!items.length);
  $('#convEmpty').textContent = convFilter ? '没有匹配的对话' : '暂无对话,点击「新对话」开始';

  /* 项目筛选:激活时列表顶部显示项目头 */
  if (activeProj) {
    const p = projects.find(x => x.id === activeProj);
    if (p) {
      items = items.filter(c => c.proj === activeProj);
      const head = document.createElement('div'); head.className = 'proj-head';
      head.innerHTML = `${icon('folder')}<b>${esc(p.name)}</b><span>${items.length} 个对话</span>
        <button title="退出项目视图">${icon('x')}</button>`;
      head.querySelector('button').onclick = () => { activeProj = ''; renderConvs(); };
      list.append(head);
      $('#convEmpty').classList.toggle('hidden', !!items.length);
      $('#convEmpty').textContent = '该项目还没有对话';
    } else activeProj = '';
  }

  const pinned = items.filter(c => c.pin);
  const rest = items.filter(c => !c.pin);
  const addGroup = (label, arr) => {
    if (!arr.length) return;
    const h = document.createElement('div'); h.className = 'conv-group'; h.textContent = label;
    list.append(h); arr.forEach(c => list.append(convItemEl(c)));
  };
  addGroup('📌 已置顶', pinned);
  let lastLabel = null, bucket = [];
  rest.forEach(c => {
    const l = groupLabel(c.id);
    if (l !== lastLabel) { addGroup(lastLabel, bucket); lastLabel = l; bucket = []; }
    bucket.push(c);
  });
  addGroup(lastLabel, bucket);
}
function convItemEl(c) {
  const div = document.createElement('div');
  div.className = 'conv-item' + (c.id === curId ? ' active' : '');
  const projTag = c.proj && !activeProj
    ? `<span class="conv-proj">${esc((projects.find(p => p.id === c.proj) || {}).name || '')}</span>` : '';
  div.innerHTML = `<span class="conv-ic">${icon('message-square')}</span>
    <span class="conv-title">${esc(c.title || '新对话')}${projTag}</span>
    <span class="conv-ops">
      <button data-op="pin" title="${c.pin ? '取消置顶' : '置顶'}">${icon('pin')}</button>
      <button data-op="proj" title="移入项目">${icon('folder')}</button>
      <button data-op="rename" title="重命名">${icon('pen-square')}</button>
      <button data-op="del" title="删除">${icon('trash-2')}</button>
    </span>`;
  div.onclick = () => { curId = c.id; save(); renderConvs(); renderChat(); };
  div.querySelector('[data-op=pin]').onclick = e => { e.stopPropagation();
    c.pin = !c.pin; save(); renderConvs(); };
  div.querySelector('[data-op=proj]').onclick = e => { e.stopPropagation(); assignProj(c); };
  div.querySelector('[data-op=rename]').onclick = e => { e.stopPropagation();
    const t = prompt('重命名对话', c.title || '新对话');
    if (t !== null) { c.title = t.trim() || c.title; save(); renderConvs(); } };
  div.querySelector('[data-op=del]').onclick = e => { e.stopPropagation();
    if (prefs.confirmDel && !confirm('确定删除这个对话?')) return;
    convs = convs.filter(x => x.id !== c.id);
    if (curId === c.id) curId = convs[0]?.id || null;
    save(); renderConvs(); renderChat(); };
  return div;
}
/* 移入项目:数字选择,0 移出 */
function assignProj(c) {
  if (!projects.length) {
    const name = prompt('还没有项目,输入名称创建第一个项目:');
    if (!name?.trim()) return;
    projects.push({ id:'pj-' + Date.now(), name: name.trim() }); saveProjects();
  }
  const menu = projects.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
  const ans = prompt(`把「${c.title || '新对话'}」移入哪个项目?\n\n${menu}\n\n输入编号(0 = 移出项目):`);
  if (ans === null) return;
  const n = parseInt(ans);
  if (n === 0) delete c.proj;
  else if (projects[n - 1]) c.proj = projects[n - 1].id;
  save(); renderConvs();
}

/* ---------- 聊天渲染 ---------- */
function renderChat() {
  const c = cur(), chat = $('#chat');
  chat.innerHTML = '';
  $('#welcome').style.display = (!c || !c.messages.length) ? '' : 'none';
  $('.chips').style.display = prefs.showChips === false ? 'none' : '';
  if (!c) return;
  c.messages.forEach(m => chat.append(msgEl(m)));
  scrollBottom();
}
function msgEl(m) {
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
    if (m.steps?.length || m.agents?.length) {
      if (m.steps?.length)  bubble.append(dsPanelEl(m.steps, true, m.stepsElapsed).panel);
      if (m.agents?.length) bubble.append(agentGridEl(m.agents, true).grid);
      const fin = document.createElement('div');
      renderBubble(fin, m.content, true); bubble.append(fin);
    } else {
      renderBubble(bubble, m.content, true);
    }
    /* Imagine 生成结果:图片九宫格 */
    if (m.gen) {
      const g = document.createElement('div'); g.className = 'gen-grid';
      if (m.gen.loading) {
        g.innerHTML = [0,1,2,3].map(() => `<div class="img-cell loading r1x1"><span class="ds-spin"></span></div>`).join('');
      } else {
        m.gen.images.forEach(u => {
          const cell = document.createElement('div'); cell.className = 'img-cell r1x1';
          cell.innerHTML = `<img src="${u}" alt="${esc(m.gen.prompt)}" loading="lazy">
            <div class="img-acts"><button data-a="dl" title="下载">${icon('download')}</button></div>`;
          cell.querySelector('[data-a=dl]').onclick = () => {
            const a = document.createElement('a'); a.href = u; a.download = 'imagine.png'; a.click(); };
          g.append(cell);
        });
      }
      bubble.append(g);
    }
    /* 消息操作栏(复制 / 重新生成)*/
    if (m.content) {
      const acts = document.createElement('div'); acts.className = 'msg-acts';
      acts.innerHTML = `<button data-a="copy" title="复制">${icon('copy')}</button>
        <button data-a="regen" title="重新生成">${icon('refresh-cw')}</button>`;
      const cp = acts.querySelector('[data-a=copy]');
      cp.onclick = () => { navigator.clipboard.writeText(m.content);
        cp.innerHTML = '✓'; setTimeout(() => cp.innerHTML = icon('copy'), 1200); };
      acts.querySelector('[data-a=regen]').onclick = () => regenerate();
      bubble.append(acts);
    }
    div.append(av, bubble);
  }
  return div;
}

/* 搜索/研究过程面板 */
function dsPanelEl(steps, done, elapsed) {
  const label = features.research ? 'DeeperSearch' : 'DeepSearch';
  const panel = document.createElement('div');
  panel.className = 'ds-panel' + (done ? ' done' : '');
  panel.innerHTML = `<div class="ds-head"><span class="ds-spin"></span><b>${label}</b>
    <span class="ds-time">${done ? esc(elapsed || '已完成') : '进行中…'}</span><span class="ds-caret">${icon('chevron-down')}</span></div>
    <div class="ds-steps"></div>`;
  const list = panel.querySelector('.ds-steps');
  const add = s => { const d = document.createElement('div'); d.className = 'ds-step';
    d.textContent = s; list.append(d); };
  steps.forEach(add);
  if (done) panel.classList.add('collapsed');
  panel.querySelector('.ds-head').onclick = () => panel.classList.toggle('collapsed');
  return { panel, add,
    finish: t => { panel.classList.add('done');
      panel.querySelector('.ds-time').textContent = t || '已完成'; } };
}

/* 多智能体卡片网格 */
function agentGridEl(agents, done) {
  const grid = document.createElement('div'); grid.className = 'agents';
  grid.innerHTML = `<div class="agents-head">👥 多智能体并行协作 · ${agents.length} 个 Agent + 主控汇总</div>`;
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
const scrollBottom = () => { if (prefs.autoScroll !== false) { const s = $('#chatScroll'); s.scrollTop = s.scrollHeight; } };

/* ---------- 发送 & 流式接收 ---------- */
async function send() {
  if (streaming) { abortCtl?.abort(); return; }
  const text = $('#input').value.trim();
  if (!text && !attachments.length) return;
  if (!cur()) { convs.unshift({ id: Date.now() + '', title:'', mode: curMode().name,
    ...(activeProj && { proj: activeProj }), messages: [] }); curId = convs[0].id; }
  cur().mode = curMode().name;   // 记录本次使用的模式(供使用量统计)
  const c = cur();
  /* Imagine 模式:输入即图像 prompt,在对话内生成图片 */
  if (features.imagine && text) {
    c.messages.push({ role:'user', content: text });
    if (!c.title) c.title = '🎨 ' + text.slice(0, 20);
    $('#input').value = ''; $('#input').style.height = 'auto';
    renderConvs(); renderChat();
    return imagineInChat(c, text);
  }
  let content = text;
  attachments.filter(a => a.kind === 'text').forEach(a => {
    content += `\n\n[附件 ${a.name}]:\n\`\`\`\n${a.data.slice(0, 8000)}\n\`\`\``; });
  const images = attachments.filter(a => a.kind === 'image').map(a => a.data);
  const userMsg = { role:'user', content, ...(images.length && { images }) };
  c.messages.push(userMsg);
  if (!c.title) c.title = text.slice(0, 24) || '图片对话';
  $('#input').value = ''; $('#input').style.height = 'auto';
  attachments = []; renderAttach(); renderConvs(); renderChat();
  await streamReply(c);
}

/* 对话内图像生成:AI 消息里放一组图 */
async function imagineInChat(c, prompt) {
  const aiMsg = { role:'assistant', content:'', gen:{ prompt, images:[], loading:true } };
  c.messages.push(aiMsg); renderChat();
  try {
    const j = await callImageAPI(prompt);
    aiMsg.gen.loading = false;
    if (j.error) aiMsg.content = '⚠️ 图像生成失败:' + j.error;
    else { aiMsg.gen.images = j.images || [];
      aiMsg.content = `已根据「${prompt}」生成 ${aiMsg.gen.images.length} 张图像${j.demo ? '(演示占位图,配置 API Key 后生成真实图像)' : ''}:`; }
  } catch (e) { aiMsg.gen.loading = false; aiMsg.content = '⚠️ ' + e.message; }
  save(); renderChat();
}

/* 重新生成:丢弃末尾 AI 回复后重跑 */
async function regenerate() {
  const c = cur(); if (!c || streaming) return;
  while (c.messages.length && c.messages[c.messages.length - 1].role === 'assistant') c.messages.pop();
  if (!c.messages.length) return;
  renderChat();
  await streamReply(c);
}

async function streamReply(c) {
  const aiMsg = { role:'assistant', content:'' };
  c.messages.push(aiMsg);
  const el = msgEl(aiMsg); $('#chat').append(el);
  const bubble = el.querySelector('.bubble'); bubble.classList.add('cursor');
  streaming = true; setSendBtn(true);
  abortCtl = new AbortController();
  let target = bubble, agentUI = null, dsUI = null;
  const prof = activeProfile();          // 当前启用的 API 配置(无则演示模式)
  const provider = prof ? prof.type : 'xai';
  /* Grok 模式 → 按当前接口类型解析实际模型;Expert 自动开启深度思考 */
  const reqModel = (MODE_MODEL[provider] || MODE_MODEL.xai)[modeSel] || 'grok-4';
  const reqFeatures = { ...features, think: features.think || !!curMode().think };

  /* Customize + 技能:拼成 system 消息追加到最前 */
  let outMsgs = c.messages.slice(0, -1).map(({ role, content, images }) => ({ role, content, images }));
  const sysParts = [];
  const skill = SKILLS.find(s => s.id === activeSkill);
  if (skill) sysParts.push(skill.sys);
  const cu = buildCustomSystem(); if (cu) sysParts.push(cu);
  if (connectedIds.length) sysParts.push(`用户已连接的数据源:${connectedIds.map(id =>
    (CONNECTORS.find(x => x.id === id) || {}).name).filter(Boolean).join('、')}(演示环境,如需其数据请说明将模拟)。`);
  if (sysParts.length) outMsgs = [{ role:'system', content: sysParts.join('\n\n') }, ...outMsgs];

  try {
    const resp = await fetch('/api/chat', { method:'POST', signal: abortCtl.signal,
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ provider, model: reqModel, features: reqFeatures,
        apiKey: prof?.apiKey || '', baseUrl: prof?.baseUrl || '',
        messages: outMsgs }) });
    const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream:true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const p = line.slice(6).trim(); if (p === '[DONE]') continue;
        try {
          const j = JSON.parse(p);
          if (j.step) {                         // DeepSearch 过程步骤
            (aiMsg.steps ??= []).push(j.step);
            if (!dsUI) {
              bubble.classList.remove('cursor'); bubble.innerHTML = '';
              dsUI = dsPanelEl([], false);
              bubble.append(dsUI.panel);
              target = document.createElement('div'); bubble.append(target);
            }
            dsUI.add(j.step); scrollBottom();
          } else if (j.stepsDone) {
            aiMsg.stepsElapsed = j.elapsed || '';
            dsUI?.finish(j.elapsed);
          } else if (j.agents) {                // 多智能体启动:构建 Agent 卡片网格
            aiMsg.agents = j.agents.map(n => ({ name: n, content: '' }));
            bubble.classList.remove('cursor'); bubble.innerHTML = '';
            agentUI = agentGridEl(aiMsg.agents, false);
            bubble.append(agentUI.grid);
            target = document.createElement('div'); bubble.append(target);
          } else if (j.agent !== undefined) {   // 子智能体流式输出
            const a = agentUI?.els[j.agent];
            if (a) {
              if (j.done) a.card.classList.add('done');
              else { aiMsg.agents[j.agent].content += j.delta;
                a.body.textContent = aiMsg.agents[j.agent].content;
                a.body.scrollTop = a.body.scrollHeight; }
              scrollBottom();
            }
          } else if (j.delta) {                 // 普通/主控汇总输出
            aiMsg.content += j.delta;
            renderBubble(target, aiMsg.content, false); scrollBottom();
          }
        } catch {}
      }
    }
  } catch (e) { if (e.name !== 'AbortError') aiMsg.content += '\n\n⚠️ 连接失败:' + e.message; }
  if (!aiMsg.content) aiMsg.content = '(已停止)';
  streaming = false; setSendBtn(false); save();
  renderChat();   // 归一化渲染(带操作栏)
}
function setSendBtn(stop) {
  const b = $('#btnSend');
  b.innerHTML = stop ? icon('square') : icon('arrow-up'); b.classList.toggle('stop', stop);
}

/* ---------- Artifacts ---------- */
function openArtifact(code) {
  $('#artifacts').classList.remove('hidden');
  $('#artFrame').srcdoc = code;
  $('#artCode').querySelector('code').textContent = code;
  switchArtTab('preview');
}
function switchArtTab(t) {
  $('#tabPreview').classList.toggle('active', t === 'preview');
  $('#tabCode').classList.toggle('active', t === 'code');
  $('#artFrame').classList.toggle('hidden', t !== 'preview');
  $('#artCode').classList.toggle('hidden', t !== 'code');
}

/* ---------- 附件 ---------- */
function renderAttach() {
  const bar = $('#attachBar');
  bar.classList.toggle('hidden', !attachments.length);
  bar.innerHTML = '';
  attachments.forEach((a, i) => {
    const d = document.createElement('div'); d.className = 'attach-item';
    d.innerHTML = (a.kind === 'image' ? `<img src="${a.data}">` : icon('book-open') + ' ') + `<span>${esc(a.name)}</span>
      <button class="attach-x">${icon('x')}</button>`;
    d.querySelector('.attach-x').onclick = () => { attachments.splice(i, 1); renderAttach(); };
    bar.append(d);
  });
}

/* ---------- 明暗模式 & 模型菜单 ---------- */
function resolveMode(choice) {
  if (choice === 'system') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return choice;
}
function applyMode(m) {
  mode = m; localStorage.setItem('acs.mode', m);
  document.documentElement.dataset.mode = m;
  const btn = $('#btnMode');
  if (btn) { btn.innerHTML = icon(m === 'dark' ? 'sun' : 'moon');
    btn.title = m === 'dark' ? '切换到白天模式' : '切换到黑夜模式'; }
}
/* 应用外观偏好:强调色 / 字号 / 密度 / 主题选择 */
function applyPrefs() {
  const root = document.documentElement;
  root.style.setProperty('--accent', prefs.accent);
  // hover 色:稍微加深
  root.style.setProperty('--accent-hover', shade(prefs.accent, -12));
  root.style.setProperty('--accent-soft', hexA(prefs.accent, .14));
  root.dataset.font = prefs.fontSize;
  root.dataset.density = prefs.density;
  applyMode(resolveMode(prefs.themeChoice));
}
/* 颜色工具 */
function shade(hex, pct) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + Math.round(255 * pct / 100);
  let g = ((n >> 8) & 255) + Math.round(255 * pct / 100);
  let b = (n & 255) + Math.round(255 * pct / 100);
  const cl = x => Math.max(0, Math.min(255, x));
  return '#' + ((cl(r) << 16) | (cl(g) << 8) | cl(b)).toString(16).padStart(6, '0');
}
const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16);
  return `rgba(${n>>16},${(n>>8)&255},${n&255},${a})`; };
function setMode(id) {
  modeSel = MODES.some(m => m.id === id) ? id : 'auto';
  localStorage.setItem('acs.modeSel', modeSel);
  const m = curMode();
  $('#modelName').innerHTML = `${icon(m.ic)} ${m.name}`;
  renderModeMenu();
}
function renderModeMenu() {
  const menu = $('#modelMenu'); menu.innerHTML = '';
  MODES.forEach(m => {
    const d = document.createElement('div');
    d.className = 'model-item mode-item' + (m.id === modeSel ? ' sel' : '');
    d.innerHTML = `<span class="mode-ic">${icon(m.ic)}</span><span>${m.name}<small>${m.desc}</small></span>`;
    d.onclick = () => { setMode(m.id); menu.classList.add('hidden'); };
    menu.append(d);
  });
  const sep = document.createElement('div'); sep.className = 'model-sep'; menu.append(sep);
  const cu = document.createElement('div');
  cu.className = 'model-item mode-item';
  cu.innerHTML = `<span class="mode-ic">${icon('pen-square')}</span><span>自定义指令<small>${prefs.cuEnabled ? '已启用' : '未启用'} · 点击编辑</small></span>`;
  cu.onclick = () => { menu.classList.add('hidden'); openSettings('customize'); };
  menu.append(cu);
}

/* ---------- 事件绑定 ---------- */
$('#btnNew').onclick = () => { curId = null; save(); renderConvs(); renderChat(); $('#input').focus(); };
$('#btnSide').onclick = () => $('#sidebar').classList.toggle('collapsed');
$('#btnCollapse').onclick = () => $('#sidebar').classList.toggle('collapsed');
$('#convSearch').addEventListener('input', e => { convFilter = e.target.value.trim().toLowerCase(); renderConvs(); });
$$('.nav-link').forEach(a => a.onclick = () => {
  const v = a.dataset.view;
  if (v === 'chat') { $$('.nav-link').forEach(x => x.classList.remove('active')); a.classList.add('active'); return; }
  if (v === 'imagine')    return openImagine();
  if (v === 'skills')     { renderSkills(); return $('#dlgSkills').showModal(); }
  if (v === 'connectors') { renderConnectors(); return $('#dlgConnectors').showModal(); }
  if (v === 'projects')   { renderProjects(); return $('#dlgProjects').showModal(); }
});
$('#btnSend').onclick = send;
$('#input').addEventListener('keydown', e => {
  if (e.isComposing) return;
  if (prefs.cmdEnter) {   // Ctrl/⌘+Enter 发送,Enter 换行
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  } else {                // Enter 发送,Shift+Enter 换行
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }
});
$('#input').addEventListener('input', e => {
  e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; });
$('#modelBtn').onclick = e => { e.stopPropagation(); $('#modelMenu').classList.toggle('hidden'); };
document.addEventListener('click', () => $('#modelMenu').classList.add('hidden'));
$('#btnMode').onclick = () => {
  const next = resolveMode(prefs.themeChoice) === 'dark' ? 'light' : 'dark';
  prefs.themeChoice = next; savePrefs(); applyMode(next);
  const seg = $('#segTheme'); if (seg) syncSeg(seg, next);
};
$$('.chip').forEach(b => b.onclick = () => { $('#input').value = b.textContent.trim(); send(); });
['Search','Research','Think','Imagine'].forEach(k => {
  $('#tgl' + k).onclick = e => { features[k.toLowerCase()] = !features[k.toLowerCase()];
    e.currentTarget.classList.toggle('active'); };
});

/* ═══════════ 技能 ═══════════ */
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
      updateSkillBtn(); renderSkills();
    };
    grid.append(d);
  });
}
function updateSkillBtn() {
  const s = SKILLS.find(x => x.id === activeSkill);
  $('#btnSkills').classList.toggle('active', !!s);
  $('#btnSkills').title = s ? `技能:${s.name}(点击更换)` : '技能';
}
$('#btnSkills').onclick = () => { renderSkills(); $('#dlgSkills').showModal(); };

/* ═══════════ 连接器 ═══════════ */
function renderConnectors() {
  const list = $('#connList'); list.innerHTML = '';
  CONNECTORS.forEach(c => {
    const on = connectedIds.includes(c.id);
    const d = document.createElement('div');
    d.className = 'conn-item';
    d.innerHTML = `<span class="conn-ic">${icon(c.ic)}</span>
      <div class="p-info"><div class="p-name">${c.name}</div><div class="p-meta">${c.desc}</div></div>
      <button class="btn-outline conn-btn ${on ? 'on' : ''}">${on ? icon('circle-check') + ' 已连接' : '连接'}</button>`;
    d.querySelector('.conn-btn').onclick = async e => {
      const btn = e.currentTarget;
      if (on) { connectedIds = connectedIds.filter(x => x !== c.id); }
      else {
        btn.textContent = '授权中…';
        await new Promise(r => setTimeout(r, 800));   // 模拟 OAuth 流程
        connectedIds.push(c.id);
      }
      localStorage.setItem('acs.connectors', JSON.stringify(connectedIds));
      renderConnectors();
    };
    list.append(d);
  });
}

/* ═══════════ 项目管理弹窗 ═══════════ */
function renderProjects() {
  const list = $('#projList'); list.innerHTML = '';
  if (!projects.length) list.innerHTML = '<p class="hint">还没有项目,点击下方「新建项目」创建。</p>';
  projects.forEach(p => {
    const count = convs.filter(c => c.proj === p.id).length;
    const d = document.createElement('div');
    d.className = 'conn-item proj-item';
    d.innerHTML = `<span class="conn-ic">${icon('folder')}</span>
      <div class="p-info"><div class="p-name">${esc(p.name)}</div><div class="p-meta">${count} 个对话</div></div>
      <div class="p-acts">
        <button data-a="open" title="查看对话">${icon('message-square')}</button>
        <button data-a="edit" title="重命名">${icon('pen-square')}</button>
        <button data-a="del" title="删除">${icon('trash-2')}</button>
      </div>`;
    d.querySelector('[data-a=open]').onclick = () => {
      activeProj = p.id; renderConvs(); $('#dlgProjects').close();
      $('#sidebar').classList.remove('collapsed');
    };
    d.querySelector('[data-a=edit]').onclick = () => {
      const t = prompt('重命名项目', p.name);
      if (t?.trim()) { p.name = t.trim(); saveProjects(); renderProjects(); renderConvs(); } };
    d.querySelector('[data-a=del]').onclick = () => {
      if (!confirm(`删除项目「${p.name}」?其中的对话不会被删除,只会移出项目。`)) return;
      convs.forEach(c => { if (c.proj === p.id) delete c.proj; });
      projects = projects.filter(x => x.id !== p.id);
      if (activeProj === p.id) activeProj = '';
      saveProjects(); save(); renderProjects(); renderConvs(); };
    list.append(d);
  });
}
$('#btnAddProj').onclick = () => {
  const name = prompt('项目名称:');
  if (!name?.trim()) return;
  projects.push({ id:'pj-' + Date.now(), name: name.trim() });
  saveProjects(); renderProjects();
};

/* ═══════════ Imagine 图像生成 ═══════════ */
let imgRatio = '1:1', imgStyle = 'realistic';
let gallery = JSON.parse(localStorage.getItem('acs.imagine') || '[]');
$('#imgRatio').querySelectorAll('button').forEach(b => b.onclick = () => {
  imgRatio = b.dataset.v; syncSeg($('#imgRatio'), imgRatio); });
$('#imgStyle').querySelectorAll('button').forEach(b => b.onclick = () => {
  imgStyle = b.dataset.v; syncSeg($('#imgStyle'), imgStyle); });
function openImagine() { $('#imagineView').classList.remove('hidden'); renderGallery(); $('#imaginePrompt').focus(); }
$('#imagineClose').onclick = () => $('#imagineView').classList.add('hidden');
$('#imagineGo').onclick = generateImages;
$('#imaginePrompt').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); generateImages(); } });

async function callImageAPI(prompt) {
  const prof = activeProfile();
  const resp = await fetch('/api/image', { method:'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ provider: prof?.type === 'openai' ? 'openai' : 'xai',
      prompt, ratio: imgRatio, style: imgStyle,
      apiKey: prof?.apiKey || '', baseUrl: prof?.imgUrl || '' }) });
  return resp.json();
}
async function generateImages() {
  const prompt = $('#imaginePrompt').value.trim();
  if (!prompt) return;
  const go = $('#imagineGo');
  go.disabled = true; go.innerHTML = icon('sparkles') + ' 生成中…';
  const grid = $('#imagineGrid');
  grid.insertAdjacentHTML('afterbegin',
    [0,1,2,3].map(() => `<div class="img-cell loading r${imgRatio.replace(':','x')}"><span class="ds-spin"></span></div>`).join(''));
  try {
    const j = await callImageAPI(prompt);
    grid.querySelectorAll('.img-cell.loading').forEach(x => x.remove());
    if (j.error) { alert('生成失败:' + j.error); return; }
    (j.images || []).forEach(u => { gallery.unshift({ u, p: prompt, r: imgRatio, t: Date.now() }); });
    gallery = gallery.slice(0, 24);
    localStorage.setItem('acs.imagine', JSON.stringify(gallery));
    renderGallery();
  } finally { go.disabled = false; go.innerHTML = icon('sparkles') + ' 生成(4 张)'; }
}
function renderGallery() {
  const grid = $('#imagineGrid');
  grid.innerHTML = gallery.length ? '' : '<p class="hint" style="grid-column:1/-1;text-align:center;padding:40px">还没有作品,输入描述开始创作 ↑</p>';
  gallery.forEach((g, i) => {
    const d = document.createElement('div');
    d.className = `img-cell r${(g.r || '1:1').replace(':', 'x')}`;
    d.innerHTML = `<img src="${g.u}" alt="${esc(g.p)}" loading="lazy">
      <div class="img-acts"><button data-a="dl" title="下载">${icon('download')}</button>
      <button data-a="del" title="删除">${icon('trash-2')}</button></div>
      <div class="img-cap">${esc(g.p.slice(0, 40))}</div>`;
    d.querySelector('[data-a=dl]').onclick = () => {
      const a = document.createElement('a'); a.href = g.u; a.download = `imagine-${g.t}.png`; a.click(); };
    d.querySelector('[data-a=del]').onclick = () => {
      gallery.splice(i, 1); localStorage.setItem('acs.imagine', JSON.stringify(gallery)); renderGallery(); };
    grid.append(d);
  });
}
/* 弹窗关闭按钮通用绑定 */
$$('[data-close]').forEach(b => b.onclick = () => $('#' + b.dataset.close).close());
$('#btnAttach').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = e => {
  [...e.target.files].forEach(f => {
    const r = new FileReader();
    if (f.type.startsWith('image/')) { r.onload = () => { attachments.push({ kind:'image', name:f.name, data:r.result }); renderAttach(); }; r.readAsDataURL(f); }
    else { r.onload = () => { attachments.push({ kind:'text', name:f.name, data:r.result }); renderAttach(); }; r.readAsText(f); }
  });
  e.target.value = '';
};
$('#btnVoice').onclick = () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return alert('当前浏览器不支持语音识别(需 Chrome/Edge)');
  const rec = new SR(); rec.lang = 'zh-CN'; rec.interimResults = false;
  rec.onresult = e => { $('#input').value += e.results[0][0].transcript; };
  rec.start();
};
$('#btnArtifacts').onclick = () => $('#artifacts').classList.toggle('hidden');
$('#artClose').onclick = () => $('#artifacts').classList.add('hidden');
$('#tabPreview').onclick = () => switchArtTab('preview');
$('#tabCode').onclick = () => switchArtTab('code');
$('#artCopy').onclick = () => navigator.clipboard.writeText($('#artCode').querySelector('code').textContent);

/* ---------- API 配置管理(CC-Switch 式) ---------- */
const TYPE_LABEL = { anthropic:'Anthropic', openai:'OpenAI 兼容', xai:'xAI' };
const OFFICIAL_URL = { anthropic:'api.anthropic.com', openai:'api.openai.com', xai:'api.x.ai' };
let editPfId = null;

function saveProfiles() {
  localStorage.setItem('acs.profiles', JSON.stringify(profiles));
  localStorage.setItem('acs.activePf', activePf);
  updateSettingsBtn();
}
function updateSettingsBtn() {
  const p = activeProfile();
  $('#userPlan').textContent = p ? p.name : '演示模式';
  $('.user-sub').textContent = p ? (TYPE_LABEL[p.type] || p.type) + ' · 已启用' : '点击配置 API';
}
function renderProfiles() {
  const list = $('#profileList'); list.innerHTML = '';
  /* 演示模式项 */
  const demo = document.createElement('div');
  demo.className = 'profile-item' + (activePf ? '' : ' active');
  demo.innerHTML = `<span class="p-radio"></span><div class="p-info">
    <div class="p-name">🎭 演示模式</div><div class="p-meta">不调用真实 API,模拟流式回复</div></div>`;
  demo.onclick = () => { activePf = ''; saveProfiles(); renderProfiles(); };
  list.append(demo);
  profiles.forEach(p => {
    const d = document.createElement('div');
    d.className = 'profile-item' + (p.id === activePf ? ' active' : '');
    d.innerHTML = `<span class="p-radio"></span><div class="p-info">
      <div class="p-name">${esc(p.name)} <span class="p-type">${TYPE_LABEL[p.type] || p.type}</span></div>
      <div class="p-meta">${esc(p.baseUrl || OFFICIAL_URL[p.type] || '')} · ${p.apiKey ? '••••' + esc(p.apiKey.slice(-4)) : '无 Key'}</div></div>
      <div class="p-acts"><button data-a="edit">${icon('pen-square')}</button><button data-a="del">${icon('trash-2')}</button></div>`;
    d.onclick = () => { activePf = p.id; saveProfiles(); renderProfiles(); };
    d.querySelector('[data-a=edit]').onclick = e => { e.stopPropagation(); openPfForm(p); };
    d.querySelector('[data-a=del]').onclick = e => { e.stopPropagation();
      profiles = profiles.filter(x => x.id !== p.id);
      if (activePf === p.id) activePf = '';
      saveProfiles(); renderProfiles(); };
    list.append(d);
  });
}
function openPfForm(p) {
  editPfId = p?.id || null;
  $('#pfName').value = p?.name || ''; $('#pfType').value = p?.type || 'xai';
  $('#pfUrl').value = p?.baseUrl || ''; $('#pfKey').value = p?.apiKey || '';
  $('#profileForm').classList.remove('hidden'); $('#pfName').focus();
}
$('#btnAddProfile').onclick = () => openPfForm(null);
$('#pfCancel').onclick = () => $('#profileForm').classList.add('hidden');
$('#profileForm').onsubmit = e => {
  e.preventDefault();
  const data = { name: $('#pfName').value.trim() || '未命名', type: $('#pfType').value,
                 baseUrl: $('#pfUrl').value.trim(), apiKey: $('#pfKey').value.trim() };
  if (editPfId) Object.assign(profiles.find(x => x.id === editPfId), data);
  else { const id = 'pf-' + Date.now(); profiles.push({ id, ...data }); activePf = id; }
  saveProfiles(); renderProfiles();
  $('#profileForm').classList.add('hidden');
};

/* ═══════════ 账户设置面板(Grok 风格) ═══════════ */
function openSettings(tab) {
  renderProfiles(); $('#profileForm').classList.add('hidden');
  buildAppearance(); buildBehavior(); buildCustomize();
  const p = activeProfile();
  $('#setName').textContent = prefs.cuName || '访客用户';
  $('#setPlan').textContent = p ? p.name : '演示模式';
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

/* 通用:分段控件同步 */
function syncSeg(seg, val) {
  seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === val));
}
function bindSeg(id, key, cb) {
  const seg = $(id); syncSeg(seg, prefs[key]);
  seg.querySelectorAll('button').forEach(b => b.onclick = () => {
    prefs[key] = b.dataset.v; savePrefs(); syncSeg(seg, b.dataset.v); cb && cb(b.dataset.v);
  });
}

/* ── 外观 ── */
function buildAppearance() {
  bindSeg('#segTheme', 'themeChoice', v => applyMode(resolveMode(v)));
  bindSeg('#segFont', 'fontSize', () => applyPrefs());
  bindSeg('#segDensity', 'density', () => applyPrefs());
  const box = $('#accentSwatches'); box.innerHTML = '';
  ACCENTS.forEach(c => {
    const b = document.createElement('button'); b.className = 'swatch' + (c === prefs.accent ? ' sel' : '');
    b.style.background = c; b.title = c;
    b.onclick = () => { prefs.accent = c; savePrefs(); applyPrefs();
      box.querySelectorAll('.swatch').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); };
    box.append(b);
  });
}

/* ── 行为 ── */
function buildBehavior() {
  const sel = $('#setDefaultModel'); sel.innerHTML = '';
  MODES.forEach(m => { const o = document.createElement('option');
    o.value = m.id; o.textContent = `${m.name} · ${m.desc}`; sel.append(o); });
  sel.value = prefs.defaultMode || modeSel;
  sel.onchange = () => { prefs.defaultMode = sel.value; savePrefs(); setMode(sel.value); };
  const toggles = { setCmdEnter:'cmdEnter', setStream:'stream', setAutoScroll:'autoScroll',
                    setChips:'showChips', setConfirmDel:'confirmDel' };
  for (const [id, key] of Object.entries(toggles)) {
    const el = $('#' + id); el.checked = !!prefs[key];
    el.onchange = () => { prefs[key] = el.checked; savePrefs();
      if (key === 'showChips') renderChat(); };
  }
}

/* ── Customize ── */
function buildCustomize() {
  $('#cuName').value = prefs.cuName; $('#cuJob').value = prefs.cuJob;
  $('#cuAbout').value = prefs.cuAbout; $('#cuSystem').value = prefs.cuSystem;
  $('#cuEnabled').checked = !!prefs.cuEnabled;
  $('#cuMemory').checked = !!prefs.cuMemory;
  const syncFields = () => $('#cuFields').classList.toggle('disabled', !prefs.cuEnabled);
  syncFields();
  const bind = (id, key) => $(id).oninput = () => { prefs[key] = $(id).value; savePrefs(); };
  bind('#cuName', 'cuName'); bind('#cuJob', 'cuJob');
  bind('#cuAbout', 'cuAbout'); bind('#cuSystem', 'cuSystem');
  $('#cuEnabled').onchange = () => { prefs.cuEnabled = $('#cuEnabled').checked; savePrefs(); syncFields(); };
  $('#cuMemory').onchange = () => { prefs.cuMemory = $('#cuMemory').checked; savePrefs(); };
  const box = $('#cuTraits'); box.innerHTML = '';
  TRAITS.forEach(t => {
    const b = document.createElement('button');
    b.className = 'trait' + (prefs.cuTraits.includes(t) ? ' sel' : ''); b.textContent = t;
    b.onclick = () => { const i = prefs.cuTraits.indexOf(t);
      i >= 0 ? prefs.cuTraits.splice(i, 1) : prefs.cuTraits.push(t);
      savePrefs(); b.classList.toggle('sel'); };
    box.append(b);
  });
}
function buildCustomSystem() {
  const parts = [];
  if (prefs.cuEnabled) {
    if (prefs.cuSystem.trim()) parts.push(prefs.cuSystem.trim());
    else {
      if (prefs.cuName) parts.push(`用户希望被称为「${prefs.cuName}」。`);
      if (prefs.cuJob) parts.push(`用户的身份/职业:${prefs.cuJob}。`);
      if (prefs.cuAbout) parts.push(`关于用户:${prefs.cuAbout}`);
      if (prefs.cuTraits.length) parts.push(`回复风格要求:${prefs.cuTraits.join('、')}。`);
    }
  }
  /* 记忆:参考近期对话主题 */
  if (prefs.cuMemory) {
    const topics = convs.filter(c => c.id !== curId && c.title).slice(0, 6).map(c => c.title);
    if (topics.length) parts.push(`用户近期聊过的主题(可参考保持连贯):${topics.join(';')}。`);
  }
  return parts.join(' ');
}

/* ── 数据管理 ── */
function tokenEst(str) {
  let en = 0, cn = 0;
  for (const ch of str || '') (/[一-龥]/.test(ch) ? cn++ : en++);
  return Math.round(cn / 1.5 + en / 4);
}
$('#btnExport').onclick = () => {
  const dump = {}; for (const k of Object.keys(localStorage)) if (k.startsWith('acs.')) dump[k] = localStorage[k];
  downloadFile('ai-chat-studio-backup-' + Date.now() + '.json',
    JSON.stringify({ _app:'AI Chat Studio', _date:new Date().toISOString(), data:dump }, null, 2));
};
$('#btnImport').onclick = () => $('#importFile').click();
$('#importFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { try {
    const j = JSON.parse(r.result); const d = j.data || j;
    if (!confirm('导入将覆盖当前所有数据,确定继续?')) return;
    Object.keys(d).forEach(k => { if (k.startsWith('acs.')) localStorage[k] = d[k]; });
    location.reload();
  } catch { alert('文件格式无效'); } };
  r.readAsText(f); e.target.value = '';
};
$('#btnExportMd').onclick = () => {
  const c = cur(); if (!c || !c.messages.length) return alert('当前没有对话');
  const md = `# ${c.title || '对话'}\n\n` + c.messages.map(m =>
    `**${m.role === 'user' ? '🧑 我' : '🤖 AI'}:**\n\n${m.content}`).join('\n\n---\n\n');
  downloadFile((c.title || 'chat').replace(/[^\w一-龥]/g, '_') + '.md', md);
};
$('#btnClearChats').onclick = () => {
  if (!confirm('确定清空所有对话?配置与偏好会保留。')) return;
  convs = []; curId = null; save(); renderConvs(); renderChat();
  alert('已清空所有对话');
};
$('#btnResetAll').onclick = () => {
  if (!confirm('⚠️ 将删除所有对话、API 配置与偏好,不可恢复!确定?')) return;
  Object.keys(localStorage).filter(k => k.startsWith('acs.')).forEach(k => localStorage.removeItem(k));
  location.reload();
};
function downloadFile(name, content) {
  const blob = new Blob([content], { type:'application/octet-stream' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  a.click(); URL.revokeObjectURL(a.href);
}

/* ── 使用量 ── */
function buildUsage() {
  let totalMsg = 0, userMsg = 0, aiMsg = 0, tokIn = 0, tokOut = 0;
  const byMode = {}, byDay = {};
  convs.forEach(c => {
    c.messages.forEach(m => {
      totalMsg++;
      const t = tokenEst(m.content);
      if (m.role === 'user') { userMsg++; tokIn += t; }
      else { aiMsg++; tokOut += t; const mm = c.mode || 'Auto';
        byMode[mm] = (byMode[mm] || 0) + t; }
    });
    const day = new Date(+c.id).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + c.messages.length;
  });
  const stat = (label, val, ic) => `<div class="usage-card">${icon(ic)}
    <div class="usage-val">${val}</div><div class="usage-lbl">${label}</div></div>`;
  $('#usageStats').innerHTML =
    stat('对话数', convs.length, 'message-square') +
    stat('消息总数', totalMsg, 'sparkles') +
    stat('输入 tokens', tokIn.toLocaleString(), 'upload') +
    stat('输出 tokens', tokOut.toLocaleString(), 'download');

  /* ── SVG 柱状图:近 14 天消息趋势 ── */
  const days = []; for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10)); }
  const vals = days.map(d => byDay[d] || 0);
  const vmax = Math.max(1, ...vals);
  const W = 560, H = 180, PB = 24, PL = 30, bw = (W - PL - 10) / 14;
  let bars = '', grid = '', labels = '';
  /* 网格线 + Y 轴刻度 */
  for (let i = 0; i <= 3; i++) {
    const y = 10 + (H - PB - 10) * i / 3, v = Math.round(vmax * (3 - i) / 3);
    grid += `<line x1="${PL}" y1="${y}" x2="${W - 6}" y2="${y}" class="cg-line"/>
      <text x="${PL - 6}" y="${y + 4}" class="cg-ytick">${v}</text>`;
  }
  days.forEach((d, i) => {
    const h = Math.max(vals[i] ? 4 : 0, (H - PB - 10) * vals[i] / vmax);
    const x = PL + i * bw + bw * 0.18, y = H - PB - h;
    bars += `<rect x="${x}" y="${y}" width="${bw * 0.64}" height="${h}" rx="4" class="cg-bar${vals[i] ? '' : ' zero'}">
      <title>${d}:${vals[i]} 条消息</title></rect>`;
    if (i % 2 === 1) labels += `<text x="${PL + i * bw + bw / 2}" y="${H - 7}" class="cg-xtick">${d.slice(5).replace('-', '/')}</text>`;
  });
  $('#usageChart').innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${grid}${bars}${labels}</svg>`;

  /* ── SVG 环形图:模式 token 占比 ── */
  const entries = Object.entries(byMode).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (!total) { $('#usageDonut').innerHTML = ''; $('#usageLegend').innerHTML = '<p class="hint">暂无数据</p>'; return; }
  const COLORS = ['#1d9bf0', '#8b7cf0', '#10a37f', '#f59e0b', '#e0245e', '#71767b'];
  const R = 56, CX = 70, CY = 70, SW = 22, CIRC = 2 * Math.PI * R;
  let off = 0, segs = '', legend = '';
  entries.forEach(([name, v], i) => {
    const frac = v / total, len = frac * CIRC, color = COLORS[i % COLORS.length];
    segs += `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${color}" stroke-width="${SW}"
      stroke-dasharray="${len - 2} ${CIRC - len + 2}" stroke-dashoffset="${-off}"
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

/* ---------- 初始化 ---------- */
/* 将模板中所有 data-ic="name" 占位符替换为内联 SVG */
function injectIcons(root = document) {
  root.querySelectorAll('[data-ic]').forEach(el => {
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.ic));
    el.removeAttribute('data-ic');
  });
}
injectIcons();
$$('.chip[data-i]').forEach(c => { c.insertAdjacentHTML('afterbegin', icon(c.dataset.i)); });
applyPrefs();
setMode(prefs.defaultMode || modeSel);
renderConvs();
renderChat();
updateSettingsBtn();
updateSkillBtn();
/* 跟随系统主题实时变化(仅当选择「系统」) */
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (prefs.themeChoice === 'system') applyMode(resolveMode('system'));
});
