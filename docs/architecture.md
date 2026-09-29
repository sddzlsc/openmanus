# 架构说明

## 三层结构

```
产品前端 apps/web（Next.js）
      │ 同源 /api 代理（cookie 鉴权）
      ▼
控制面 apps/control（Fastify）
      │ 任务调度 / 配额 / 容器编排 / SSE 汇聚 / 交付物登记
      ▼
沙箱容器（deploy/sandbox）
      ├─ 运行时智能体 apps/runtime-agent（对外唯一入口，bearer token）
      ├─ dsh CLI（@deepseek-ai/dsh，每个任务一个 headless 子进程，不监听端口）
      └─ 能力包 packages/capabilities（脚本 + SKILL.md）
```

控制面与沙箱之间只有一个协议：`packages/protocol/src/runtime.ts`。dsh 的 wire 契约变化只影响
`apps/runtime-agent/src/drivers/dsh.ts` 一个文件，产品层不受影响。

## 为什么不让 dsh 常驻、也不直连它的 Web API

计划最初假设可以用 dsh 的 host API（`POST /api/<method>`）驱动常驻的 dsh web 进程。
在真实沙箱镜像里对着锁定版本 `@deepseek-ai/dsh@0.1.7-rc.2` 验证后，这条路径被否掉了：

1. **web 面需要启动令牌换 Cookie**：`dsh web` 启动时打印 `http://127.0.0.1:3080/?token=...`，
   不带令牌的 `/api` 请求一律 **401**；令牌只在 `GET /?token=...` 上通过一次性交换mint 出
   签名 Cookie（`dsh-auth-<authority>=v1.<payload>.<sig>`，HttpOnly + SameSite=Strict），
   之后所有请求走 Cookie，没有 Bearer 之类的无状态通道。
2. **端点集与旧文档不一致**：换到 Cookie 之后再调文档里的 `POST /api/host.describe` 得到 **404**；
   0.1.7 的端点由 Typert/remotes 层生成，静态枚举不出来。
3. dsh 明确标注 developer preview、"THERE WILL BE COMPATIBILITY-BREAKING CHANGES"。

因此沙箱内改为使用 **文档化的自动化入口**：`dsh --profile <profile> "<task>"`（headless）。
一个任务 = 一个 headless 子进程，模型答案从 stdout 返回，工作区文件就是交付物。
好处：无监听端口、无鉴权面、无协议漂移风险；代价：无法 resume 会话（补充要求会带上历史重跑），
token 用量只能按字符数估算（见 `apps/runtime-agent/src/drivers/dsh.ts` 顶部注释）。

沙箱内保留了一个 `wiwana`（web）profile 仅用于人工排障（`DSH_WEB_ENABLED=true` 时才会启动），
产品链路完全不需要它。

## 任务生命周期

```
POST /api/tasks
  → 创建 Project（若无）+ Task(queued) + 首条消息 + 站内通知
  → TaskRunner.enqueue
     → 配额检查（并发 / 每日 token / 图片 / 视频）
     → RuntimeProvider.startTask
         mock：本地模拟（开发默认，无需 Docker）
         docker：创建沙箱容器 + 等运行时智能体健康 + startSession
           └─ 容器内：runtime agent → `dsh --profile wiwana-task "<prompt>"`
     → RuntimeEvent 流 → TaskEvent 落库 → SSE 广播
         artifact 事件 → 读工作区文件大小 → 登记 Artifact（预览/下载/分享）
     → done/error → 更新 Task、写 UsageRecord、发通知、销毁容器
```

SSE 支持 `Last-Event-ID` / `?from=` 断线重放；`?once=1` 用于测试与一次性读取。

## 数据与持久化

- 元数据：PostgreSQL（`deploy/sql/001_init.sql`），本地开发默认用内存实现，两套实现同一 `Store` 接口。
- 工作区：宿主机目录 `WORKSPACE_ROOT/<workspaceKey>`，是唯一持久化事实；容器可随时销毁重建。
- 交付物：数据库里存元数据，文件留在工作区，通过 `/files/:id` 提供预览与下载。

## 能力包

每一个能力 = 一个目录 = `SKILL.md`（给 dsh 模型加载的技能说明）+ 可执行脚本（给运行时调用）。
控制面按任务类型选择能力包（`capabilityPacksForTask`），运行时在沙箱中调用脚本。
这既是 v1 的功能单元，也是后续"插件/子智能体市场"的发布单元。

## 与实施计划的对应

| 计划项 | 当前实现 |
|---|---|
| 任务/项目/交付物数据模型 | ✅ `packages/protocol` + `apps/control/src/store` |
| 任务调度与容器生命周期 | ✅ `services/taskRunner.ts` + `runtime/docker.ts`（mock 可离线跑通） |
| 控制面网关（SSE 事件流） | ✅ `routes/tasks.ts`（含断线重放） |
| 手机号登录 | ✅ 开发固定验证码；阿里云短信接入点在 `auth/otp.ts` |
| 交付物中心 + 分享链接 | ✅ `/api/artifacts`、`/s/:slug`、公开文件访问控制 |
| 配额与防滥用 | ✅ `services/quota.ts`（在沙箱外强制，沙箱内不可绕过） |
| 办公四件套 / 数据图表 / 网页 | ✅ `packages/capabilities`（本机已验证产出真实 docx/xlsx/pptx/pdf/svg） |
| 媒体生成（图/视频/音乐） | ✅ 脚本与接口就绪，需配置厂商 API Key |
| 电脑视图（截图流） | 🚧 UI 与事件类型就绪，CDP 截图流在 M3 接入 |
| 浏览器自动化 / 连接器 / 并行研究 / 自动化 / 云电脑 | ⏳ M4–M5，接口与数据模型已预留 |

## 已知取舍（与原计划的偏差）

1. **元数据层用 SQL 迁移 + 手写仓储，而不是 Drizzle**：依赖更少、迁移可读；
   `Store` 接口不依赖实现，后续换 ORM 不影响调用方。
2. **配额由控制面与运行时强制，而不是写成一个 dsh Cordis 插件**：沙箱内的插件无法可信地约束自己，
   把限额放在沙箱外才能抵抗"智能体修改自己的限制"这类问题。
3. **v1 的预览走路径式（`/preview/:projectId/...`）**，生产环境由 `预览子域名 → 容器 5173 端口`
   承担（`runtime/docker.ts` 已写入 Traefik label）。
