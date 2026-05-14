# AGENTS.md

## 项目定位

- 这是思源笔记插件 `siyuan-plugin-drawnix`，用于在思源中嵌入 Drawnix 白板，支持白板、思维导图、流程图等内容，并保存为 `SVG` / `PNG` 图片。
- 插件主入口在 `src/index.ts`，样式在 `src/index.scss`，通用工具函数在 `src/utils/`，默认白板数据在 `src/default.json`。
- `drawnix-embed/index.html` 是编辑器 iframe 外壳，负责和插件主线程通过 `postMessage` 通信。
- `drawnix/` 是上游子模块，默认视为外部依赖，不在普通功能迭代中直接修改。

## 目录职责

- `src/index.ts`
  负责插件生命周期、斜杆菜单、图片块菜单、快捷键、设置面板、标签页 / 对话框编辑器、块属性同步、预览标签刷新等主逻辑。
- `src/utils/index.ts`
  负责 Base64、Blob、PNG / SVG metadata、PNG `tEXt` / `pHYs` 处理等底层工具。涉及二次编辑恢复时，优先复用这里的现有函数。
- `src/utils/xmind.ts`
  只负责导出 XMind 可导入的 `OPML` / `Markdown` 文件，不生成原生 `xmind` 包。
- `src/i18n/zh_CN.json` 与 `src/i18n/en_US.json`
  负责设置项和界面文案。新增、删除、重命名 key 时必须双语同步。
- `drawnix-embed/index.html`
  负责 iframe 内的初始化、自动保存、导出、预览导出等消息桥接。消息类型至少包含 `ready`、`init`、`save`、`autosave`、`export`、`export-source`、`export-preview-svg`。
- `vite.config.ts`
  定义开发 / 生产构建行为。`pnpm run dev` 实际是 `vite build --watch`，会把产物写入思源工作空间插件目录；`pnpm build` 输出到 `dist/`，并额外打出 `package.zip`。
- `release.js`
  负责同步 `plugin.json` 和 `package.json` 的版本号，并执行 `git add`、`commit`、`push`、`tag`。除非用户明确要求发布，否则不要主动运行。

## 核心业务约定

- 二次编辑数据以块属性 `custom-drawnix` 为主，同时尽量把同一份数据写入图片 metadata，保证图片复制后仍可恢复编辑。
- 读取已有图片时，优先按现有实现从块属性恢复；块属性缺失时，再回退到图片 metadata。不要改坏这个恢复顺序。
- 新建 Drawnix 图片的默认格式受设置项 `embedImageFormat` 控制，当前默认值是 `png`。
- 编辑器打开方式受设置项 `editWindow` 控制，桌面端支持 `dialog` 和 `tab` 两种模式，当前默认值是 `dialog`。
- 思维导图标签显示受 `labelDisplay` 控制，相关刷新逻辑依赖 `MutationObserver` 和若干 `data-drawnix-*` 属性。调整预览 UI 时，不要随意改这些属性名。
- 斜杆入口当前注册的是 `drawnix`、`白板`、`思维导图`。如果调整入口名称或行为，要同步检查文档与文案。

## 修改边界

- 默认只修改当前任务涉及的文件，避免顺手重构大体量的 `src/index.ts`。
- 默认不要修改 `drawnix/` 子模块，除非任务明确要求同步上游或修复嵌入资源来源。
- 默认不要直接编辑 `drawnix-embed/assets/`、`dist/`、`dev/`、`package.zip` 这类构建产物。
- 如需更新嵌入页资源，应优先修改源头并运行 `pnpm run prepare:drawnix`，只有任务明确要求时才提交生成后的 `drawnix-embed/assets/` 变更。
- 不要覆盖用户或其他工具的未提交改动；如果任务和现有脏改动冲突，先停下并说明冲突。

## 文档与文案同步

- 涉及设置项、菜单、按钮、提示文案时，同步更新 `src/i18n/zh_CN.json` 和 `src/i18n/en_US.json`。
- 涉及用户可见功能、使用方式、导出行为、编辑入口变化时，同步更新 `README.md` 和 `README_EN.md`。
- `plugin.json` 中维护了插件名称、说明、最小版本和 README 映射；如果变更会影响集市展示信息，记得同步更新这里。
- 版本号改动需要保持 `plugin.json` 与 `package.json` 一致；仓库已有 `release.js` 负责这件事，不要只改其中一个文件。

## 代码风格

- 遵循现有 TypeScript 风格：`2` 空格缩进、单引号、尽量沿用当前 import 排序与命名方式。
- 优先复用已有的 `fetchPost`、`fetchSyncPost`、`openTab`、metadata 工具函数和 XMind 导出工具，不要重复造轮子。
- `src/index.ts` 已经较大，新增逻辑时优先提炼小型私有方法或复用 `src/utils/`，避免在同一方法里继续堆叠分支。
- 仅在确实有助于理解时添加简短注释，不写解释显而易见语句的注释。

## 构建与验证

- 本地开发前需在 `.env` 中设置 `VITE_SIYUAN_WORKSPACE_PATH`，然后运行 `pnpm run dev`。
- 生产构建使用 `pnpm build`。
- 仓库当前没有现成的自动化测试目录；默认把 `pnpm build` 视为最基本的回归检查。
- 如果改动涉及 metadata、导出、设置面板、标签页 / 对话框切换等高风险路径，除了构建外，应尽量说明是否做了对应的手工验证。

## 协作约定

- 默认使用简体中文回复，中英文和数字之间加空格。
- 先用 `rg` 查现有实现，至少参考几个相近片段后再落改动，优先匹配项目已有模式。
- Git 操作只处理当前任务直接产出的文件，避免把无关改动一起提交。
