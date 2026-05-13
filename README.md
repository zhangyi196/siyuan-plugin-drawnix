# siyuan-plugin-drawnix

思源笔记中的 Drawnix 白板插件，支持白板、思维导图、流程图等绘制，并保存为 `SVG` / `PNG` 图片。

## 功能

- 通过 `/drawnix`、`/白板`、`/思维导图` 快速创建 Drawnix 画布。
- 保存为图片后仍可二次编辑。
- 图片复制到其他位置后，会优先从图片内嵌 metadata 恢复编辑数据，继续编辑。
- 编辑器支持在对话框或标签页中打开。
- 支持导出为 XMind 可导入的 `OPML` / `Markdown` 文件。
- 思维导图块左上角会显示主分支名称，便于在文档中识别。

## 使用

斜杆菜单输入 `/drawnix`、`/白板` 或 `/思维导图`，选择 Drawnix 后会自动创建图片并打开编辑器。编辑完成后按 `Ctrl+S` 保存，插件会把画布数据写入块属性和图片 metadata，用于后续二次编辑与复制恢复。

XMind 导出入口位于编辑器工具栏，选择 `OPML` 或 `Markdown` 后，可在 XMind 中通过 `File > Import` 导入。

> 注意：如果图片 metadata 和块属性 `custom-drawnix` 都被移除，则无法继续二次编辑。

<img alt="drawnix editor" src="https://fastly.jsdelivr.net/gh/Achuan-2/PicBed@pic/assets/image-20251204211359-0dgyxrh.png" />

<img alt="drawnix settings" src="https://fastly.jsdelivr.net/gh/Achuan-2/PicBed@pic/assets/image-20251204212438-8ywm730.png" />

## 本地测试

1. 运行 `pnpm install`。
2. 如需同步 Drawnix 嵌入资源，运行 `pnpm run prepare:drawnix`。
3. 在 `.env` 中设置 `VITE_SIYUAN_WORKSPACE_PATH=<你的思源工作空间路径>`。
4. 运行 `pnpm run dev`，产物会写入思源工作空间的 `data/plugins/siyuan-plugin-drawnix`。
5. 回到思源插件管理，重载插件后测试。

## 构建

```bash
pnpm build
```

## 致谢

- [Drawnix](https://github.com/plait-board/drawnix)
- [siyuan-embed-excalidraw](https://github.com/YuxinZhaozyx/siyuan-embed-excalidraw)
