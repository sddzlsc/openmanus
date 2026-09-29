---
name: vision-inspection
description: 用国产多模态模型（通义千问 VL）看懂图片与截图：视觉自检、界面评审、图片内容提取。
whenToUse: 当任务产出网页/PPT/海报后需要自检观感，或用户上传了图片/截图需要理解时。
metadata:
  pack: vision
  scripts: scripts/describe_image.py
---

# 视觉理解与自检能力包

模型：`qwen-vl-max`（阿里云百炼，OpenAI 兼容接口）；密钥来自环境变量 `DASHSCOPE_API_KEY`。

## 规则

1. **产出即自检**：做完网页、落地页、PPT、海报后，先截图（浏览器包 `--action screenshot`，
   PPT 用 `libreoffice --headless --convert-to pdf` + `pdftoppm` 转图），再用本能力包检查：
   文字是否溢出背景块、元素是否重叠、配色是否对比不足、移动端是否横向滚动。
2. **先看再改**：把检查结论写进时间线（"视觉自检：发现 2 处问题"），再动手修，
   修完重新截图复检，直到没有阻断性问题。
3. **用户图片**：用户上传的图片先描述清楚内容与文字，再执行任务；不要凭文件名猜内容。
4. **不确定就说不确定**：模型看不清的细节（小字、模糊区域）要显式标注"无法确认"，不许编造。
5. 每次自检最多挑 **3 个最严重的问题**来修，避免无限打磨。

## 脚本用法

```sh
# 检查一张截图
python3 scripts/describe_image.py --image /workspace/shot.png \
  --prompt "这是网页截图。找出排版问题：文字是否超出色块、元素是否重叠、对比度是否足够。按严重程度排序，最多 5 条。"

# 多图对比（修改前后）
python3 scripts/describe_image.py --image before.png --image after.png \
  --prompt "对比两张截图，说明第二张修复了哪些问题。"

# 把结论落盘（会成为交付物）
python3 scripts/describe_image.py --image shot.png --prompt "描述这张图" --out /workspace/vision-report.md
```
