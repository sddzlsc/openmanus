---
name: office-deliverables
description: 生成 Office 交付物（Word 文档、Excel 表格、PPT 演示、PDF），需要中文字体与排版规范。
whenToUse: 当任务要求产出报告、表格、幻灯片、合同、方案、报价单等办公文件时。
metadata:
  pack: office
  scripts: scripts/make_docx.py, scripts/make_xlsx.py, scripts/make_pptx.py, scripts/make_pdf.py
---

# Office 交付物能力包

## 规则

1. 先明确交付物清单（几个文件、分别是什么），再动手生成，避免一次堆砌大量文件。
2. 统一使用中文字体栈：正文 `Noto Sans CJK SC` / `PingFang SC` / `Microsoft YaHei`，标题加粗。
3. 文档结构固定为：标题 → 摘要 → 正文（分章节）→ 结论与建议 →（可选）附录。
4. 表格必须带表头、单位与数据来源说明；数字右对齐。
5. 演示文稿每页只讲一个观点，标题不超过 20 字，正文用要点而非长句。
6. 交付前必须跑一次 `scripts/make_pdf.py` 导出 PDF，作为最容易被打开的预览形态。

## 脚本用法

```sh
python3 scripts/make_docx.py --title "标题" --prompt "用户原始需求" --out /workspace
python3 scripts/make_xlsx.py --title "标题" --prompt "用户原始需求" --out /workspace
python3 scripts/make_pptx.py --title "标题" --prompt "用户原始需求" --out /workspace
python3 scripts/make_pdf.py  --title "标题" --prompt "用户原始需求" --out /workspace
python3 scripts/check_pptx.py --file /workspace/deck.pptx            # 交付前必须通过
python3 scripts/fix_pptx_overflow.py --file deck.pptx               # ① 修溢出：软化圆角、撑高色块、微调字号
python3 scripts/polish_pptx_layout.py --file deck-fixed.pptx        # ② 构图：文案组在色块内水平+垂直居中
python3 scripts/check_pptx.py --file deck-polished.pptx             # ③ 复检：0 问题才算完成
```

脚本退出码非 0 表示依赖缺失或参数错误，此时应在时间线里报告原因，并降级为 Markdown 交付物。

### PPT 的硬性规则（曾经出过"字出格"）

**设计优先，工具兜底**——不要用模板把有设计的稿子推倒重做：

1. **按设计做稿**：一份 PPT 要有版式语言（左侧色条、卡片、色块、页码、栏目结构），
   而不是把内容摊成一张张纯文字卡片。`make_pptx.py` 只是"从零起步"的兜底模板，
   它的观感很基础，不要用它重排已有设计稿。
2. **交付前必须校验**：`check_pptx.py --file <deck>` 必须退出码为 0。
   该检查器按"中文字宽≈字号、英文≈0.55×、行高≈1.22×"估算每个文本框所需高度。
3. **发现溢出先修设计稿，不要重做**：`fix_pptx_overflow.py` 在**保留原有几何与配色**的前提下，
   先把 60%–80% 的夸张圆角收成 20%（文字才有矩形安全区），再撑高色块与文本框，最后才在 72%
   底线内缩字号并写入真实 `normAutofit fontScale`。
4. **构图必须居中**：`polish_pptx_layout.py` 把每个色块内的文案当成一组，
   在整个色块的**安全区内水平+垂直居中**（左右、上下边距相等），组内左对齐关系保持不变；
   若色块不足以容纳并留白，先向下撑高色块再居中。
5. 三步顺序固定：`fix_pptx_overflow.py` → `polish_pptx_layout.py` → `check_pptx.py`，
   最后一步必须 0 问题。
6. **按既有内容重排**（例如把模型自己写的 XML 稿换成合规版式）时，用
   `make_pptx.py --content slides.json`，传入
   `[{"title":…,"subtitle":…,"bullets":[{"title":…,"body":…}]}]`，不要让模型改写文案。
7. 字体统一 `Noto Sans CJK SC`（沙箱内置）并同时声明 `a:latin / a:ea / a:cs`，
   避免换机器后字体替换导致重新换行、再次溢出。
