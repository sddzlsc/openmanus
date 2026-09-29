# 部署与运维

## 单机起步（v1）

一台阿里云 ECS（建议 8C32G / 200G ESSD）承载：Traefik + 产品前端 + 控制面 + PostgreSQL + 任务沙箱容器。

```sh
cp .env.example .env      # 填 JWT_SECRET / DEEPSEEK_API_KEY / 域名 / ACME 邮箱
docker network create wiwana-edge     # 若不存在

# 1. 构建沙箱镜像（含 dsh、能力包、中文字体、Office、Playwright/Chromium）
docker build -f deploy/sandbox/Dockerfile -t wiwana/sandbox:0.1.0 .

# 2. 起控制面与前端（postgres 容器首次启动会执行 deploy/sql/*.sql）
docker compose -f deploy/compose/docker-compose.yml --env-file .env up -d
```

## DNS 与证书

- `app.<域名>` → 产品前端，`api.<域名>` → 控制面
- `*.<预览域名>` → 沙箱预览（泛解析 A 记录指向同一台 ECS）
- 泛域名证书由 Traefik `alidns` DNS Challenge 自动签发，需要阿里云 DNS 最小权限 AccessKey

### 已签发的泛域名证书（wiwana.com）

本地已用 `deploy/traefik/` 的配置真实跑通一次 DNS-01 签发，证书信息：

| 项 | 值 |
|---|---|
| 域名 | `wiwana.com` + `*.wiwana.com` |
| 签发机构 | Let's Encrypt（CN=YR2，RSA，链长 3） |
| 有效期 | 2026-09-29 → 2026-12-28（有效期 90 天，Traefik 到期前自动续期） |
| ACME 状态 | `deploy/traefik/letsencrypt/acme.json`（已 gitignore） |
| 导出文件 | `deploy/traefik/certs/wiwana.com-{fullchain,privkey}.pem`（已 gitignore，权限 600） |

**生产环境推荐做法**：不要把本机的私钥拷到服务器，而是让服务器上的 Traefik 自己签：

```sh
# 服务器上
export ALICLOUD_ACCESS_KEY=...   # 建议 RAM 子账号，仅 DNS 权限
export ALICLOUD_SECRET_KEY=...
export ACME_EMAIL=you@example.com
docker compose -f deploy/compose/docker-compose.yml --env-file .env up -d traefik
docker logs -f traefik | grep -i acme   # 首次启动会自动申请 wiwana.com + *.wiwana.com
```

签发依赖：域名解析托管在阿里云 DNS（`wiwana.com` 已确认）、key 具备
`AddDomainRecord`/`DescribeDomainRecords`/`DeleteDomainRecord` 权限（已实测通过）。
DNS-01 只写 TXT 记录，**不需要服务器有任何公网入口**，也不要求先备案。

排障用 staging（不消耗正式额度）：把 `dynamic.yml` 里 `certResolver` 换成 `alidns-staging`，
删除 `deploy/traefik/letsencrypt/acme-staging.json` 后重启。

手动查看已签发证书：

```sh
docker run --rm -v wiwana-acme-data:/data alpine cat /data/acme.json | \
  python3 -c "import sys,json;[print(c['domain']) for r in json.load(sys.stdin).values() for c in (r.get('Certificates') or [])]"
```

### Traefik 配置里的两个坑（已修）

1. **静态配置不解析 `${VAR}`**：`traefik.yml` 里写 `email: ${ACME_EMAIL}` 会拿到字面量字符串，
   ACME 注册失败。邮箱必须由命令行传入：compose 里
   `--certificatesresolvers.alidns.acme.email=${ACME_EMAIL}`（compose 会插值）。
2. **泛域名证书需要在某个 router 上显式声明**：见 `dynamic.yml` 的 `cert-bootstrap`
   （`tls.domains` + `noop@internal` 服务），否则 Traefik 不会主动申请通配符证书。

## 本地一键跑（容器版，可长期停留）

`pnpm dev:*` 进程无法脱离终端会话存活，所以本仓库提供容器版本地运行：

