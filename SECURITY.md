# Security Policy

## 绝不提交凭据

仓库中**不允许出现任何真实凭据**。所有密钥、令牌、商户资料、服务器口令都放在被忽略的 `.env`（见 `.gitignore`）。

提交前请至少确认：

```sh
git status --porcelain -uall | grep -E '\.env|certs/|letsencrypt/|data/'   # 应无输出
git diff --cached | grep -Ei 'sk-|LTAI|api[_-]?key|password|secret'       # 应无真实值
```

如不慎提交：立即在对应平台**轮换该凭据**，再用 `git filter-repo` 清理历史（仅删除文件不够，历史里仍然存在）。

## 部署侧要点

- 沙箱容器：非特权用户、`CapDrop: ALL`、`no-new-privileges`、CPU/内存/PID 限额。
- 必须封禁沙箱到云元数据（`100.100.100.200`、`169.254.169.254`）与控制面网段的访问。
- dsh 只在内网/回环可达；控制面必须由反向代理前置并启用 HTTPS。
- 单机起步时控制面持有 Docker socket，等同于宿主机 root：请限制该主机的外部访问面。

## 报告漏洞

请通过 GitHub Security Advisory（仓库 → Security → Report a vulnerability）私下报告，
或在 Issues 中提交不含敏感细节的描述。我们会尽快响应。
