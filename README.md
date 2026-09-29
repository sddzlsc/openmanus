# OpenManus · 本地优先的通用智能体平台

一句话交代任务，智能体在你自己的机器上异步执行，产出**文档、表格、幻灯片、PDF、数据图表、网页、图片、视频**，
全程可看它干活，完成后可下载、可分享；编程任务还能产出**后台管理系统 + 后端 API + 网站 + 小程序/App** 的成套工程。

编排内核是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh，插件化 harness，MIT）。
本仓库只提供**产品层、能力包与执行器编排**，不 fork 内核。

> 本仓库是 Wiwana 团队的参考实现：包命名空间 `@wiwana/*`、示例域名 `wiwana.com` 均为该实现的品牌；
> 如果你要 fork 成自己的产品，可以整体替换命名空间（见 CONTRIBUTING）。

## 特性

| 能力 | 说明 |
|---|---|
| 异步任务 | 任务在后台跑，关掉浏览器不中断；SSE 实时时间线，断线自动重放 |
| 沙箱执行 | **每个项目一个容器**，容器内跑 dsh + 工具 + 预览服务；工作区持久化，容器可随时回收 |
| 办公交付物 | Word / Excel / PPT / PDF / 数据图表，全部由真实脚本生成 |
| 网页与工程 | 网站、落地页，以及（规划中）后台管理系统 + 后端 API + 小程序/App 成套脚手架 |
| 图片生成 | 通义万相（DashScope），产出 .png 并可预览/分享 |
| 浏览器操作 | Playwright + Chromium：抓正文/链接、填表、点击、整页截图留证 |
| 编程执行器 | **Codex** 与 **Claude Code** 子智能体，两者都跑在 DeepSeek 上，无需 OpenAI/Anthropic 账号 |
| 交付物导出 | 文本交付物一键导出 Word；工作区一键打包 zip |
| 自动化 | cron 定时任务（含时区）与连接器事件触发 |
| 分享 | 公开只读链接，浏览器拦截规则友好（查询参数式路径） |

## 快速开始（本地，免登录）

```sh
git clone https://github.com/sddzlsc/openmanus.git && cd openmanus
pnpm install
pnpm --filter @wiwana/control build
node scripts/smoke.mjs          # 端到端自检：建任务 → 交付物 → 分享 → 用量

pnpm dev:control                # http://127.0.0.1:8787
pnpm dev:web                    # http://127.0.0.1:3000
```

默认 **`AUTH_MODE=local`**：单机单用户、**无需登录**，请求自动归属本机用户。
需要多用户/手机号登录时设 `AUTH_MODE=phone` 并配置短信服务。

### 让智能体真的干活

```sh
cp .env.example .env
# 至少填一个模型 Key：
#   DEEPSEEK_API_KEY   —— 主循环 + Codex + Claude Code（三者共用）
#   DASHSCOPE_API_KEY  —— 图片生成 / 视觉理解（可选）
```

启用容器沙箱（每个项目一个容器）：

```sh
docker build -f deploy/sandbox/Dockerfile -t wiwana/sandbox:0.1.0 .   # 约 3.7GB
docker network create wiwana-edge
# 控制面用 SANDBOX_PROVIDER=docker 启动，见 deploy/README.md
```

不装 Docker 也能跑：默认 `SANDBOX_PROVIDER=mock` 用内置模拟运行时把整条产品链路跑通。

## 架构

```
产品前端 (Next.js)  ──同源代理──▶  控制面 (Fastify)
                                      ├─ 任务调度 / 配额 / 交付物登记 / SSE 事件流
                                      ├─ 自动化调度（cron + 连接器 webhook）
                                      └─ 容器编排 ──▶ 沙箱容器（每项目一个）
                                                        ├─ 运行时智能体（唯一对外入口）
                                                        ├─ dsh（headless，每任务一个进程）
                                                        │    ├─ DeepSeek 主循环
                                                        │    ├─ Codex 子智能体（DeepSeek Responses 协议）
                                                        │    └─ Claude Code 子智能体（DeepSeek Anthropic 端点）
                                                        └─ 能力包（office / data / web / media / research / browser）
```

细节：[docs/architecture.md](docs/architecture.md)｜沙箱镜像与执行器配置：[deploy/sandbox/README.md](deploy/sandbox/README.md)｜
里程碑：[docs/roadmap.md](docs/roadmap.md)｜阶段三计划：[docs/phase3-plan.md](docs/phase3-plan.md)

## 仓库结构

| 路径 | 作用 |
|---|---|
| `apps/web` | 产品前端：任务台、任务详情（时间线 + 电脑视图 + 交付物）、交付物中心、自动化 |
| `apps/control` | 控制面：鉴权模式、任务与配额、容器编排、dsh 网关、交付物、SSE、自动化调度 |
| `apps/runtime-agent` | 沙箱内运行时：持有 dsh、执行能力包、预览服务、截图/终端流 |
| `packages/protocol` | 前后端与运行时共享类型（领域模型 / HTTP API / 任务事件 / 运行时协议） |
| `packages/capabilities` | 能力包：office、data、web、media、research、browser（技能 + 可执行脚本） |
| `packages/dsh-bundle-wiwana` | dsh 产品 bundle：中文 persona、能力包目录、Codex/Claude Code 执行器装配 |
| `deploy/` | 沙箱/控制面/前端镜像、Compose、Traefik、PostgreSQL 表结构 |

## 开发与验证

```sh
pnpm typecheck        # 全仓类型检查
pnpm test             # 13 条集成/单元测试（含本地模式、时区 cron、自动化调度）
node scripts/smoke.mjs
```

## 安全

- **仓库内不含任何密钥**：所有凭据放在 `.env`（已 gitignore），证书目录同样被忽略；
  提交前请跑一次 `git status` 确认 `.env`、`data/`、`deploy/traefik/certs/` 未被跟踪。详见 [SECURITY.md](SECURITY.md)。
- 沙箱容器以非特权用户运行、`CapDrop: ALL`、带 CPU/内存/PID 限额；生产部署还需封禁云元数据地址（见 `deploy/README.md`）。
- dsh 的 Web 面不对外暴露：沙箱内 dsh 以 headless 子进程执行任务，不监听端口。

## 许可证

[MIT](LICENSE)
