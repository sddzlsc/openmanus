#!/usr/bin/env node
/**
 * Generate the four-part project skeleton: site + admin + api + uni-app.
 *
 * Zero build step on purpose: every part runs immediately inside the sandbox so
 * the user can preview all three web entries (site `/`, admin `/admin/`, API
 * `/api/*`) while the agent is still working. Dependencies are intentionally
 * absent — the API is plain Node, the front-ends are plain HTML/CSS/JS, and the
 * uni-app sources are ready for HBuilderX.
 *
 *   node bootstrap.mjs --out /workspace --name "咖啡店预约" --domain "宠物医院"
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const out = path.resolve(arg('out', process.cwd()))
const name = arg('name', '新项目')
const domain = arg('domain', '业务')

const files = {
  'README.md': `# ${name}

由 OpenManus 生成的成套项目骨架（网站 + 后台管理 + 后端 API + 小程序/App）。

| 目录 | 说明 | 本地入口 |
|---|---|---|
| \`site/\` | 网站 / H5 前台 | http://127.0.0.1:5173/ |
| \`admin/\` | 后台管理系统 | http://127.0.0.1:5173/admin/ |
| \`api/\` | 后端 API（零依赖 Node） | http://127.0.0.1:8788/api/health |
| \`app/\` | uni-app 源码（H5 / 小程序 / App） | HBuilderX 打开 \`app/\` |

## 运行

\`\`\`sh
node api/server.mjs          # 启动后端（自动创建 data/items.json）
python3 -m http.server 5173  # 或由 OpenManus 的预览服务托管 site/ 与 admin/
\`\`\`

## 打小程序 / App

用 HBuilderX 打开 \`app/\`：运行到微信开发者工具即可预览小程序；"发行 → 原生 App 云打包"生成 iOS/Android 安装包。
接口地址在 \`app/common/config.js\` 里改成你的后端域名。
`,
  'api/server.mjs': `#!/usr/bin/env node
// Zero-dependency backend: REST API + file-backed database.
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const PORT = Number(process.env.PROJECT_API_PORT ?? 8788)
const DATA_DIR = path.join(import.meta.dirname, 'data')
const DATA_FILE = path.join(DATA_DIR, 'items.json')

async function load() {
  try {
    return JSON.parse(await readFile(DATA_FILE, 'utf8'))
  } catch {
    return { items: [] }
  }
}

async function save(db) {
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(DATA_FILE, JSON.stringify(db, null, 2), 'utf8')
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' })
  res.end(JSON.stringify(body))
}

async function body(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (req.method === 'OPTIONS') return json(res, 204, {})
  if (url.pathname === '/api/health') return json(res, 200, { ok: true, service: '${name}', time: new Date().toISOString() })

  const db = await load()
  if (url.pathname === '/api/items' && req.method === 'GET') return json(res, 200, db)
  if (url.pathname === '/api/items' && req.method === 'POST') {
    const payload = await body(req)
    const item = { id: Date.now().toString(36), title: payload.title ?? '未命名', status: payload.status ?? '待处理', createdAt: new Date().toISOString() }
    db.items.push(item)
    await save(db)
    return json(res, 201, item)
  }
  if (url.pathname.startsWith('/api/items/') && req.method === 'DELETE') {
    const id = url.pathname.split('/').pop()
    db.items = db.items.filter((entry) => entry.id !== id)
    await save(db)
    return json(res, 200, { ok: true })
  }
  return json(res, 404, { error: 'not found' })
})

server.listen(PORT, '127.0.0.1', () => console.log(\`api listening on http://127.0.0.1:\${PORT}\`))
`,
  'api/data/items.json': JSON.stringify({ items: [{ id: 'demo', title: '示例数据', status: '待处理', createdAt: new Date().toISOString() }] }, null, 2),
  'site/index.html': `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${name}</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <header class="hero">
    <h1>${name}</h1>
    <p>面向「${domain}」的网站前台，数据来自后端 API。</p>
    <a class="cta" href="/admin/">进入后台管理</a>
  </header>
  <main>
    <h2>最新数据</h2>
    <ul id="items"><li>正在加载…</li></ul>
  </main>
  <script src="./app.js"></script>
</body>
</html>`,
  'site/styles.css': `:root{color-scheme:light}body{margin:0;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#101828}.hero{padding:96px 8vw;background:linear-gradient(135deg,#eef2ff,#f8fafc)}h1{font-size:clamp(32px,5vw,52px);margin:0 0 12px}p{color:#475467;font-size:18px}.cta{display:inline-block;margin-top:20px;padding:12px 24px;border-radius:999px;background:#4338ca;color:#fff;text-decoration:none}main{padding:48px 8vw}ul{list-style:none;padding:0;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}li{padding:16px;border:1px solid #e4e7ec;border-radius:14px}`,
  'site/app.js': `fetch('/api/items').then((r)=>r.json()).then((data)=>{const list=document.getElementById('items');list.innerHTML='';for(const item of data.items){const li=document.createElement('li');li.textContent=item.title+' · '+item.status;list.appendChild(li)}}).catch(()=>{document.getElementById('items').textContent='接口未启动'})`,
  'admin/index.html': `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${name} · 后台管理</title>
  <link rel="stylesheet" href="./admin.css">
</head>
<body>
  <aside><h1>${name}</h1><p>后台管理系统</p></aside>
  <main>
    <form id="create">
      <input id="title" placeholder="标题" required>
      <select id="status"><option>待处理</option><option>进行中</option><option>已完成</option></select>
      <button type="submit">新增</button>
    </form>
    <table>
      <thead><tr><th>标题</th><th>状态</th><th>创建时间</th><th></th></tr></thead>
      <tbody id="rows"><tr><td colspan="4">加载中…</td></tr></tbody>
    </table>
  </main>
  <script src="./admin.js"></script>
</body>
</html>`,
  'admin/admin.css': `:root{color-scheme:light}body{margin:0;display:flex;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#101828;background:#f7f8fc}aside{width:220px;padding:28px 20px;background:#101828;color:#fff;min-height:100vh}aside p{color:#98a2b3;font-size:13px}main{flex:1;padding:28px}form{display:flex;gap:10px;margin-bottom:20px}input,select{padding:10px 12px;border:1px solid #d0d5dd;border-radius:10px}button{padding:10px 18px;border:0;border-radius:10px;background:#4338ca;color:#fff;font-weight:600;cursor:pointer}table{width:100%;border-collapse:collapse;background:#fff;border-radius:14px;overflow:hidden}th,td{padding:12px 14px;text-align:left;border-bottom:1px solid #eaecf0;font-size:14px}th{background:#f9fafb;font-size:13px;color:#475467}.danger{background:#fff;color:#b42318;border:1px solid #fda29b}`,
  'admin/admin.js': `const rows=document.getElementById('rows')
async function load(){const data=await fetch('/api/items').then(r=>r.json()).catch(()=>({items:[]}));rows.innerHTML='';if(!data.items.length){rows.innerHTML='<tr><td colspan="4">暂无数据</td></tr>';return}for(const item of data.items){const tr=document.createElement('tr');tr.innerHTML='<td>'+item.title+'</td><td>'+item.status+'</td><td>'+(item.createdAt||'').slice(0,10)+'</td><td><button class="danger" data-id="'+item.id+'">删除</button></td>';rows.appendChild(tr)}}
document.getElementById('create').addEventListener('submit',async(e)=>{e.preventDefault();await fetch('/api/items',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:document.getElementById('title').value,status:document.getElementById('status').value})});document.getElementById('title').value='';load()})
rows.addEventListener('click',async(e)=>{const id=e.target.dataset?.id;if(!id)return;await fetch('/api/items/'+id,{method:'DELETE'});load()})
load()`,
  'app/README.md': `# ${name} · uni-app 端

一套代码，编译到 H5 / 微信小程序 / iOS / Android。

1. 用 HBuilderX 打开本目录；
2. \`common/config.js\` 里的 \`API_BASE\` 改成后端地址（沙箱预览时用同域 \`/api\`）；
3. 运行到微信开发者工具预览小程序；发行 → 原生 App 云打包生成安装包。
`,
  'app/pages.json': JSON.stringify(
    {
      pages: [{ path: 'pages/index/index', style: { navigationBarTitleText: name } }],
      globalStyle: { navigationBarTextStyle: 'black', navigationBarBackgroundColor: '#ffffff' },
    },
    null,
    2,
  ),
  'app/manifest.json': JSON.stringify(
    {
      name,
      appid: '__UNI__OPNMN_' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      description: `${domain} 移动端`,
      versionName: '1.0.0',
      versionCode: '100',
      'mp-weixin': { appid: '', setting: { urlCheck: false } },
      'app-plus': { usingComponents: true },
      h5: {},
    },
    null,
    2,
  ),
  'app/main.js': `import App from './App.vue'
import { createSSRApp } from 'vue'
export function createApp() {
  const app = createSSRApp(App)
  return { app }
}
`,
  'app/App.vue': `<script>
export default { onLaunch() {} }
</script>
<style>
page { background: #f7f8fc; }
</style>
`,
  'app/common/config.js': `// 沙箱预览走同域 /api；发布小程序/App 时改成你的后端域名
export const API_BASE = '/api'
`,
  'app/pages/index/index.vue': `<template>
  <view class="page">
    <text class="title">${name}</text>
    <text class="subtitle">${domain} · uni-app 端（H5 / 小程序 / App）</text>
    <view class="card" v-for="item in items" :key="item.id">
      <text>{{ item.title }}</text>
      <text class="status">{{ item.status }}</text>
    </view>
  </view>
</template>

<script>
import { API_BASE } from '../../common/config.js'
export default {
  data() {
    return { items: [] }
  },
  onLoad() {
    uni.request({
      url: API_BASE + '/items',
      success: (res) => {
        this.items = res.data?.items ?? []
      },
    })
  },
}
</script>

<style>
.page { padding: 32rpx; }
.title { font-size: 44rpx; font-weight: 700; display: block; }
.subtitle { color: #667085; font-size: 26rpx; display: block; margin: 12rpx 0 24rpx; }
.card { background: #fff; border-radius: 20rpx; padding: 28rpx; margin-bottom: 20rpx; display: flex; justify-content: space-between; }
.status { color: #4338ca; }
</style>
`,
}

let written = 0
for (const [relative, content] of Object.entries(files)) {
  const target = path.join(out, relative)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')
  written += 1
}

console.log(`bootstrapped ${written} files for "${name}" (${domain}) into ${out}`)
console.log('  site/ (preview /) · admin/ (preview /admin/) · api/ (preview /api/) · app/ (uni-app)')
