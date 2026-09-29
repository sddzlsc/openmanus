# Contributing

感谢参与！这个项目由「编排内核（dsh）+ 产品层（控制面/前端）+ 能力包」三部分组成，改动前建议先读
[docs/architecture.md](docs/architecture.md)。

## 开发环境

```sh
pnpm install
pnpm --filter @wiwana/control build
pnpm typecheck && pnpm test && node scripts/smoke.mjs
```

不需要 Docker 也能开发：默认 `SANDBOX_PROVIDER=mock` 提供内置模拟运行时。
需要真实沙箱时构建 `deploy/sandbox/Dockerfile`（约 3.7GB）。

## 提交流程

1. `pnpm typecheck`、`pnpm test`、`node scripts/smoke.mjs` 必须全绿；
2. 新增能力请按「能力包」组织：`packages/capabilities/<pack>/SKILL.md` + `scripts/`，并在 `manifest.json` 登记；
3. 涉及交付物的改动请在 PR 描述里附上真实产物（例如生成的 pptx/docx 截图）；
4. 不要提交任何凭据（见 [SECURITY.md](SECURITY.md)）。

## 换品牌命名空间

参考实现使用 `@wiwana/*` 包名与 `wiwana.com` 示例域名。fork 后如需整体改名：

```sh
git grep -l '@wiwana/' | xargs sed -i '' 's|@wiwana/|@yourscope/|g'
# 再改 package.json 的 name、deploy 里的镜像名与示例域名
pnpm install && pnpm typecheck && pnpm test
```

## 代码风格

- TypeScript：ESM、`.js` 扩展名导入、显式类型（仓库为 `strict`）；
- 后端所有对外行为都要有测试：`apps/control/tests/`；
- 涉及沙箱内脚本的能力包请提供「依赖缺失时的降级路径」，不要静默失败。
