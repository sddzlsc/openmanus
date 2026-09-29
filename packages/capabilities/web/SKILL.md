---
name: web-builder
description: 生成可预览、可分享的网页与落地页（静态站点，HMR/刷新即时可见）。
whenToUse: 当任务要求做网站、落地页、活动页、个人主页或简单 Web 应用时。
metadata:
  pack: web
---

# 网站生成能力包

## 规则

1. 产物必须是**可直接打开的静态站点**：`index.html` + `styles.css` + `app.js`，不引入需要构建的框架（M2 之后可升级到 Vite 模板）。
2. 移动端优先：所有布局在 375px 宽度下不得横向滚动。
3. 中文排版：正文字号 ≥ 15px，行高 ≥ 1.6，使用系统字体栈（`PingFang SC` / `Microsoft YaHei`）。
4. 每个页面必须有明确的主行动按钮（CTA），表单提交要有本地反馈，不允许出现空白占位。
5. 交付后把 `index.html` 登记为 `website` 类型交付物，用户即可拿到分享链接。

## 产出

- `index.html`（website）
- `styles.css` / `app.js`（code）
