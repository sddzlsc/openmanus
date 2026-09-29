---
name: browser-operator
description: 用无头浏览器打开网页、填表、点击、抓取结构化数据并截图留证（Manus Browser Operator 的等价能力）。
whenToUse: 当任务需要访问真实网页（查资料、登录后抓取、比价、填表、验证上线结果、录屏级留证）时。
metadata:
  pack: browser
  scripts: scripts/browse.py
---

# 浏览器操作能力包

沙箱内已内置 Chromium 与 Playwright（`playwright` CLI 与 Python 包都已安装），无需联网安装。

## 规则

1. **先看再动**：任何交互前先 `--action text` 抓取页面文字，确认页面结构与预期一致。
2. **留证**：关键步骤（登录成功、下单前、抓取结果）都要 `--action screenshot` 截图存到工作区，
   截图文件会被登记为交付物，用户可回看。
3. **抓取结构化数据**：优先用 `--action links` 或 `--action text`，拿到数据后在本地用 pandas 处理，
   不要在浏览器里反复翻页做人工拼接。
4. **合规**：只访问公开页面或用户明确授权的账号；不绕过验证码、不抓取需要登录且未授权的数据。
5. 页面是异步渲染的，脚本默认 `--wait` 等待网络空闲；必要时用 `--selector` 等指定元素出现。

## 脚本用法

```sh
python3 scripts/browse.py --url "https://example.com" --action text
python3 scripts/browse.py --url "https://example.com" --action links --json
python3 scripts/browse.py --url "https://example.com/search?q=x" --action screenshot --out /workspace
python3 scripts/browse.py --url "https://example.com/form" --action fill \
  --selector "#email" --value "a@b.com" --submit
```

可用动作：`text`（正文文本）、`links`（链接清单）、`title`（标题）、`screenshot`（整页截图）、
`click`（`--selector`）、`fill`（`--selector` + `--value`，可配 `--submit`）。
