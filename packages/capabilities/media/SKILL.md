---
name: media-generation
description: 图像、视频、音乐生成交付物，调用国内厂商 API 并保存为可下载文件。
whenToUse: 当任务要求生成图片、海报、封面、Logo 概念、短视频或音乐时。
metadata:
  pack: media
  scripts: scripts/generate_image.py, scripts/generate_video.py, scripts/generate_music.py
---

# 媒体生成能力包

## 规则

1. **先确认提示词**：把用户的自然语言改写成结构化提示词（主体 + 场景 + 风格 + 构图 + 光线 + 画幅），改写结果要先在时间线里展示。
2. 一次任务默认只生成 1–2 张候选图，避免浪费额度；用户满意后再扩展。
3. 涉及真实人物、品牌商标、敏感内容一律拒绝并说明原因。
4. 生成结果必须落盘成文件（.png/.mp4/.mp3）再登记为交付物，不允许只返回 URL。
5. 视频与音乐是分钟级异步任务：先创建任务、显示进度、轮询到完成后再登记交付物。

## 脚本用法

```sh
python3 scripts/generate_image.py --prompt "咖啡品牌海报，暖色调" --out /workspace
python3 scripts/generate_video.py --prompt "30 秒产品广告，科技感" --out /workspace
python3 scripts/generate_music.py  --prompt "轻快的企业宣传背景音乐" --out /workspace
```

密钥全部来自环境变量（`DASHSCOPE_API_KEY`、`KELING_API_KEY`、`MUSIC_API_KEY`），缺失时脚本以非 0 退出并给出可读原因。
