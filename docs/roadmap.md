# 路线图与验收

> **M1–M5 现状**：M0–M3、M5 完成，M4 约 35%（浏览器自动化已完成，连接器与正式发布待做），
> **M5 完成**（Automations / Wide Research / Cloud Computer 均已落地，见文末清单）；
> 阶段三见 [phase3-plan.md](phase3-plan.md)。

对应实施计划的 M0–M5。每个里程碑的验收口径写在这里，避免"做完了但没人验收"。

## M0 spike（3–5 天）— 已完成

- [x] 沙箱镜像定义（Node 22 + Python + Office + 中文字体 + Playwright + dsh）
- [x] 运行时智能体跑通"一句话 → 真实 Office 交付物"（实测：docx/xlsx/pptx/pdf 全部生成成功）
- [x] dsh 契约探针 + 本地降级驱动（dsh 不可用时仍然可用）
- [x] **真实 Docker 沙箱验证**：镜像 `wiwana/sandbox:0.1.0` 构建成功（3.73GB，含 dsh 0.1.7-rc.2、
      LibreOffice、思源/Noto CJK 字体、Playwright/Chromium），容器内 dsh 以 headless 模式执行任务
- [x] **真实模型端到端**：控制面以 `SANDBOX_PROVIDER=docker` 拉起任务容器 → 容器内 dsh + DeepSeek
      生成中文交付物（社区咖啡店方案，1.6KB / 899B 两个任务均成功，耗时 7–9 秒）→ 控制面登记交付物 →
      容器自动回收、工作区文件保留

### 真实沙箱验证发现（已修复/已记录）

1. dsh web 面需要 `/?token=` 换 Cookie，且 0.1.7 的 RPC 端点与 0.1.0 文档不一致（`host.describe` 404）
   → 改用 headless CLI 作为执行入口。
2. 多阶段 COPY 会破坏 pnpm 的符号链接布局 → 运行时依赖在最终镜像里用 npm 安装。
3. 控制面必须把模型凭据透传进沙箱（`envPassthrough`），否则容器内会静默降级到本地驱动。
4. 本地构建产物是 arm64 镜像；生产（阿里云 x86_64）需要用 `docker buildx --platform linux/amd64` 或在目标机构建。

## M1 平台骨架（第 1–2 周）

- [x] 数据模型（User/Project/Task/Message/Artifact/Container/Usage/Notification）
- [x] 任务调度器 + 状态机 + 崩溃恢复（重启后 queued 重排、running 标记失败）
- [x] 控制面 HTTP API + SSE 事件流 + 断线重放
- [x] 手机号登录（开发固定验证码）+ 邀请码/白名单预留
- [x] Docker 沙箱提供者（容器创建、端口映射、健康检查、销毁）
- [x] PostgreSQL 表结构与仓储实现（需在真实数据库上跑一次回归）
- [ ] 微信扫码登录（开放平台配置后接入）

## M2 能力与前端闭环（第 3–4 周）

- [x] 产品前端：任务台 / 任务详情（时间线 + 电脑视图 + 交付物）/ 交付物中心 / 登录 / 分享页
- [x] 办公四件套、数据图表、网页生成能力包
- [x] 图片生成、视频生成、音乐生成脚本（需厂商 Key）
- [x] 视觉理解：`vision` 能力包（Qwen-VL，`describe_image.py`）—— 实测对 PPT 截图给出 4 条排版问题；
      沙箱内已验证「浏览器截图 → 视觉检查」闭环
- [x] 任务模板（含"做一个完整项目"成套交付）
- [x] **成套项目交付**：`fullstack` 能力包一次生成 `site/ admin/ api/ app/` 四端骨架（16 个文件），
      后端零依赖 Node + 文件型数据库；沙箱内实测三种预览入口全部可用
      （`/` 网站、`/admin/` 管理台、`/api/health` 后端，由一个预览端口统一提供）

## M3 实时视图与上线（第 5–6 周）

- [x] 泛域名证书：`wiwana.com` + `*.wiwana.com`（Let's Encrypt，DNS-01 via 阿里云 DNS）已本地实签验证，
      服务器上 Traefik 首次启动会自动申请并自动续期
- [x] 电脑视图：任务执行期间定时截取项目预览页并推送 `screenshot` 事件（实测一次网页任务产出 4 帧实时画面）
- [ ] 内容安全送审（阿里云内容安全）+ AI 生成内容标识
- [x] 空闲休眠与唤醒：云电脑空闲后停容器并把状态置为 `sleeping`，下次任务自动重启（实测休眠→唤醒→执行成功）
- [ ] 工作区备份到 OSS + 恢复演练
- [x] 管理台 `/admin`：任务、容器、用量、配额与孤儿容器回收

## M4（第 7–9 周）

- [x] 浏览器自动化（Playwright + 截图留证）— `browser` 能力包，已在镜像内实测
- [x] 编程执行器：Codex 与 Claude Code 子智能体（BYOK）— 已装配进 `wiwana-task` profile
- [ ] 连接器：飞书、企业微信、钉钉、GitHub、Notion + 通用 MCP
- [ ] 网站正式发布与自定义域名、代码导出

## M5（第 10–13 周）

- [x] **Automations**：控制面自带调度器（5 字段 cron + 时区 + `@daily` 简写，见 `apps/control/src/services/cron.ts`），
      到点自动创建任务；事件触发走 `POST /api/connectors/:provider/callback`（共享密钥校验）；
      前端 `/automations` 可新建/启停/立即执行/删除；11 条单测覆盖时区换算与调度语义，并已端到端验证
- [x] **Wide Research**：`research` 能力包规定按对象数量分档并行（5–20 个对象派 3–6 个子智能体，20+ 分批），
      子任务模板（范围 + 字段 + 来源）、合并去重规则、时间线进度格式均已写入技能与执行提示
- [x] **Cloud Computer**：`POST /api/projects/:id/runtime` 为项目创建**常驻容器**（`wiwana-project-*`），
      任务复用同一容器（实测任务前后容器 ID 不变）、任务结束不回收；运行时地址与令牌持久化到数据库
      （重启后仍可复用）；启动时与每 10 分钟清理孤儿任务容器（实测回收 13 个）

## 验收清单（每次发版跑一次）

```sh
pnpm typecheck          # 全仓类型检查
pnpm test               # 控制面集成测试（4 条）
pnpm --filter @wiwana/control build
node scripts/smoke.mjs  # 端到端：登录→建任务→交付物→分享→额度
```

补充人工验收：

1. 生成的 docx/xlsx/pptx 用 WPS 打开无乱码，PDF 可翻页。
2. 网页交付物在 375px 宽度下不横向滚动，分享链接在无登录环境可访问。
3. 关掉浏览器后任务继续执行；重新打开页面时间线补齐。
4. 取消任务 5 秒内生效；失败任务可以重试。
