# AI Chat Studio

一个还原 **Claude / ChatGPT / Grok** 网页对话界面的开源项目,零依赖(仅需 Node ≥ 18)。

## 启动

```bash
node server.js          # 默认 http://localhost:3900
PORT=8080 node server.js  # 自定义端口
```

## 功能清单

| 功能 | 说明 |
|------|------|
| 🎨 三套主题 | 左下角一键切换 Claude(米色暖调)/ GPT(黑白简洁)/ Grok(暗黑) |
| 💬 多会话管理 | 侧栏新建/切换/删除,localStorage 持久化 |
| 🔄 模型选择 | 顶部下拉,随主题切换对应厂商模型列表 |
| ⚡ 流式输出 | SSE 打字机效果,可中途停止(■) |
| 📝 Markdown | 表格 / 代码高亮框 / 引用 / 列表(marked CDN,失败自动降级) |
| 🪄 Artifacts | HTML 代码块一键在右侧沙箱 iframe 实时预览,代码/预览双 Tab |
| 📎 文件上传 | 图片(多模态发送)+ 文本文件(自动内联) |
| 🔍/📊/🧠 开关 | 联网搜索 / 深度研究 / 扩展思考(注入系统提示) |
| 🎤 语音输入 | Web Speech API(Chrome/Edge) |
| ⚙️ 真实 API | 设置中填 Key 即可接入 Anthropic / OpenAI / xAI,支持自定义 Base URL(中转站) |
| 🎭 演示模式 | 不填 Key 也能完整体验所有界面功能 |
| 👥 多智能体 | Grok 4 Heavy 模式:3 个子智能体(调研/推理/审查)并行流式工作 + 主控汇总,复刻 Grok Heavy 工作方式 |
| 🔀 配置切换 | CC-Switch 式 API 配置管理:多套配置(官方/中转)一键切换 |
| 🏷 官方图标 | Claude 星芒 / OpenAI 花结 / Grok 斜杠,均为官方 SVG(mask 自适应主题配色) |

## 架构

```
ai-chat-studio/
├── server.js        # 零依赖 Node 服务:静态托管 + 三厂商流式代理 + 演示模式
└── public/
    ├── index.html   # 页面结构(侧栏/聊天/输入区/Artifacts/设置)
    ├── style.css    # CSS 变量驱动的三套主题
    └── app.js       # 会话管理、SSE 解析、Markdown、Artifacts、附件
```

## 线上部署
- 公网地址:https://chat.xianran.de(Cloudflare 代理 + 1Panel OpenResty 反代)
- systemd 服务:`systemctl status ai-chat-studio`

## 安全说明
- API Key 仅存浏览器 localStorage,经本地服务代理转发,不落盘
- Artifacts iframe 使用 `sandbox="allow-scripts"` 隔离
- 静态服务做了路径穿越防护