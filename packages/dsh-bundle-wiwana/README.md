# @wiwana/dsh-bundle

把 dsh 变成 Wiwana 产品底座的最小声明式 bundle：

- 产品人设（中文、交付物导向、合规红线）
- 能力包技能目录（`/opt/wiwana/capabilities/*` → `skill-filesystem.customSkillDirs`）

不包含：模型路由（`DEEPSEEK_API_KEY` 由沙箱环境注入，dsh-base 的 DeepSeek 适配器直接生效）、
配额（由控制面与运行时智能体强制，沙箱内不可自我豁免）、UI（产品前端自研）。

## 安装

```sh
# 沙箱镜像内已经预装，手动复现时：
dsh plugin --profile wiwana add /opt/wiwana/dsh-bundle
```

profile 的 `package.json` 需要按顺序声明 bundles：

```json
{
  "name": "wiwana-profile",
  "private": true,
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "/opt/wiwana/dsh-bundle"]
    }
  }
}
```

## 升级纪律

`@deepseek-ai/dsh` 处于 developer preview，锁版本升级。升级前必须：

1. 用 `dsh --profile wiwana --dump-config` 确认本 bundle 的两行 patch 仍能命中（row id 未变）。
2. 跑 `apps/runtime-agent` 的 dsh 契约探针（`src/drivers/dsh.ts` 顶部注释里的 4 条检查）。
3. 用 M0 验收脚本重新生成一次文档 + 网页，确认交付物链路未断。
