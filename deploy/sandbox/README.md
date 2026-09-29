# 沙箱镜像说明

`wiwana/sandbox:0.1.0` 是每个任务/项目的执行环境，容器边界即隔离边界。

## 内容

| 组件 | 版本/说明 |
|---|---|
| Node / Python | Node 22、Python 3.11 |
| dsh | `@deepseek-ai/dsh@0.1.7-rc.2`，预建 `wiwana-task`（headless）与 `wiwana`（web，调试用）两个 profile |
| 办公与数据 | python-docx / openpyxl / python-pptx / reportlab / matplotlib / pandas、LibreOffice、pandoc |
| 中文字体 | 思源/Noto CJK（PPT/PDF 中文渲染的关键） |
| 浏览器 | Chromium + Playwright（Python 包），缓存固定在 `/opt/ms-playwright` 供非特权用户使用 |
| 编程执行器 | Codex CLI（`@openai/codex`）与 Claude Code（`@anthropic-ai/claude-code`） |
| 能力包 | `/opt/wiwana/capabilities`：office、data、web、media、research、browser |

## 执行器全部走 DeepSeek（不依赖境外账号）

| 执行器 | 走哪条通道 | 配置位置 |
|---|---|---|
| 主循环（编排） | DeepSeek OpenAI 兼容 `/chat/completions` | dsh `llm-deepseek` 适配器 + `DEEPSEEK_API_KEY` |
| Codex 子智能体 | DeepSeek **Responses** 兼容 `/v1/responses` | `~/.codex/config.toml`（`wire_api = "responses"`） |
| Claude Code 子智能体 | DeepSeek **Anthropic** 兼容 `/anthropic/v1/messages` | bundle 的 `subagent-claude-code.env`（`ANTHROPIC_BASE_URL` 等） |

两条通道都用同一把 `DEEPSEEK_API_KEY`（由控制面透传进沙箱），因此**不需要 OpenAI / Anthropic 账号**。

## 两个必须记住的坑

1. **Codex 的内层沙箱在容器里起不来**：`bwrap: No permissions to create a new namespace`。
   容器本身就是隔离边界，所以 `~/.codex/config.toml` 里设 `sandbox_mode = "danger-full-access"`。
2. **Codex 需要可写的 home**：`/home/agent/.codex` 必须属于运行用户 `agent`（用 `install -o agent`），
   否则每次调用都以 `os error 13` 失败。

## 构建

```sh
# 本机（Apple Silicon）
docker build -f deploy/sandbox/Dockerfile -t wiwana/sandbox:0.1.0 .

# 生产（x86_64）
docker buildx build --platform linux/amd64 -f deploy/sandbox/Dockerfile -t wiwana/sandbox:0.1.0 --push .
```
