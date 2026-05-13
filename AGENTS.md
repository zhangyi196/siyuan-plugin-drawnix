# AGENTS.md

## 项目
- 这是思源笔记插件 `siyuan-plugin-drawnix`，主逻辑在 `src/index.ts`，样式在 `src/index.scss`，工具函数在 `src/utils/`。
- `drawnix-embed/` 是 iframe 内使用的 Drawnix 页面；`drawnix/` 是上游子模块。

## 修改约束
- 默认使用简体中文回复，中英文和数字之间加空格。
- 先用 `rg` 查现有实现，优先复用已有模式，只改当前任务涉及的文件。
- 不覆盖用户或其他工具的未提交改动。
- 默认不要改 `drawnix/` 子模块和 `drawnix-embed/assets/` 构建产物，除非任务明确要求。

## 关键约定
- 二次编辑数据以块属性 `custom-drawnix` 为主，同时会尽量从图片内嵌 metadata 恢复，保证复制后的图片仍可继续编辑。
- XMind 导出只生成供 XMind 导入的 `OPML` / `Markdown` 文件，相关逻辑在 `src/utils/xmind.ts`。
- 涉及设置项或文案时，同步更新 `src/i18n/zh_CN.json` 和 `src/i18n/en_US.json`。

## 构建
- 本地开发：配置 `.env` 中的 `VITE_SIYUAN_WORKSPACE_PATH` 后运行 `pnpm run dev`。
- 生产构建：运行 `pnpm build`。
- 如需同步 Drawnix 嵌入资源，运行 `pnpm run prepare:drawnix`。
