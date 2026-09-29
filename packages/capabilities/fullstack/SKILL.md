---
name: fullstack-suite
description: 成套项目交付：网站 + 后台管理系统 + 后端 API + 小程序/App（uni-app 一份代码），含独立数据库与多入口预览。
whenToUse: 当用户要求"做一个完整项目/系统/平台/应用"，而不只是一个页面时。
metadata:
  pack: fullstack
  scripts: scripts/bootstrap.mjs
---

# 成套项目能力包

一次交付四端，每一端都要能跑、能看：

| 目录 | 交付内容 | 预览入口 |
|---|---|---|
| `site/` | 网站 / H5 前台（含调用后端接口） | `/` |
| `admin/` | 后台管理系统（数据列表、增删改、调用后端） | `/admin/` |
| `api/` | 后端 API（零依赖 Node + 文件型数据库） | `/api/health` |
| `app/` | uni-app 源码（同一套代码编译 H5 / 微信小程序 / iOS / Android） | 用 HBuilderX 打包 |

## 硬性规则

1. **先跑脚手架**，不要从零手写目录结构：

   ```sh
   node /opt/wiwana/capabilities/fullstack/scripts/bootstrap.mjs --out /workspace \
     --name "项目名" --domain "业务领域"
   ```

   它会在工作区生成 `site/ admin/ api/ app/ README.md`，后端自带 `data/items.json` 数据库。
2. **改需求，不改结构**：按用户业务替换文案、字段与页面，保持四个入口可用；
   后端新增接口必须同时更新 `admin/` 的调用，保证"后台能操作系统"。
3. **数据落库**：所有业务数据通过 `api/server.mjs` 读写 `api/data/`，不要写死在页面里。
4. **自检三件事**：`api/health` 能返回 200、`/admin/` 能列出数据、`site/` 首页能读到接口数据；
   再用 `browser` 包截图 + `vision` 包检查排版。
5. **小程序/App**：`app/` 是 uni-app 源码（`pages.json` / `manifest.json` / `.vue` 页面）。
   交付时说明：用 HBuilderX 打开 `app/` 目录即可运行到微信开发者工具或云打包 App；不要声称已在沙箱内打包成功。
6. 每个项目的数据与容器相互隔离（各自的工作区与 `api/data/`），不要跨项目引用文件。
