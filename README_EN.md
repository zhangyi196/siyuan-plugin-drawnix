# siyuan-plugin-drawnix

Drawnix whiteboard plugin for SiYuan Notes. It supports whiteboards, mind maps, flowcharts, and saves content as `SVG` / `PNG` images.

## Features

- Create a Drawnix canvas from `/drawnix`, `/whiteboard`, or `/mindmap`.
- Reopen saved images for further editing.
- Restore editing data from embedded image metadata after copying the image block to another location.
- Open the editor in a dialog or a tab.
- Export the current board as XMind-importable `OPML` or `Markdown`.
- Show the main mind-map branch name at the top-left of the outer block UI.

## Usage

Use `/drawnix`, `/whiteboard`, or `/mindmap` from the slash menu to create a canvas. Press `Ctrl+S` to save. The plugin stores board data in both the block attribute and the image metadata so later edits and copied blocks can still be restored.

The XMind export entry is in the editor toolbar. Choose `OPML` or `Markdown`, then import the downloaded file in XMind through `File > Import`.

> Note: secondary editing is no longer possible if both the embedded image metadata and the `custom-drawnix` block attribute are removed.

## Local Testing

1. Run `pnpm install`.
2. Run `pnpm run prepare:drawnix` if you need to refresh embedded Drawnix assets.
3. Set `VITE_SIYUAN_WORKSPACE_PATH=<your SiYuan workspace path>` in `.env`.
4. Run `pnpm run dev`.
5. Reload the plugin in SiYuan and test.

## Build

```bash
pnpm build
```

## Credits

- [Drawnix](https://github.com/plait-board/drawnix)
- [siyuan-embed-excalidraw](https://github.com/YuxinZhaozyx/siyuan-embed-excalidraw)
