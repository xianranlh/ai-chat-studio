# Grok

Local 1:1 recreation of [grok.com](https://grok.com). Node ≥ 18, zero npm dependencies.

## Run

```bash
node server.js
# http://localhost:3900
```

## Matches grok.com

| Surface | Detail |
|---------|--------|
| Empty landing | Logo + “What do you want to know?” |
| Calm pill composer | `+` left · Fast right · mic / voice / send |
| `+` menu | Upload · Skills (docx/pdf/pptx/xlsx) · Connectors |
| Modes | Fast · Auto · Expert · Heavy |
| Top right | Private · Imagine |
| Sidebar | History by time · SuperGrok · Settings |
| Features | DeepSearch panel · Thoughts · multi-agent Heavy · Imagine · Voice |
| Settings | Account (xAI key) · Appearance · Customize Grok · Data controls |

## Removed (not Grok)

- Claude / ChatGPT multi-provider UI  
- Artifacts side panel  
- Custom “profession” skills  
- Usage analytics / accent color kits  
- Extra nav chrome  

## API

Settings → Account → paste an [xAI](https://console.x.ai) key.  
Empty key = full UI demo mode (streamed mock replies).