```sh
docker network create wiwana-edge 2>/dev/null || true
docker build -f deploy/control/Dockerfile -t wiwana/control:0.1.0 .
docker build -f deploy/web/Dockerfile -t wiwana/web:0.1.0 .

# PostgreSQL（必须：内存存储会在控制面重启后清空账号与任务）
docker run -d --name wiwana-postgres --network wiwana-edge -p 127.0.0.1:55432:5432 \
  -e POSTGRES_USER=wiwana -e POSTGRES_PASSWORD=wiwana-dev-password -e POSTGRES_DB=wiwana \
  -v wiwana-pgdata:/var/lib/postgresql/data -v "$PWD/deploy/sql:/docker-entrypoint-initdb.d:ro" \
  postgres:16-alpine

docker run -d --name wiwana-control --network wiwana-edge --network-alias control \
  -p 127.0.0.1:8787:8787 -e HOST=0.0.0.0 -e STORE=postgres \
  -e DATABASE_URL=postgres://wiwana:wiwana-dev-password@wiwana-postgres:5432/wiwana \
  -e SANDBOX_PROVIDER=mock -e JWT_SECRET=dev-local-secret \
  -v wiwana-dev-workspaces:/data/workspaces wiwana/control:0.1.0

docker run -d --name wiwana-web --network wiwana-edge -p 127.0.0.1:3000:3000 wiwana/web:0.1.0
# 打开 http://127.0.0.1:3000 ，手机号任意 11 位，开发验证码 000000
```

需要热更新时改用 `pnpm dev:control` + `pnpm dev:web`（在**你自己的终端**里跑，不要用后台方式）。

### 两个容易踩的坑

1. **别用 `STORE=memory` 做"先登录再重启"的实验**：内存存储下重启控制面会清空用户，
   浏览器里的 Cookie 仍在，于是每个请求都返回 401「请先登录」，看起来像"点了没反应/失败"。
   本地也用 Postgres（上面的命令），账号与任务才会跨重启保留。
2. **控制面容器必须 `-e HOST=0.0.0.0`**：默认只监听容器内 `127.0.0.1`，端口映射进不来。
3. 前端侧若出现任何失败，浏览器会把错误上报到 `POST /api/client-errors`，
   直接 `docker logs wiwana-control | grep client-error` 就能看到原因。

## 安全基线（开放注册前必须完成）

1. **元数据封禁**：沙箱网络丢弃云元数据地址：
   ```sh
   iptables -I DOCKER-USER -d 100.100.100.200 -j DROP
   iptables -I DOCKER-USER -d 169.254.169.254 -j DROP
   ```
2. **控制面隔离**：`wiwana-sandbox` 网络不能直连控制面 8787 与数据库 5432，只允许公网出口。
3. **容器限制**：控制面创建容器时已设置 `CapDrop: ALL`、`no-new-privileges`、CPU/内存/PID 上限
   （见 `apps/control/src/runtime/docker.ts`）。
4. **沙箱内没有常驻 dsh 服务**：任务执行是 `dsh --profile wiwana-task "<prompt>"` 一次性子进程，
   不监听任何端口；只有运行时智能体（8790）与预览服务（5173）对内网开放，且两者都带 bearer token / 只读静态。
5. **备份**：`workspaces` 卷每日快照到 OSS（`ossutil sync` 或 ECS 快照 + 生命周期策略）。

## 工作区与回收

工作区目录 `WORKSPACE_ROOT/<workspaceKey>` 是唯一持久化事实：容器可以随时销毁重建，文件不受影响。
默认空闲 15 分钟休眠（`SANDBOX_IDLE_SLEEP_MS`），下次任务触发时复用同一目录。

## 沙箱镜像

```sh
# 本机（Apple Silicon）构建出来的是 arm64 镜像，仅用于开发验证
docker build -f deploy/sandbox/Dockerfile -t wiwana/sandbox:0.1.0 .

# 生产（阿里云 ECS x86_64）
docker buildx build --platform linux/amd64 -f deploy/sandbox/Dockerfile -t wiwana/sandbox:0.1.0 --push .
```

镜像内包含：Node 22、Python 3 + python-docx/openpyxl/python-pptx/reportlab/matplotlib/pandas、
LibreOffice、pandoc、思源/Noto CJK 字体、Playwright + Chromium、`@deepseek-ai/dsh@0.1.7-rc.2`，
以及两个预建 profile（`wiwana-task` 用于任务执行，`wiwana` 仅用于人工排障）。

## 规模化路径（M4+）

- 单机 15–20 个并发容器后，把沙箱下沉到独立 ECS 节点，控制面通过 Docker API 与 `SANDBOX_NETWORK` 远程调度。
- 需要强隔离时切换 gVisor（`runsc`）或 Firecracker 微虚拟机——这正是 dsh `ctx.fs`/`ctx.subprocess`
  执行世界抽象的替换点，产品层无需改动。
