# Capability packs（能力包）

每个能力包 = dsh 技能（`SKILL.md`）+ 可执行脚本 + 产物约定。控制面按任务类型选择能力包
（`apps/control/src/runtime/provider.ts` 的 `capabilityPacksForTask`），运行时智能体在沙箱内调用对应脚本，
产出的文件由控制面登记为交付物。

| 能力包 | 任务类型 | 脚本 | 产出 |
|---|---|---|---|
| `office` | office / data | `scripts/make_docx.py` `make_xlsx.py` `make_pptx.py` `make_pdf.py` | .docx .xlsx .pptx .pdf |
| `data` | data | `scripts/chart.py` | .png/.svg 图表 + .csv |
| `web` | web | 运行时内置静态站点模板 | index.html / styles.css / app.js |
| `media` | media | `scripts/generate_image.py` `generate_video.py` `generate_music.py` | .png .mp4 .mp3 |
| `research` | research | dsh web 工具 + 并行子智能体（M4/M5） | 报告文档 |

## 依赖

沙箱镜像（`deploy/sandbox/Dockerfile`）安装全部依赖：`python-docx`、`openpyxl`、`python-pptx`、
`reportlab`、`matplotlib`、`pandas`、中文字体（思源/Noto CJK）与 LibreOffice。
脚本在依赖缺失时会明确报错退出，运行时智能体会降级为 Markdown 交付物并在时间线里给出告警。

## 模型 API

媒体生成脚本读取环境变量（不在仓库内保存任何密钥）：

- `DASHSCOPE_API_KEY` — 通义万相（图片，`generate_image.py`）
- `KELING_API_KEY` / `KELING_API_BASE` — 可灵（视频，`generate_video.py`）
- `MUSIC_API_KEY` / `MUSIC_API_BASE` — 音乐生成（`generate_music.py`，需商务开通）

## 在 dsh 中使用

`packages/dsh-bundle-wiwana` 的 `cordis.patch.yml` 通过 `customSkillDirs` 把本目录下的技能注册进 dsh，
因此同一个技能既是"给人看的文档"，也是"给模型用的能力"。
