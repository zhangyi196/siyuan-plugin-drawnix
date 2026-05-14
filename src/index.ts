import {
  Dialog,
  Plugin,
  getFrontend,
  fetchPost,
  fetchSyncPost,
  IWebSocketData,
  getAllEditor,
  openTab,
  getAllModels,
  Custom,
} from "siyuan";
import "@/index.scss";
import PluginInfoString from '@/../plugin.json';
import {
  getImageSizeFromBase64,
  locatePNGtEXt,
  insertPNGpHYs,
  replaceSubArray,
  arrayToBase64,
  base64ToArray,
  base64ToUnicode,
  unicodeToBase64,
  blobToDataURL,
  dataURLToBlob,
  embedDrawnixMetadata,
  extractDrawnixMetadata,
  HTMLToElement,
} from "./utils";
import { matchHotKey } from "./utils/hotkey";
import {
  buildXmindImportFile,
  extractFlatTopics,
  type XmindImportFormat,
} from "./utils/xmind";
import defaultImageContent from "@/default.json";



let PluginInfo = {
  version: '',
}
try {
  PluginInfo = PluginInfoString
} catch (err) {
  console.log('Plugin info parse error: ', err)
}
const {
  version,
} = PluginInfo

const STORAGE_NAME = "config.json";
const DRAWNIX_PREVIEW_BLOCK_ATTR = "data-drawnix-preview-block";
const DRAWNIX_NATIVE_RESIZE_ATTR = "data-drawnix-native-resize";
const DRAWNIX_NATIVE_ACTION_ATTR = "data-drawnix-native-action";
const DRAWNIX_PREVIEW_INSET = 8;
const DRAWNIX_PREVIEW_TOOLBAR_GAP = 8;

// Type definitions
interface DrawnixImageInfo {
  blockID: string;
  imageURL: string;
  data: string; // Base64 encoded image data
  format: 'svg' | 'png';
  drawnixData?: string; // JSON string of drawnix board data
}

type SyFrontendTypes = 'desktop' | 'desktop-window' | 'mobile' | 'browser' | 'browser-desktop' | 'browser-mobile';

interface SettingItem {
  title: string;
  description?: string;
  direction?: 'row' | 'column';
  actionElement?: HTMLElement;
  createActionElement?: () => HTMLElement;
}


export default class DrawnixPlugin extends Plugin {
  // Run as mobile
  public isMobile: boolean
  // Run in browser
  public isBrowser: boolean
  // Run as local
  public isLocal: boolean
  // Run in Electron
  public isElectron: boolean
  // Run in window
  public isInWindow: boolean
  public platform: SyFrontendTypes
  public readonly version = version

  private _mutationObserver;
  private _openMenuImageHandler;
  private _globalKeyDownHandler;
  private _mouseOverHandler;
  private _drawnixPreviewDragStartHandler;
  private _drawnixPreviewPointerDownHandler;
  private _drawnixPreviewMouseDownHandler;
  private isMouseOverProcessing = false;
  private fullLabelRefreshTimer: number | null = null;

  private settingItems: SettingItem[];
  public EDIT_TAB_TYPE = "drawnix-edit-tab";

  /**
   * Push notification to SiYuan using the built-in API: /api/notification/pushMsg
   * @param msg message content
   * @param timeout display timeout in ms, default 7000
   */


  async onload() {
    this.initMetaInfo();
    await this.initSetting();

    this._mutationObserver = this.setAddImageBlockMuatationObserver(document.body, () => {
      this.scheduleFullDrawnixLabelRefresh();
    });
    this.scheduleFullDrawnixLabelRefresh(0);

    this.setupEditTab();

    this.protyleSlash = [{
      filter: ["drawnix", "白板","思维导图"],
      id: "drawnix",
      html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconImage"></use></svg><span class="b3-list-item__text">Drawnix</span></div>`,
      callback: (protyle, nodeElement) => {
        this.newDrawnixImage(protyle, nodeElement.dataset.nodeId, (imageInfo) => {
          if (!this.isMobile && this.data[STORAGE_NAME].editWindow === 'tab') {
            this.openEditTab(imageInfo);
          } else {
            this.openEditDialog(imageInfo);
          }
        });
      },
    }];

    this._openMenuImageHandler = this.openMenuImageHandler.bind(this);
    this.eventBus.on("open-menu-image", this._openMenuImageHandler);

    this._globalKeyDownHandler = this.globalKeyDownHandler.bind(this);
    document.documentElement.addEventListener("keydown", this._globalKeyDownHandler);

    this._mouseOverHandler = this.mouseOverHandler.bind(this);
    document.addEventListener("mouseover", this._mouseOverHandler);

    this._drawnixPreviewDragStartHandler = this.drawnixPreviewDragStartHandler.bind(this);
    document.addEventListener("dragstart", this._drawnixPreviewDragStartHandler, true);

    this._drawnixPreviewPointerDownHandler = this.drawnixPreviewPointerDownHandler.bind(this);
    document.addEventListener("pointerdown", this._drawnixPreviewPointerDownHandler, true);

    this._drawnixPreviewMouseDownHandler = this.drawnixPreviewMouseDownHandler.bind(this);
    document.addEventListener("mousedown", this._drawnixPreviewMouseDownHandler, true);

    this.reloadAllEditor();
  }

  onunload() {
    if (this._mutationObserver) this._mutationObserver.disconnect();
    if (this._openMenuImageHandler) this.eventBus.off("open-menu-image", this._openMenuImageHandler);
    if (this._globalKeyDownHandler) document.documentElement.removeEventListener("keydown", this._globalKeyDownHandler);
    if (this._mouseOverHandler) document.removeEventListener("mouseover", this._mouseOverHandler);
    if (this._drawnixPreviewDragStartHandler) document.removeEventListener("dragstart", this._drawnixPreviewDragStartHandler, true);
    if (this._drawnixPreviewPointerDownHandler) document.removeEventListener("pointerdown", this._drawnixPreviewPointerDownHandler, true);
    if (this._drawnixPreviewMouseDownHandler) document.removeEventListener("mousedown", this._drawnixPreviewMouseDownHandler, true);
    this.reloadAllEditor();
    this.removeAllDrawnixTab();
  }

  uninstall() {
    this.removeData(STORAGE_NAME);
  }

  openSetting() {
    const dialogHTML = `
<div class="b3-dialog__content"></div>
<div class="b3-dialog__action">
  <button class="b3-button b3-button--cancel" data-type="cancel">${window.siyuan.languages.cancel}</button>
  <div class="fn__space"></div>
  <button class="b3-button b3-button--text" data-type="confirm">${window.siyuan.languages.save}</button>
</div>
    `;

    const dialog = new Dialog({
      title: this.displayName,
      content: dialogHTML,
      width: this.isMobile ? "92vw" : "768px",
      height: "80vh",
      hideCloseIcon: this.isMobile,
    });

    // 配置的处理拷贝自思源源码
    const contentElement = dialog.element.querySelector(".b3-dialog__content");
    this.settingItems.forEach((item) => {
      let html = "";
      let actionElement = item.actionElement;
      if (!item.actionElement && item.createActionElement) {
        actionElement = item.createActionElement();
      }
      const tagName = actionElement?.classList.contains("b3-switch") ? "label" : "div";
      if (typeof item.direction === "undefined") {
        item.direction = (!actionElement || "TEXTAREA" === actionElement.tagName) ? "row" : "column";
      }
      if (item.direction === "row") {
        html = `<${tagName} class="b3-label">
    <div class="fn__block">
        ${item.title}
        ${item.description ? `<div class="b3-label__text">${item.description}</div>` : ""}
        <div class="fn__hr"></div>
    </div>
</${tagName}>`;
      } else {
        html = `<${tagName} class="fn__flex b3-label config__item">
    <div class="fn__flex-1">
        ${item.title}
        ${item.description ? `<div class="b3-label__text">${item.description}</div>` : ""}
    </div>
    <span class="fn__space${actionElement ? "" : " fn__none"}"></span>
</${tagName}>`;
      }
      contentElement.insertAdjacentHTML("beforeend", html);
      if (actionElement) {
        if (["INPUT", "TEXTAREA"].includes(actionElement.tagName)) {
          dialog.bindInput(actionElement as HTMLInputElement, () => {
            (dialog.element.querySelector(".b3-dialog__action [data-type='confirm']") as HTMLElement).dispatchEvent(new CustomEvent("click"));
          });
        }
        if (item.direction === "row") {
          contentElement.lastElementChild.lastElementChild.insertAdjacentElement("beforeend", actionElement);
          actionElement.classList.add("fn__block");
        } else {
          actionElement.classList.remove("fn__block");
          actionElement.classList.add("fn__flex-center", "fn__size200");
          contentElement.lastElementChild.insertAdjacentElement("beforeend", actionElement);
        }
      }
    });

    (dialog.element.querySelector(".b3-dialog__action [data-type='cancel']") as HTMLElement).addEventListener("click", () => {
      dialog.destroy();
    });
    (dialog.element.querySelector(".b3-dialog__action [data-type='confirm']") as HTMLElement).addEventListener("click", () => {
      this.data[STORAGE_NAME].labelDisplay = (dialog.element.querySelector("[data-type='labelDisplay']") as HTMLSelectElement).value;
      this.data[STORAGE_NAME].embedImageFormat = (dialog.element.querySelector("[data-type='embedImageFormat']") as HTMLSelectElement).value;
      this.data[STORAGE_NAME].editWindow = (dialog.element.querySelector("[data-type='editWindow']") as HTMLSelectElement).value;
      this.saveData(STORAGE_NAME, this.data[STORAGE_NAME]);
      this.scheduleFullDrawnixLabelRefresh(0);
      this.reloadAllEditor();
      this.removeAllDrawnixTab();
      dialog.destroy();
    });
  }

  private async initSetting() {
    await this.loadData(STORAGE_NAME);
    if (!this.data[STORAGE_NAME]) this.data[STORAGE_NAME] = {};
    if (typeof this.data[STORAGE_NAME].labelDisplay === 'undefined') this.data[STORAGE_NAME].labelDisplay = "showLabelAlways";
    if (typeof this.data[STORAGE_NAME].embedImageFormat === 'undefined') this.data[STORAGE_NAME].embedImageFormat = "png";
    if (typeof this.data[STORAGE_NAME].editWindow === 'undefined') this.data[STORAGE_NAME].editWindow = 'dialog';

    this.settingItems = [
      {
        title: this.i18n.labelDisplay,
        direction: "column",
        description: this.i18n.labelDisplayDescription,
        createActionElement: () => {
          const options = ["noLabel", "showLabelAlways", "showLabelOnHover"];
          const optionsHTML = options.map(option => {
            const isSelected = String(option) === String(this.data[STORAGE_NAME].labelDisplay);
            return `<option value="${option}"${isSelected ? " selected" : ""}>${this.i18n[option]}</option>`;
          }).join("");
          return HTMLToElement(`<select class="b3-select fn__flex-center" data-type="labelDisplay">${optionsHTML}</select>`);
        },
      },
      {
        title: this.i18n.embedImageFormat,
        direction: "column",
        description: this.i18n.embedImageFormatDescription,
        createActionElement: () => {
          const options = ["svg", "png"];
          const optionsHTML = options.map(option => {
            const isSelected = String(option) === String(this.data[STORAGE_NAME].embedImageFormat);
            return `<option value="${option}"${isSelected ? " selected" : ""}>${option}</option>`;
          }).join("");
          return HTMLToElement(`<select class="b3-select fn__flex-center" data-type="embedImageFormat">${optionsHTML}</select>`);
        },
      },
      {
        title: this.i18n.editWindow,
        direction: "column",
        description: this.i18n.editWindowDescription,
        createActionElement: () => {
          const options = ["dialog", "tab"];
          const optionsHTML = options.map(option => {
            const isSelected = String(option) === String(this.data[STORAGE_NAME].editWindow);
            return `<option value="${option}"${isSelected ? " selected" : ""}>${option}</option>`;
          }).join("");
          return HTMLToElement(`<select class="b3-select fn__flex-center" data-type="editWindow">${optionsHTML}</select>`);
        },
      },
    ];
  }

  private initMetaInfo() {
    const frontEnd = getFrontend();
    this.platform = frontEnd as SyFrontendTypes
    this.isMobile = frontEnd === "mobile" || frontEnd === "browser-mobile";
    this.isBrowser = frontEnd.includes('browser');
    this.isLocal = location.href.includes('127.0.0.1') || location.href.includes('localhost');
    this.isInWindow = location.href.includes('window.html');

    try {
      require("@electron/remote")
        .require("@electron/remote/main");
      this.isElectron = true;
    } catch (err) {
      this.isElectron = false;
    }
  }

  public setAddImageBlockMuatationObserver(element: HTMLElement, callback: () => void): MutationObserver {
    const mutationObserver = new MutationObserver(mutations => {
      const isRelevantElement = (elementNode: Element) => {
        return elementNode.matches("div[data-type='NodeParagraph'], .img[data-type='img'], img")
          || !!elementNode.querySelector("div[data-type='NodeParagraph'], .img[data-type='img'], img");
      };

      const hasRelevantMutation = mutations.some((mutation) => {
        if (mutation.type === 'attributes') {
          if (!(mutation.target instanceof Element)) {
            return false;
          }

          if (mutation.attributeName === 'custom-drawnix') {
            return mutation.target.matches("div[data-type='NodeParagraph']");
          }

          return mutation.target.matches(".img[data-type='img'], img");
        }

        if (!(mutation.target instanceof Element) || !mutation.target.closest("div[data-type='NodeParagraph']")) {
          return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
            return node instanceof Element && isRelevantElement(node);
          });
        }

        return true;
      });

      if (hasRelevantMutation) {
        callback();
      }
    });

    mutationObserver.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-src", "src", "custom-drawnix", "style", "width", "height"],
    });

    return mutationObserver;
  }

  private isDrawnixAssetURL(imageURL: string): boolean {
    return /^assets\/drawnix-image-.+\.(?:svg|png)$/i.test(imageURL || '');
  }

  public async getDrawnixImageInfo(imageURL: string, blockElement?: HTMLElement): Promise<DrawnixImageInfo | null> {
    const imageURLRegex = /^assets\/.+\.(?:svg|png)$/;
    if (!imageURLRegex.test(imageURL)) return null;

    let blockID = '';
    let drawnixData = '';

    if (blockElement) {
      blockID = blockElement.getAttribute("data-node-id");
      drawnixData = blockElement.getAttribute("custom-drawnix");
    } else {
      const imageElement = document.querySelector(`img[data-src="${imageURL}"]`);
      if (imageElement) {
        blockElement = imageElement.closest('[data-node-id]') as HTMLElement;
        if (blockElement) {
          blockID = blockElement.getAttribute("data-node-id");
          drawnixData = blockElement.getAttribute("custom-drawnix");
        }
      }
    }

    if (!blockID) return null;

    const imageContent = await this.getDrawnixImage(imageURL, true);
    if (!imageContent) return null;

    // If we didn't find drawnix data in DOM, try API (fallback)
    if (!drawnixData) {
      const customAttr = await this.getBlockAttrs(blockID);
      if (customAttr) {
        drawnixData = customAttr['custom-drawnix'];
      }
    }

    if (!drawnixData) {
      drawnixData = extractDrawnixMetadata(imageContent) || '';
      if (drawnixData && blockID) {
        try {
          await fetchSyncPost('/api/attr/setBlockAttrs', { id: blockID, attrs: { 'custom-drawnix': drawnixData } });
        } catch (err) {
          console.error('Failed to restore drawnix metadata from image', err);
        }
      }
    }

    if (!drawnixData) return null;

    const imageInfo: DrawnixImageInfo = {
      blockID: blockID,
      imageURL: imageURL,
      data: imageContent,
      format: imageURL.endsWith(".svg") ? "svg" : "png",
      drawnixData: drawnixData,
    }
    return imageInfo;
  }

  public getPlaceholderImageContent(format: 'svg' | 'png'): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="270" height="183"><rect width="100%" height="100%" fill="#ffffff"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="16" fill="#888">Drawnix</text></svg>`;
    const base64 = unicodeToBase64(svg);
    if (format === 'svg') return `data:image/svg+xml;base64,${base64}`;
    if (format === 'png') return `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQ4AAAC3CAYAAADjA7CsAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAH3UlEQVR4nO3ay09T6xrH8V+5lQKtFWqLlYIJhJioAWswBtQBA0cGvCRbxbH/mYoyUuPEmBgNiBcgEgmxSlUugpUWLPWyiLR0D3ZswuGc7XmCbtJzvp/hYnX1YZF8ed/VuvL5fF4AYFCy3QMAKD6EA4AZ4QBgRjgAmBEOAGaEA4AZ4QBgRjgAmBEOAGaEA4AZ4QBgRjgAmBEOAGaEA4AZ4QBgRjgAmBEOAGaEA4AZ4QBgRjgAmBEOAGaEA4AZ4QBgRjgAmBEOAGaEA4AZ4QBgRjgAmBEOAGaEA4AZ4QBgRjgAmBEOAGaEA4AZ4QBgRjgAmBEOAGaEA4AZ4QBgRjgAmBEOAGaEA4AZ4QBgRjgAmBEOAGaEA4AZ4QBgRjgAmBEOAGaEA4AZ4QBgRjgAmBEOAGaEA4AZ4QBgRjgAmBEOAGaEA4AZ4QBgRjgAmBEOAGaEA4AZ4QBgRjgAmBEOAGaEA4AZ4QBgRjgAmBEOAGaEA4AZ4QBgRjgAmBEOAGaEA4AZ4QBgRjgAmBEOAGaEA4AZ4QBgRjgAmBEOAGaEA4AZ4QBgVrbdA+DnHMdRf3+/kslk4VhpaamCwaC6u7vV0NCwjdP9XC6X061bt/Tu3Tt1d3fr0KFD2z0StohwFBGPx6Oenh55vV7F43GNjo6qv79fXV1d6uzs3O7x8H+EcBQRl8sln8+n2tpa1dXVqbW1VdevX9ezZ88UiUQUiUS2e8R/q7S0VGfPnt3uMfALEY4itnPnTkWjUT148ECxWEyRSETLy8u6evWqQqGQQqGQRkdHtWPHDvX19WlmZkZPnjxRKpXS+vq63G63Ojs7deTIES0tLenatWvy+Xy6ePGiKioqlE6ndeXKFeVyOV24cEGhUEiS1N/fr1Qqpb6+Pq2srOjmzZvat2+fPB6PJiYmtLq6qkAgoN7eXtXV1UmS7t27p4mJCZ0+fVqhUEgDAwNaWVnRuXPnFIlECtsxx3H0xx9/aNeuXdt5a/ETPBwtcqFQSBUVFUqlUhuOz87OanJyUh0dHTpx4oSy2ayGhoZUU1Oj8+fP69KlS/J6vXr06JFmZ2fl9/tVW1urdDqtT58+SZISiYRWV1e1urqqRCIhScpkMkqn0/L5fPJ6vYX3m5yc1OzsrE6dOqWOjg4tLS3p7t27yuVym2aurq7W8ePHtb6+ruHhYWWzWY2PjyuVSikajRKNIsCKo8j5fD6VlZXJcRw5jlM4Xl5erjNnzmj37t2FY5cvX97w2q6uLt25c0cLCwtqbGxUMBjUwsKCksmkQqGQ5ufnVV5errKyMs3NzamtrU2pVEqO46ilpUUVFRWFazU3N6unp0dlZWVqaGjQ7OysVlZW9PXrV/l8vk1zt7S0qLW1VS9fvtTIyIjGx8dVX1+vaDT6G+4SfjVWHP+jgsHghmj8sL6+rkQioeHhYY2NjSmfz+vz58+SpEgkIpfLpfn5eeVyOSUSCQWDQYVCIS0uLspxHC0uLmp9fX3T8xSv16uysr/+D1VUVMjtdiubzSqbzf7HGY8dO6aamhoNDg5qdXVVnZ2dcrvdv/Au4HdhxVHkMpmMstmsPB6PPB5PYdXhcrk2nfv8+XM9fPhQktTU1KRAIKAPHz4Ufh4Oh1VdXa1EIqFkMqnl5WW1tbUVXpvJZDQ3Nye32/1LthN+v1/hcFixWEyBQEB79+7d8jXxzyAcRS6RSOj79+/as2fP3543NTWl+/fva//+/Tp58qRKSkr09u1bTU5OFs758YnNx48fNT09rWw2q2AwKEnKZrOKx+NaXl5WbW2t/H7/lmePx+N68+ZNIVaxWEwHDhzY8nXx+7FVKWLJZFJjY2OqrKxUc3Pz3547PT0tl8ul1tZWlZT89WfP5/PK5/MbzmtqatLa2pqmp6dVWVmpcDiscDisqqoqxeNxOY6jSCSi0tLSLc3uOI4GBwcL3035sWVJp9Nbui7+GYSjiOTzeWUyGS0tLenp06caGBjQt2/f1NXV9dMVRyAQ0Nraml68eKFkMqnHjx/r9u3bm55B1NfXq6SkRDMzM/L7/fL5fBtWIrlcrrAK2Yrx8XElk0m1t7ersbFRhw8f1pcvXzQ0NLTla+P3Y6tSRBzH0Y0bNyRJJSUlCgaD6u3t/a++cn7w4EG9f/9esVhMr169ks/n09GjRzUyMrLhvEAgoKqqqk3bn6amJk1PT6uqqkrhcHhLv8fi4qLGxsYUCATU3t4uSYpGo5qamtLr168Vj8fV0tKypffA7+XK/+taFQB+gq0KADPCAcCMcAAwIxwAzAgHADPCAcCMcAAwIxwAzAgHADPCAcCMcAAwIxwAzAgHADPCAcCMcAAwIxwAzAgHADPCAcCMcAAwIxwAzAgHADPCAcCMcAAwIxwAzAgHADPCAcCMcAAwIxwAzAgHADPCAcCMcAAwIxwAzAgHADPCAcCMcAAwIxwAzAgHADPCAcCMcAAwIxwAzAgHADPCAcCMcAAwIxwAzAgHADPCAcCMcAAwIxwAzAgHADPCAcCMcAAwIxwAzAgHADPCAcCMcAAwIxwAzAgHADPCAcCMcAAwIxwAzAgHADPCAcCMcAAwIxwAzAgHADPCAcCMcAAwIxwAzAgHADPCAcCMcAAwIxwAzAgHADPCAcCMcAAwIxwAzAgHADPCAcCMcAAwIxwAzAgHADPCAcCMcAAwIxwAzAgHADPCAcDsT2bcBwPurQwmAAAAAElFTkSuQmCC`
    // Fallback: return svg data URL even for png to ensure a valid data URL is returned
    return `data:image/svg+xml;base64,${base64}`;
  }

  public async newDrawnixImage(protyle: any, blockID: string, callback?: (imageInfo: DrawnixImageInfo) => void) {
    const format = this.data[STORAGE_NAME].embedImageFormat;
    const imageName = `drawnix-image-${window.Lute.NewNodeID()}.${format}`;
    const defaultDrawnixData = {
      "type": "drawnix",
      "version": 1,
      "source": "web",
      "children": [

      ],
      "viewport": {
        "zoom": 0.8920378279589448,
        "origination": [
          -345.4451339703334,
          -273.8101350501055
        ]
      }
    };
    const placeholderImageContent = embedDrawnixMetadata(
      this.getPlaceholderImageContent(format),
      JSON.stringify(defaultDrawnixData),
    );
    const blob = dataURLToBlob(placeholderImageContent);
    const file = new File([blob], imageName, { type: blob.type });
    const formData = new FormData();
    formData.append('path', `data/assets/${imageName}`);
    formData.append('file', file);
    formData.append('isDir', 'false');
    await fetchSyncPost('/api/file/putFile', formData);
      const imageURL = `assets/${imageName}`;
      protyle.insert(`![](${imageURL})`);
      // 将初始的 drawnix 数据写入块属性，参考 mindmap 插件的实现方式
      if (blockID) {
        try {
          await fetchSyncPost('/api/attr/setBlockAttrs', { id: blockID, attrs: { 'custom-drawnix': JSON.stringify(defaultDrawnixData) } });
        } catch (err) { }
      }

      const imageInfo: DrawnixImageInfo = {
        blockID: blockID,
        imageURL: imageURL,
        data: placeholderImageContent,
        format: format,
        drawnixData: JSON.stringify(defaultDrawnixData),
      };
      if (callback) {
        callback(imageInfo);
      }
  }

  public async getDrawnixImage(imageURL: string, reload: boolean): Promise<string> {
    const response = await fetch(imageURL, { cache: reload ? 'reload' : 'default' });
    if (!response.ok) return "";
    const blob = await response.blob();
    return await blobToDataURL(blob);
  }



  // Get block attributes
  private async getBlockAttrs(blockId: string): Promise<any> {
    const result = await fetchSyncPost('/api/attr/getBlockAttrs', { id: blockId });
    return result?.data || null;
  }



  public async updateDrawnixImage(imageInfo: DrawnixImageInfo, callback?: (response: IWebSocketData) => void) {
    let imageData = imageInfo.data;
    if (!imageData || imageData.trim() === '') {
      imageData = this.getPlaceholderImageContent(imageInfo.format);
    }
    if (imageInfo.drawnixData) {
      imageData = embedDrawnixMetadata(imageData, imageInfo.drawnixData);
    }

    const blob = dataURLToBlob(imageData);
    const file = new File([blob], imageInfo.imageURL.split('/').pop(), { type: blob.type });
    const formData = new FormData();
    formData.append("path", 'data/' + imageInfo.imageURL);
    formData.append("file", file);
    formData.append("isDir", "false");
    const response = await fetchSyncPost("/api/file/putFile", formData);
      // Save drawnix data to block attributes
      if (imageInfo.drawnixData) {
        try {
          JSON.parse(imageInfo.drawnixData);
          await fetchSyncPost('/api/attr/setBlockAttrs', { id: imageInfo.blockID, attrs: { 'custom-drawnix': imageInfo.drawnixData } });
        } catch (e) {
          console.error("Failed to parse drawnix data", e);
        }
      }
    if (callback) callback(response);
  }

  private getDrawnixDisplayName(imageInfo: DrawnixImageInfo): string {
    if (!imageInfo?.drawnixData) return "Drawnix";

    try {
      const boardData = JSON.parse(imageInfo.drawnixData);
      const firstTopic = extractFlatTopics(boardData)[0];
      return firstTopic || "Drawnix";
    } catch (err) {
      console.error("Failed to parse drawnix display name", err);
      return "Drawnix";
    }
  }

  private getDrawnixPreviewBlock(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    return target.closest(`div[data-type='NodeParagraph'][${DRAWNIX_PREVIEW_BLOCK_ATTR}='true']`) as HTMLElement | null;
  }

  private getDrawnixPreviewContainerFromBlock(blockElement: HTMLElement | null): HTMLDivElement | null {
    if (!blockElement) return null;
    return blockElement.querySelector(".img[data-type='img'][data-drawnix-embed='true']") as HTMLDivElement | null;
  }

  private getDrawnixPreviewContainer(target: EventTarget | null): HTMLDivElement | null {
    const blockElement = this.getDrawnixPreviewBlock(target);
    if (blockElement) {
      return this.getDrawnixPreviewContainerFromBlock(blockElement);
    }

    if (!(target instanceof Element)) return null;
    return target.closest(".img[data-type='img'][data-drawnix-embed='true']") as HTMLDivElement | null;
  }

  private getDrawnixImageURLFromContainer(imgContainer: HTMLDivElement | null): string {
    const imageElement = imgContainer?.querySelector("img") as HTMLImageElement | null;
    return imageElement?.getAttribute("data-src") || imageElement?.getAttribute("src") || "";
  }

  private getDrawnixNativeAction(imgContainer: HTMLDivElement | null): HTMLElement | null {
    return imgContainer?.querySelector(".protyle-action") as HTMLElement | null;
  }

  private getDrawnixNativeMenuTrigger(imgContainer: HTMLDivElement | null): HTMLElement | null {
    const nativeAction = this.getDrawnixNativeAction(imgContainer);
    if (!nativeAction) return null;
    return nativeAction.querySelector(".protyle-icon") as HTMLElement | null;
  }

  private resetDrawnixPreviewElementSize(element: HTMLElement | null) {
    if (!element) return;
    ["width", "height", "min-width", "max-width", "min-height", "max-height"].forEach((property) => {
      element.style.removeProperty(property);
    });
    element.removeAttribute("width");
    element.removeAttribute("height");
  }

  private normalizeDrawnixPreviewContainer(imgContainer: HTMLDivElement) {
    this.resetDrawnixPreviewElementSize(imgContainer);

    const imageElement = imgContainer.querySelector("img") as HTMLImageElement | null;
    this.resetDrawnixPreviewElementSize(imageElement);
    if (imageElement) {
      imageElement.draggable = false;
      imageElement.setAttribute("draggable", "false");
    }
  }

  private getDrawnixToolbarMoreIconHTML(imgContainer: HTMLDivElement | null): string {
    const nativeMenuTrigger = this.getDrawnixNativeMenuTrigger(imgContainer);
    if (nativeMenuTrigger?.innerHTML?.trim()) {
      return nativeMenuTrigger.innerHTML;
    }

    return '<svg class="svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="12" cy="19" r="1.8"></circle></svg>';
  }

  private createDrawnixPreviewToolbarButton(className: string, ariaLabel: string, iconHTML: string) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `protyle-icon protyle-icon--only protyle-custom drawnix-preview-toolbar__button ${className}`;
    button.setAttribute("aria-label", ariaLabel);
    button.title = ariaLabel;
    button.innerHTML = iconHTML;
    return button;
  }

  private openDrawnixEditorForBlock(imageURL: string, blockElement: HTMLElement) {
    if (!imageURL) return;

    this.getDrawnixImageInfo(imageURL, blockElement).then((imageInfo) => {
      if (!imageInfo) return;

      if (!this.isMobile && this.data[STORAGE_NAME].editWindow === 'tab') {
        this.openEditTab(imageInfo);
      } else {
        this.openEditDialog(imageInfo);
      }
    });
  }

  private triggerDrawnixNativeMenu(imgContainer: HTMLDivElement, anchorButton: HTMLElement) {
    const anchorRect = anchorButton.getBoundingClientRect();
    const clientX = anchorRect.left + anchorRect.width / 2;
    const clientY = anchorRect.top + anchorRect.height / 2;
    const nativeMenuTrigger = this.getDrawnixNativeMenuTrigger(imgContainer);

    if (nativeMenuTrigger) {
      ["mousedown", "mouseup", "click"].forEach((eventName) => {
        nativeMenuTrigger.dispatchEvent(new MouseEvent(eventName, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY,
          button: 0,
        }));
      });
      return;
    }

    const fallbackTarget = (imgContainer.querySelector("img") as HTMLImageElement | null) || imgContainer;
    fallbackTarget.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      button: 2,
    }));
  }

  private measureDrawnixLabelWidth(imgContainer: HTMLDivElement, labelText: string) {
    if (!labelText) return 0;

    const measureElement = document.createElement("span");
    const computedStyle = window.getComputedStyle(imgContainer);
    measureElement.textContent = labelText;
    measureElement.style.position = "fixed";
    measureElement.style.left = "-100000px";
    measureElement.style.top = "0";
    measureElement.style.visibility = "hidden";
    measureElement.style.pointerEvents = "none";
    measureElement.style.whiteSpace = "nowrap";
    measureElement.style.padding = "2px 8px";
    measureElement.style.border = "1px solid transparent";
    measureElement.style.borderRadius = "6px";
    measureElement.style.boxSizing = "border-box";
    measureElement.style.font = computedStyle.font;
    measureElement.style.lineHeight = "1.4";
    document.body.appendChild(measureElement);
    const width = Math.ceil(measureElement.getBoundingClientRect().width);
    measureElement.remove();
    return width;
  }

  private updateDrawnixPreviewLayoutMetrics(imgContainer: HTMLDivElement) {
    const toolbar = imgContainer.querySelector(".drawnix-preview-toolbar") as HTMLElement | null;
    const toolbarWidth = Math.ceil(toolbar?.getBoundingClientRect().width || 0);
    const maxLabelWidth = Math.max(
      0,
      imgContainer.clientWidth - DRAWNIX_PREVIEW_INSET * 2 - DRAWNIX_PREVIEW_TOOLBAR_GAP - toolbarWidth,
    );
    const labelText = imgContainer.getAttribute("data-drawnix-label") || "";
    const labelWidth = Math.min(this.measureDrawnixLabelWidth(imgContainer, labelText), maxLabelWidth);

    imgContainer.style.setProperty("--drawnix-toolbar-width", `${toolbarWidth}px`);
    imgContainer.style.setProperty("--drawnix-label-width", `${labelWidth}px`);
  }

  private ensureDrawnixPreviewToolbar(blockElement: HTMLElement, imgContainer: HTMLDivElement, imageURL: string) {
    let toolbar = imgContainer.querySelector(".drawnix-preview-toolbar") as HTMLDivElement | null;
    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.className = "drawnix-preview-toolbar";

      const editButton = this.createDrawnixPreviewToolbarButton(
        "drawnix-preview-toolbar__button--edit",
        this.i18n.edit || "Edit Drawnix",
        '<svg class="svg"><use xlink:href="#iconEdit"></use></svg>',
      );
      editButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const currentImageURL = toolbar?.dataset.imageUrl || this.getDrawnixImageURLFromContainer(imgContainer);
        this.openDrawnixEditorForBlock(currentImageURL, blockElement);
      });

      const moreButton = this.createDrawnixPreviewToolbarButton(
        "drawnix-preview-toolbar__button--more",
        this.getI18nText("more", "更多"),
        this.getDrawnixToolbarMoreIconHTML(imgContainer),
      );
      moreButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.triggerDrawnixNativeMenu(imgContainer, moreButton);
      });

      toolbar.append(editButton, moreButton);
      imgContainer.appendChild(toolbar);
    }

    toolbar.dataset.imageUrl = imageURL;
    const moreButton = toolbar.querySelector(".drawnix-preview-toolbar__button--more") as HTMLButtonElement | null;
    if (moreButton) {
      moreButton.innerHTML = this.getDrawnixToolbarMoreIconHTML(imgContainer);
    }
    return toolbar;
  }

  private refreshDrawnixNativeArtifacts(blockElement: HTMLElement, imgContainer: HTMLDivElement) {
    blockElement.setAttribute(DRAWNIX_PREVIEW_BLOCK_ATTR, "true");
    blockElement.querySelectorAll(`[${DRAWNIX_NATIVE_RESIZE_ATTR}]`).forEach((element) => {
      element.removeAttribute(DRAWNIX_NATIVE_RESIZE_ATTR);
    });
    blockElement.querySelectorAll(`[${DRAWNIX_NATIVE_ACTION_ATTR}]`).forEach((element) => {
      element.removeAttribute(DRAWNIX_NATIVE_ACTION_ATTR);
    });

    const toolbar = imgContainer.querySelector(".drawnix-preview-toolbar") as HTMLElement | null;
    const nativeAction = this.getDrawnixNativeAction(imgContainer);
    if (nativeAction) {
      nativeAction.setAttribute(DRAWNIX_NATIVE_ACTION_ATTR, "true");
    }

    blockElement.querySelectorAll("*").forEach((node) => {
      const element = node as HTMLElement;
      if (element === imgContainer || element === toolbar || toolbar?.contains(element)) return;
      if (nativeAction && (element === nativeAction || nativeAction.contains(element))) return;
      if (!element.isConnected) return;

      const classText = [
        typeof element.className === "string" ? element.className : "",
        element.getAttribute("data-type") || "",
        element.getAttribute("data-position") || "",
      ].join(" ").toLowerCase();
      const cursor = window.getComputedStyle(element).cursor.toLowerCase();

      if (classText.includes("resize") || cursor.includes("resize")) {
        element.setAttribute(DRAWNIX_NATIVE_RESIZE_ATTR, "true");
      }
    });
  }

  private syncDrawnixPreviewBlockUI(blockElement: HTMLElement, imgContainer: HTMLDivElement, imageURL: string) {
    blockElement.setAttribute(DRAWNIX_PREVIEW_BLOCK_ATTR, "true");
    this.normalizeDrawnixPreviewContainer(imgContainer);
    this.ensureDrawnixPreviewToolbar(blockElement, imgContainer, imageURL);
    this.refreshDrawnixNativeArtifacts(blockElement, imgContainer);
    this.updateDrawnixPreviewLayoutMetrics(imgContainer);

    window.requestAnimationFrame(() => {
      if (!blockElement.isConnected || !imgContainer.isConnected) return;
      this.refreshDrawnixNativeArtifacts(blockElement, imgContainer);
      this.updateDrawnixPreviewLayoutMetrics(imgContainer);
    });
  }

  private drawnixPreviewDragStartHandler(event: DragEvent) {
    const blockElement = this.getDrawnixPreviewBlock(event.target);
    const imgContainer = this.getDrawnixPreviewContainer(event.target);
    if (!blockElement || !imgContainer) return;

    const target = event.target as HTMLElement | null;
    if (target?.closest(".drawnix-preview-toolbar, .drawnix-preview-toolbar__button, button, a")) {
      return;
    }

    const isNativeResize = !!target?.closest(`[${DRAWNIX_NATIVE_RESIZE_ATTR}='true']`);
    if (!isNativeResize) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  private shouldBypassDrawnixPreviewBlock(target: HTMLElement | null) {
    return !!target?.closest(".drawnix-preview-toolbar, .drawnix-preview-toolbar__button, button, a");
  }

  private blockDrawnixPreviewPointerEvent(event: MouseEvent | PointerEvent) {
    const blockElement = this.getDrawnixPreviewBlock(event.target);
    if (!blockElement) return;

    const target = event.target as HTMLElement | null;
    if (this.shouldBypassDrawnixPreviewBlock(target)) {
      return;
    }

    if ('button' in event && event.button !== 0) {
      return;
    }

    const imgContainer = this.getDrawnixPreviewContainerFromBlock(blockElement);
    const isNativeResize = !!target?.closest(`[${DRAWNIX_NATIVE_RESIZE_ATTR}='true']`);
    const isInsidePreview = !!imgContainer && !!target && (target === imgContainer || imgContainer.contains(target));

    if (!isNativeResize && !isInsidePreview) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  private drawnixPreviewPointerDownHandler(event: PointerEvent) {
    this.blockDrawnixPreviewPointerEvent(event);
  }

  private drawnixPreviewMouseDownHandler(event: MouseEvent) {
    this.blockDrawnixPreviewPointerEvent(event);
  }

  private clearDrawnixLabel(blockElement: HTMLElement) {
    blockElement.removeAttribute(DRAWNIX_PREVIEW_BLOCK_ATTR);
    blockElement.querySelectorAll(`[${DRAWNIX_NATIVE_RESIZE_ATTR}]`).forEach((element) => {
      element.removeAttribute(DRAWNIX_NATIVE_RESIZE_ATTR);
    });
    blockElement.querySelectorAll(`[${DRAWNIX_NATIVE_ACTION_ATTR}]`).forEach((element) => {
      element.removeAttribute(DRAWNIX_NATIVE_ACTION_ATTR);
    });
    blockElement.querySelectorAll(".drawnix-preview-toolbar").forEach((toolbarElement) => {
      toolbarElement.remove();
    });

    const imgContainer = blockElement.querySelector(".img[data-type='img']") as HTMLDivElement;
    if (imgContainer) {
      imgContainer.removeAttribute("data-drawnix-embed");
      imgContainer.removeAttribute("data-drawnix-label");
      imgContainer.removeAttribute("data-drawnix-label-mode");
      imgContainer.style.removeProperty("--drawnix-label-width");
      imgContainer.style.removeProperty("--drawnix-toolbar-width");
    }

    blockElement.querySelectorAll(".label--embed-drawnix").forEach((labelElement) => {
      labelElement.remove();
    });
    blockElement.querySelectorAll(".drawnix-image-container").forEach((containerElement) => {
      containerElement.classList.remove("drawnix-image-container");
    });
  }

  private clearAllDrawnixLabels(root: ParentNode = document) {
    root.querySelectorAll(`[${DRAWNIX_PREVIEW_BLOCK_ATTR}]`).forEach((blockElement) => {
      (blockElement as HTMLElement).removeAttribute(DRAWNIX_PREVIEW_BLOCK_ATTR);
    });
    root.querySelectorAll(`[${DRAWNIX_NATIVE_RESIZE_ATTR}]`).forEach((element) => {
      (element as HTMLElement).removeAttribute(DRAWNIX_NATIVE_RESIZE_ATTR);
    });
    root.querySelectorAll(`[${DRAWNIX_NATIVE_ACTION_ATTR}]`).forEach((element) => {
      (element as HTMLElement).removeAttribute(DRAWNIX_NATIVE_ACTION_ATTR);
    });
    root.querySelectorAll(".drawnix-preview-toolbar").forEach((toolbarElement) => {
      toolbarElement.remove();
    });
    root.querySelectorAll(".img[data-type='img']").forEach((containerElement) => {
      (containerElement as HTMLDivElement).removeAttribute("data-drawnix-embed");
      (containerElement as HTMLDivElement).removeAttribute("data-drawnix-label");
      (containerElement as HTMLDivElement).removeAttribute("data-drawnix-label-mode");
      (containerElement as HTMLDivElement).style.removeProperty("--drawnix-label-width");
      (containerElement as HTMLDivElement).style.removeProperty("--drawnix-toolbar-width");
    });
    root.querySelectorAll(".label--embed-drawnix").forEach((labelElement) => {
      labelElement.remove();
    });
    root.querySelectorAll(".drawnix-image-container").forEach((containerElement) => {
      containerElement.classList.remove("drawnix-image-container");
    });
  }

  private collectDrawnixLabelBlocks(root: ParentNode = document): HTMLElement[] {
    const blockSet = new Set<HTMLElement>();

    root.querySelectorAll(".img[data-type='img'] img").forEach((imageElement) => {
      const img = imageElement as HTMLImageElement;
      const imageURL = img.getAttribute("data-src") || img.getAttribute("src") || "";
      if (!this.isDrawnixAssetURL(imageURL)) return;

      const blockElement = img.closest("div[data-type='NodeParagraph']") as HTMLElement;
      if (blockElement) {
        blockSet.add(blockElement);
      }
    });

    return Array.from(blockSet);
  }

  private scheduleFullDrawnixLabelRefresh(delay = 80) {
    if (this.fullLabelRefreshTimer !== null) {
      window.clearTimeout(this.fullLabelRefreshTimer);
    }

    this.fullLabelRefreshTimer = window.setTimeout(() => {
      this.fullLabelRefreshTimer = null;
      this.refreshAllDrawnixLabels();
    }, delay);
  }

  private async refreshAllDrawnixLabels() {
    this.clearAllDrawnixLabels();
    const blockElements = this.collectDrawnixLabelBlocks();
    await Promise.allSettled(blockElements.map((blockElement) => this.syncDrawnixLabel(blockElement)));
  }

  private async syncDrawnixLabel(blockElement: HTMLElement) {
    if (!blockElement?.isConnected) return;

    const imgContainer = blockElement.querySelector(".img[data-type='img']") as HTMLDivElement;
    const imageElement = imgContainer?.querySelector("img") as HTMLImageElement;
    const imageURL = imageElement?.getAttribute("data-src") || imageElement?.getAttribute("src") || "";

    if (!imgContainer || !this.isDrawnixAssetURL(imageURL)) {
      this.clearDrawnixLabel(blockElement);
      return;
    }

    this.clearDrawnixLabel(blockElement);
    imgContainer.setAttribute("data-drawnix-embed", "true");
    this.syncDrawnixPreviewBlockUI(blockElement, imgContainer, imageURL);

    if (this.data[STORAGE_NAME].labelDisplay === "noLabel") {
      return;
    }

    const imageInfo = await this.getDrawnixImageInfo(imageURL, blockElement);
    if (!blockElement.isConnected) return;

    if (!imageInfo) {
      return;
    }

    this.updateAttrLabel(imageInfo, blockElement);
  }

  public updateAttrLabel(imageInfo: DrawnixImageInfo, blockElement: HTMLElement) {
    this.clearDrawnixLabel(blockElement);

    if (!imageInfo) return;

    const imgContainer = blockElement.querySelector(".img[data-type='img']") as HTMLDivElement;
    if (!imgContainer) return;

    imgContainer.setAttribute("data-drawnix-embed", "true");
    const imageURL = this.getDrawnixImageURLFromContainer(imgContainer);
    this.syncDrawnixPreviewBlockUI(blockElement, imgContainer, imageURL);
    if (this.data[STORAGE_NAME].labelDisplay === "noLabel") return;

    const displayName = this.getDrawnixDisplayName(imageInfo);
    const labelMode = this.data[STORAGE_NAME].labelDisplay === "showLabelAlways" ? "always" : "hover";
    imgContainer.setAttribute("data-drawnix-label", displayName);
    imgContainer.setAttribute("data-drawnix-label-mode", labelMode);
    this.updateDrawnixPreviewLayoutMetrics(imgContainer);
  }

  private mouseOverHandler(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const blockElement = target.closest(`div[data-type='NodeParagraph'][${DRAWNIX_PREVIEW_BLOCK_ATTR}='true']`) as HTMLElement | null;
    if (!blockElement || this.isMouseOverProcessing) return;

    this.isMouseOverProcessing = true;
    setTimeout(() => this.isMouseOverProcessing = false, 100);

    const imgContainer = this.getDrawnixPreviewContainerFromBlock(blockElement);
    const imageURL = this.getDrawnixImageURLFromContainer(imgContainer);
    if (!this.isDrawnixAssetURL(imageURL)) return;

    if (!imgContainer) return;
    this.syncDrawnixPreviewBlockUI(blockElement, imgContainer, imageURL);
  }

  private openMenuImageHandler({ detail }) {
    const selectedElement = detail.element;
    const imageElement = selectedElement.querySelector("img") as HTMLImageElement;
    const imageURL = imageElement.dataset.src;
    const blockElement = imageElement.closest('[data-node-id]') as HTMLElement;
    this.getDrawnixImageInfo(imageURL, blockElement).then((imageInfo: DrawnixImageInfo) => {
      if (imageInfo) {
        window.siyuan.menus.menu.addItem({
          id: "edit-drawnix",
          icon: 'iconEdit',
          label: `编辑 Drawnix`,
          index: 1,
          click: () => {
            this.openDrawnixEditorForBlock(imageURL, blockElement);
          }
        });
      }
    })
  }

  private getActiveCustomTab(type: string): Custom {
    const allCustoms = getAllModels().custom;
    const activeTabElement = document.querySelector(".layout__wnd--active .item--focus");
    if (activeTabElement) {
      const tabId = activeTabElement.getAttribute("data-id");
      for (const custom of allCustoms as any[]) {
        if (custom.type == this.name + type && custom.tab.headElement?.getAttribute('data-id') == tabId) {
          return custom;
        };
      }
    }
    return null;
  }

  private tabHotKeyEventHandler = (event: KeyboardEvent, custom?: Custom) => {
    // 自定义处理方式的快捷键
    const isFullscreenHotKey = matchHotKey(window.siyuan.config.keymap.editor.general.fullscreen.custom, event);
    const isCloseTabHotKey = matchHotKey(window.siyuan.config.keymap.general.closeTab.custom, event);
    if (isFullscreenHotKey || isCloseTabHotKey) {
      if (!custom) custom = this.getActiveCustomTab(this.EDIT_TAB_TYPE);
      if (custom) {
        event.preventDefault();
        event.stopPropagation();

        if (isFullscreenHotKey) {
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            custom.element.requestFullscreen();
          }
        }
        if (isCloseTabHotKey) {
          custom.tab.close();
        }
      }
    }
  };

  private globalKeyDownHandler = (event: KeyboardEvent) => {
    // 如果是在代码编辑器里使用快捷键，则阻止冒泡 https://github.com/YuxinZhaozyx/siyuan-embed-tikz/issues/1
    if (document.activeElement.closest(".b3-dialog--open .drawnix-edit-dialog")) {
      event.stopPropagation();
    }

    // 快捷键
    this.tabHotKeyEventHandler(event);
  };

  private getI18nText(key: string, fallback: string): string {
    return this.i18n?.[key] || fallback;
  }

  private pushNotification(msg: string, timeout = 3000) {
    try {
      fetchPost('/api/notification/pushMsg', {
        msg,
        timeout,
      });
    } catch (err) {
      console.error('Failed to send notification', err);
    }
  }

  private parseMessageData(data: any): any {
    if (typeof data !== 'string') return data;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  private requestDrawnixPayload<T>(
    iframe: HTMLIFrameElement,
    requestType: 'export-source' | 'export-preview-svg',
    timeoutMessage: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!iframe.contentWindow) {
        reject(new Error('Drawnix iframe is not ready'));
        return;
      }

      const requestId = `drawnix-${requestType}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error(timeoutMessage));
      }, 5000);

      const cleanup = () => {
        window.clearTimeout(timeout);
        window.removeEventListener('message', messageEventHandler);
      };

      const messageEventHandler = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow) return;

        const message = this.parseMessageData(event.data);
        if (message?.type !== requestType || message.requestId !== requestId) return;

        cleanup();
        resolve(message.data as T);
      };

      window.addEventListener('message', messageEventHandler);
      iframe.contentWindow.postMessage({
        type: requestType,
        requestId,
      }, '*');
    });
  }

  private requestDrawnixSource(iframe: HTMLIFrameElement): Promise<any> {
    return this.requestDrawnixPayload<any>(
      iframe,
      'export-source',
      'Drawnix source export timed out',
    );
  }

  private requestDrawnixPreviewSVG(iframe: HTMLIFrameElement): Promise<string> {
    return this.requestDrawnixPayload<string>(
      iframe,
      'export-preview-svg',
      'Drawnix preview export timed out',
    );
  }

  private decodeSvgDataURL(svgDataURL: string): string {
    const [prefix, payload = ''] = svgDataURL.split(',', 2);
    if (prefix.includes(';base64')) {
      return base64ToUnicode(payload);
    }

    try {
      return decodeURIComponent(payload);
    } catch {
      return payload;
    }
  }

  private encodeSvgDataURL(svgContent: string): string {
    return `data:image/svg+xml;base64,${unicodeToBase64(svgContent)}`;
  }

  private parseSvgViewBox(svgElement: SVGSVGElement) {
    const viewBoxAttr = svgElement.getAttribute('viewBox') || '';
    const viewBoxValues = viewBoxAttr
      .trim()
      .split(/[\s,]+/)
      .map((value) => Number.parseFloat(value))
      .filter((value) => Number.isFinite(value));

    if (viewBoxValues.length === 4 && viewBoxValues[2] > 0 && viewBoxValues[3] > 0) {
      return {
        x: viewBoxValues[0],
        y: viewBoxValues[1],
        width: viewBoxValues[2],
        height: viewBoxValues[3],
      };
    }

    const width = Number.parseFloat(svgElement.getAttribute('width') || '0') || 1;
    const height = Number.parseFloat(svgElement.getAttribute('height') || '0') || 1;
    return {
      x: 0,
      y: 0,
      width: Math.max(width, 1),
      height: Math.max(height, 1),
    };
  }

  private getSvgMeasureSize(width: number, height: number) {
    const maxSize = 1200;
    if (width <= 0 || height <= 0) {
      return { width: maxSize, height: maxSize };
    }

    if (width >= height) {
      return {
        width: maxSize,
        height: Math.max(1, Math.round((height / width) * maxSize)),
      };
    }

    return {
      width: Math.max(1, Math.round((width / height) * maxSize)),
      height: maxSize,
    };
  }

  private isFullCanvasBackgroundRect(
    element: SVGGraphicsElement,
    svgElement: SVGSVGElement,
    viewBox: { x: number; y: number; width: number; height: number },
  ) {
    if (element.tagName.toLowerCase() !== 'rect') return false;
    if (element.parentElement !== svgElement) return false;

    const x = Number.parseFloat(element.getAttribute('x') || '0') || 0;
    const y = Number.parseFloat(element.getAttribute('y') || '0') || 0;
    const widthAttr = element.getAttribute('width') || '';
    const heightAttr = element.getAttribute('height') || '';
    const width = widthAttr.trim().endsWith('%')
      ? viewBox.width
      : Number.parseFloat(widthAttr || '0') || 0;
    const height = heightAttr.trim().endsWith('%')
      ? viewBox.height
      : Number.parseFloat(heightAttr || '0') || 0;

    const fill = (element.getAttribute('fill') || window.getComputedStyle(element).fill || '').trim().toLowerCase();
    const stroke = (element.getAttribute('stroke') || window.getComputedStyle(element).stroke || '').trim().toLowerCase();
    const isLightBackground = [
      '#fff',
      '#ffffff',
      'white',
      'rgb(255, 255, 255)',
      'rgba(255, 255, 255, 1)',
      'transparent',
      'rgba(0, 0, 0, 0)',
    ].includes(fill);
    const hasNoStroke = !stroke || stroke === 'none' || stroke === 'transparent' || stroke === 'rgba(0, 0, 0, 0)';
    const coversCanvas = Math.abs(x - viewBox.x) <= 1
      && Math.abs(y - viewBox.y) <= 1
      && Math.abs(width - viewBox.width) <= 2
      && Math.abs(height - viewBox.height) <= 2;

    return coversCanvas && isLightBackground && hasNoStroke;
  }

  private shouldIgnorePreviewGraphic(
    element: SVGGraphicsElement,
    svgElement: SVGSVGElement,
    viewBox: { x: number; y: number; width: number; height: number },
  ) {
    if (element.closest('defs, clipPath, mask, marker, pattern, symbol')) {
      return true;
    }

    if (this.isFullCanvasBackgroundRect(element, svgElement, viewBox)) {
      return true;
    }

    const computedStyle = window.getComputedStyle(element);
    if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') {
      return true;
    }

    const opacity = Number.parseFloat(computedStyle.opacity || '1');
    if (Number.isFinite(opacity) && opacity <= 0) {
      return true;
    }

    return false;
  }

  private async cropSvgDataURLToContent(svgDataURL: string): Promise<string> {
    if (!svgDataURL.startsWith('data:image/svg+xml')) {
      return svgDataURL;
    }

    const svgContent = this.decodeSvgDataURL(svgDataURL);
    const svgDocument = new DOMParser().parseFromString(svgContent, 'image/svg+xml');
    const sourceSvgElement = svgDocument.documentElement as SVGSVGElement;
    if (!sourceSvgElement || sourceSvgElement.tagName.toLowerCase() !== 'svg') {
      return svgDataURL;
    }

    const viewBox = this.parseSvgViewBox(sourceSvgElement);
    const workingSvgElement = sourceSvgElement.cloneNode(true) as SVGSVGElement;
    workingSvgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    workingSvgElement.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
    workingSvgElement.setAttribute('preserveAspectRatio', workingSvgElement.getAttribute('preserveAspectRatio') || 'xMidYMid meet');

    const measureSize = this.getSvgMeasureSize(viewBox.width, viewBox.height);
    workingSvgElement.setAttribute('width', `${measureSize.width}`);
    workingSvgElement.setAttribute('height', `${measureSize.height}`);

    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '-100000px';
    host.style.top = '0';
    host.style.width = `${measureSize.width}px`;
    host.style.height = `${measureSize.height}px`;
    host.style.overflow = 'hidden';
    host.style.opacity = '0';
    host.style.pointerEvents = 'none';
    host.style.zIndex = '-1';
    host.appendChild(workingSvgElement);
    document.body.appendChild(host);

    try {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });

      const rootRect = workingSvgElement.getBoundingClientRect();
      if (!rootRect.width || !rootRect.height) {
        return svgDataURL;
      }

      const scaleX = viewBox.width / rootRect.width;
      const scaleY = viewBox.height / rootRect.height;
      const graphicElements = Array.from(
        workingSvgElement.querySelectorAll('path, rect, circle, ellipse, line, polyline, polygon, text, image, foreignObject, use'),
      ) as SVGGraphicsElement[];

      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;

      graphicElements.forEach((graphicElement) => {
        if (this.shouldIgnorePreviewGraphic(graphicElement, workingSvgElement, viewBox)) {
          return;
        }

        const rect = graphicElement.getBoundingClientRect();
        if (rect.width < 0.5 && rect.height < 0.5) {
          return;
        }

        const left = viewBox.x + (rect.left - rootRect.left) * scaleX;
        const top = viewBox.y + (rect.top - rootRect.top) * scaleY;
        const right = left + rect.width * scaleX;
        const bottom = top + rect.height * scaleY;

        minX = Math.min(minX, left);
        minY = Math.min(minY, top);
        maxX = Math.max(maxX, right);
        maxY = Math.max(maxY, bottom);
      });

      if (![minX, minY, maxX, maxY].every((value) => Number.isFinite(value))) {
        return svgDataURL;
      }

      const padding = Math.max(16, Math.min(32, Math.min(viewBox.width, viewBox.height) * 0.03));
      const cropX = Math.max(viewBox.x, minX - padding);
      const cropY = Math.max(viewBox.y, minY - padding);
      const cropRight = Math.min(viewBox.x + viewBox.width, maxX + padding);
      const cropBottom = Math.min(viewBox.y + viewBox.height, maxY + padding);
      const cropWidth = Math.max(1, cropRight - cropX);
      const cropHeight = Math.max(1, cropBottom - cropY);

      sourceSvgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      sourceSvgElement.setAttribute('viewBox', `${cropX} ${cropY} ${cropWidth} ${cropHeight}`);
      sourceSvgElement.setAttribute('width', `${Math.round(cropWidth)}`);
      sourceSvgElement.setAttribute('height', `${Math.round(cropHeight)}`);
      sourceSvgElement.setAttribute('preserveAspectRatio', sourceSvgElement.getAttribute('preserveAspectRatio') || 'xMidYMid meet');

      return this.encodeSvgDataURL(new XMLSerializer().serializeToString(sourceSvgElement));
    } catch (err) {
      console.error('Failed to crop Drawnix SVG preview', err);
      return svgDataURL;
    } finally {
      host.remove();
    }
  }

  private async svgDataURLToPngDataURL(svgDataURL: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const width = Math.max(1, Math.round(image.naturalWidth || image.width || 1));
        const height = Math.max(1, Math.round(image.naturalHeight || image.height || 1));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Failed to create preview canvas context'));
          return;
        }

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      image.onerror = () => reject(new Error('Failed to rasterize Drawnix SVG preview'));
      image.src = svgDataURL;
    });
  }

  private async buildDrawnixPreviewImageData(
    iframe: HTMLIFrameElement,
    format: DrawnixImageInfo['format'],
  ) {
    const rawSvgDataURL = await this.requestDrawnixPreviewSVG(iframe);
    const normalizedSvgDataURL = this.fixImageContent(rawSvgDataURL);
    const croppedSvgDataURL = await this.cropSvgDataURLToContent(normalizedSvgDataURL);

    if (format === 'png') {
      const pngDataURL = await this.svgDataURLToPngDataURL(croppedSvgDataURL);
      return this.fixImageContent(pngDataURL);
    }

    return this.fixImageContent(croppedSvgDataURL);
  }

  private async refreshRenderedDrawnixImage(imageURL: string) {
    try {
      await fetch(imageURL, { cache: 'reload' });
    } catch (err) {
      console.warn('Failed to reload Drawnix image cache', err);
    }

    document.querySelectorAll(`img[data-src='${imageURL}']`).forEach((imageElement) => {
      (imageElement as HTMLImageElement).src = imageURL;
    });
    this.scheduleFullDrawnixLabelRefresh(0);
  }

  private async persistDrawnixPreviewImage(
    iframe: HTMLIFrameElement,
    imageInfo: DrawnixImageInfo,
    afterSave?: () => void,
  ) {
    imageInfo.data = await this.buildDrawnixPreviewImageData(iframe, imageInfo.format);
    await this.updateDrawnixImage(imageInfo);
    afterSave?.();
    await this.refreshRenderedDrawnixImage(imageInfo.imageURL);
  }

  private downloadTextFile(fileName: string, content: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  private async exportXmindImportFile(
    iframe: HTMLIFrameElement,
    imageInfo: DrawnixImageInfo,
    format: XmindImportFormat,
  ) {
    try {
      const sourceData = await this.requestDrawnixSource(iframe);
      if (sourceData) {
        imageInfo.drawnixData = JSON.stringify(sourceData);
      }

      const file = buildXmindImportFile(sourceData, imageInfo.imageURL, format);
      if (file.topics.length === 0) {
        this.pushNotification(this.getI18nText('noTextToExport', '没有可导出的文本'));
        return;
      }

      this.downloadTextFile(file.fileName, file.content, file.mimeType);
      this.pushNotification(`${this.getI18nText('exportSuccess', '导出成功')}: ${file.fileName}`);
    } catch (err) {
      console.error('Failed to export XMind import file', err);
      this.pushNotification(this.getI18nText('exportFailed', '导出失败'));
    }
  }

  private closeXmindExportMenu(doc: Document) {
    const menu = doc.querySelector('.customXmindExportMenu') as (HTMLElement & {
      __cleanup?: () => void;
    }) | null;

    if (menu?.__cleanup) {
      menu.__cleanup();
      return;
    }

    menu?.remove();
  }

  private positionXmindExportMenu(menu: HTMLElement, anchor: HTMLElement, doc: Document) {
    const viewportWidth = doc.documentElement.clientWidth;
    const viewportHeight = doc.documentElement.clientHeight;
    const anchorRect = anchor.getBoundingClientRect();
    const gap = 4;
    const maxLeft = Math.max(gap, viewportWidth - menu.offsetWidth - gap);
    const maxTop = Math.max(gap, viewportHeight - menu.offsetHeight - gap);
    const isNativeMenuItem = anchor.classList.contains('menu-item');

    let left = anchorRect.left;
    let top = anchorRect.bottom + gap;

    if (isNativeMenuItem) {
      left = anchorRect.right + gap;
      top = anchorRect.top;

      if (left > maxLeft) {
        left = anchorRect.left - menu.offsetWidth - gap;
      }
    }

    menu.style.left = `${Math.min(Math.max(gap, left), maxLeft)}px`;
    menu.style.top = `${Math.min(Math.max(gap, top), maxTop)}px`;
  }

  private createMenuIcon(doc: Document, svgMarkup: string) {
    const icon = doc.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.style.display = 'inline-flex';
    icon.style.alignItems = 'center';
    icon.style.justifyContent = 'center';
    icon.style.width = '1rem';
    icon.style.height = '1rem';
    icon.style.flex = '0 0 auto';
    icon.innerHTML = svgMarkup;
    return icon;
  }

  private createMenuItemLabel(doc: Document, label: string, svgMarkup?: string) {
    const text = doc.createElement('span');
    text.className = 'menu-item__text';

    if (svgMarkup) {
      text.appendChild(this.createMenuIcon(doc, svgMarkup));
    }

    const labelText = doc.createElement('span');
    labelText.textContent = label;
    text.appendChild(labelText);
    return text;
  }

  private createMenuItem(
    doc: Document,
    options: {
      label: string;
      icon?: string;
      shortcutText?: string;
      shortcutIcon?: string;
      className?: string;
      title?: string;
    },
  ) {
    const item = doc.createElement('button');
    item.type = 'button';
    item.className = `menu-item-base menu-item${options.className ? ` ${options.className}` : ''}`;

    if (options.title) {
      item.title = options.title;
      item.setAttribute('aria-label', options.title);
    }

    item.appendChild(this.createMenuItemLabel(doc, options.label, options.icon));

    if (options.shortcutIcon || options.shortcutText) {
      const shortcut = doc.createElement('span');
      shortcut.className = 'menu-item__shortcut';
      if (options.shortcutIcon) {
        shortcut.appendChild(this.createMenuIcon(doc, options.shortcutIcon));
      } else if (options.shortcutText) {
        shortcut.textContent = options.shortcutText;
      }
      item.appendChild(shortcut);
    }

    return item;
  }

  private getXmindMenuIcon(type: 'file' | 'markdown' | 'opml' | 'chevron') {
    if (type === 'file') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path><path d="M12 11v6"></path><path d="m9.5 14.5 2.5 2.5 2.5-2.5"></path></svg>';
    }

    if (type === 'markdown') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z"></path><path d="M7 15V9l3 3 3-3v6"></path><path d="M16 9v6"></path><path d="m14.5 13 1.5 2 1.5-2"></path></svg>';
    }

    if (type === 'opml') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="1.25"></circle><circle cx="7" cy="12" r="1.25"></circle><circle cx="7" cy="17" r="1.25"></circle><path d="M10 7h7"></path><path d="M10 12h7"></path><path d="M10 17h7"></path></svg>';
    }

    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"></path></svg>';
  }

  private isNodeInside(target: EventTarget | null, element: HTMLElement) {
    return target instanceof Node && element.contains(target);
  }

  private showXmindExportMenu(
    button: HTMLElement,
    iframe: HTMLIFrameElement,
    imageInfo: DrawnixImageInfo,
  ) {
    const doc = iframe.contentDocument;
    if (!doc) return;

    const existingMenu = doc.querySelector('.customXmindExportMenu') as (HTMLElement & {
      __cleanup?: () => void;
      __anchor?: HTMLElement;
    }) | null;
    if (existingMenu?.__anchor === button) {
      return;
    }

    this.closeXmindExportMenu(doc);

    const menuHost = doc.querySelector('.drawnix') || doc.body;
    let closeTimer = 0;

    const menu = doc.createElement('div');
    menu.className = 'customXmindExportMenu menu';
    menu.style.position = 'fixed';
    menu.style.zIndex = '9999';
    menu.style.minWidth = '188px';
    menu.style.visibility = 'hidden';
    menu.style.pointerEvents = 'auto';
    button.classList.add('menu-item--active');

    const clearCloseTimer = () => {
      window.clearTimeout(closeTimer);
      closeTimer = 0;
    };

    const scheduleClose = () => {
      clearCloseTimer();
      closeTimer = window.setTimeout(() => {
        closeMenu();
      }, 120);
    };

    const closeMenu = () => {
      clearCloseTimer();
      menu.remove();
      button.classList.remove('menu-item--active');
      button.removeEventListener('pointerenter', onButtonEnter);
      button.removeEventListener('pointerleave', onButtonLeave);
      doc.removeEventListener('pointerdown', onDocumentPointerDown, true);
      doc.removeEventListener('keydown', onKeyDown);
      delete (menu as HTMLElement & { __cleanup?: () => void }).__cleanup;
      delete (menu as HTMLElement & { __anchor?: HTMLElement }).__anchor;
    };
    (menu as HTMLElement & { __cleanup?: () => void }).__cleanup = closeMenu;
    (menu as HTMLElement & { __anchor?: HTMLElement }).__anchor = button;

    const onDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.contains(target) && !button.contains(target)) {
        closeMenu();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    const onButtonEnter = () => {
      clearCloseTimer();
    };

    const onButtonLeave = (event: PointerEvent) => {
      if (this.isNodeInside(event.relatedTarget, menu)) {
        return;
      }
      scheduleClose();
    };

    const onMenuEnter = () => {
      clearCloseTimer();
    };

    const onMenuLeave = (event: PointerEvent) => {
      if (this.isNodeInside(event.relatedTarget, button)) {
        return;
      }
      scheduleClose();
    };

    const container = doc.createElement('div');
    container.className = 'menu-container island';
    menu.addEventListener('pointerenter', onMenuEnter);
    menu.addEventListener('pointerleave', onMenuLeave);
    menu.appendChild(container);

    const addMenuItem = (format: XmindImportFormat, label: string) => {
      const item = this.createMenuItem(doc, {
        label,
        title: label,
      });
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        closeMenu();
        this.exportXmindImportFile(iframe, imageInfo, format);
      });
      container.appendChild(item);
    };

    addMenuItem('opml', 'OPML');
    addMenuItem('markdown', 'Markdown');

    menuHost.appendChild(menu);
    this.positionXmindExportMenu(menu, button, doc);
    menu.style.visibility = 'visible';

    button.addEventListener('pointerenter', onButtonEnter);
    button.addEventListener('pointerleave', onButtonLeave);

    setTimeout(() => {
      doc.addEventListener('pointerdown', onDocumentPointerDown, true);
      doc.addEventListener('keydown', onKeyDown);
    });
  }

  private isDrawnixExportImageMenuItem(menuItem: HTMLElement) {
    const textContent = menuItem.textContent?.replace(/\s+/g, ' ').trim().toLowerCase() || '';
    const shortcut = menuItem.querySelector('.menu-item__shortcut')?.textContent?.replace(/\s+/g, '').toLowerCase() || '';

    if (shortcut.includes('shift+e') || shortcut.includes('⇧e')) {
      return true;
    }

    return [
      'export image',
      '导出图片',
      '导出图像',
      '匯出圖片',
      '匯出圖像',
    ].some((keyword) => textContent.includes(keyword));
  }

  private findDrawnixAppMenuContainer(doc: Document) {
    const containers = Array.from(doc.querySelectorAll('.drawnix .menu .menu-container')) as HTMLElement[];
    return containers.find((container) => {
      const menuItems = Array.from(container.querySelectorAll('.menu-item')) as HTMLElement[];
      return menuItems.some((menuItem) => this.isDrawnixExportImageMenuItem(menuItem));
    }) || null;
  }

  private injectXmindExportMenuItem(
    iframe: HTMLIFrameElement,
    imageInfo: DrawnixImageInfo,
  ) {
    const doc = iframe.contentDocument;
    if (!doc) return;

    const menuContainer = this.findDrawnixAppMenuContainer(doc);
    if (!menuContainer || menuContainer.querySelector('.customXmindExportMenuItem')) return;

    const menuItems = Array.from(menuContainer.querySelectorAll('.menu-item')) as HTMLElement[];
    const exportImageMenuItem = menuItems.find((menuItem) => this.isDrawnixExportImageMenuItem(menuItem));
    if (!exportImageMenuItem) return;

    const label = this.getI18nText('exportFile', '导出文件');
    const button = this.createMenuItem(doc, {
      label,
      icon: this.getXmindMenuIcon('file'),
      shortcutIcon: this.getXmindMenuIcon('chevron'),
      className: 'customXmindExportMenuItem',
      title: label,
    });
    button.setAttribute('aria-haspopup', 'menu');
    button.addEventListener('pointerenter', () => {
      this.showXmindExportMenu(button, iframe, imageInfo);
    });
    button.addEventListener('focus', () => {
      this.showXmindExportMenu(button, iframe, imageInfo);
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.showXmindExportMenu(button, iframe, imageInfo);
    });

    exportImageMenuItem.insertAdjacentElement('afterend', button);
  }

  private setupXmindExportMenuInjection(
    iframe: HTMLIFrameElement,
    imageInfo: DrawnixImageInfo,
  ) {
    const doc = iframe.contentDocument;
    if (!doc?.body) return () => {};

    let syncTimer = 0;
    const syncMenuItem = () => {
      window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(() => {
        this.injectXmindExportMenuItem(iframe, imageInfo);
      }, 16);
    };

    const mutationObserver = new MutationObserver(() => {
      syncMenuItem();
    });

    mutationObserver.observe(doc.body, {
      childList: true,
      subtree: true,
    });
    syncMenuItem();

    return () => {
      mutationObserver.disconnect();
      window.clearTimeout(syncTimer);
      this.closeXmindExportMenu(doc);
      doc.querySelectorAll('.customXmindExportMenuItem').forEach((menuItem) => menuItem.remove());
    };
  }

  public setupEditTab() {
    const that = this;
    this.addTab({
      type: this.EDIT_TAB_TYPE,
      init() {
        const imageInfo: DrawnixImageInfo = this.data;
        const editTabHTML = `
<div class="drawnix-edit-tab">
    <iframe src="/plugins/siyuan-plugin-drawnix/drawnix-embed/index.html"></iframe>
</div>`;
        this.element.innerHTML = editTabHTML;

        const iframe = this.element.querySelector("iframe");
        iframe.focus();

        const postMessage = (message: any) => {
          if (!iframe.contentWindow) return;
          iframe.contentWindow.postMessage(message, '*');
        };
        let cleanupXmindExportMenuInjection = () => {};

        const fullscreenOnLogo = '<svg t="1763089104127" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="5274" width="24" height="24"><path d="M149.333333 394.666667c17.066667 0 32-14.933333 32-32v-136.533334l187.733334 187.733334c6.4 6.4 14.933333 8.533333 23.466666 8.533333s17.066667-2.133333 23.466667-8.533333c12.8-12.8 12.8-32 0-44.8l-187.733333-187.733334H362.666667c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32H149.333333c-4.266667 0-8.533333 0-10.666666 2.133334-8.533333 4.266667-14.933333 10.666667-19.2 17.066666-2.133333 4.266667-2.133333 8.533333-2.133334 12.8v213.333334c0 17.066667 14.933333 32 32 32zM874.666667 629.333333c-17.066667 0-32 14.933333-32 32v136.533334L642.133333 597.333333c-12.8-12.8-32-12.8-44.8 0s-12.8 32 0 44.8l200.533334 200.533334H661.333333c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h213.333334c4.266667 0 8.533333 0 10.666666-2.133334 8.533333-4.266667 14.933333-8.533333 17.066667-17.066666 2.133333-4.266667 2.133333-8.533333 2.133333-10.666667V661.333333c2.133333-17.066667-12.8-32-29.866666-32zM381.866667 595.2l-200.533334 200.533333V661.333333c0-17.066667-14.933333-32-32-32s-32 14.933333-32 32v213.333334c0 4.266667 0 8.533333 2.133334 10.666666 4.266667 8.533333 8.533333 14.933333 17.066666 17.066667 4.266667 2.133333 8.533333 2.133333 10.666667 2.133333h213.333333c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32h-136.533333l200.533333-200.533333c12.8-12.8 12.8-32 0-44.8s-29.866667-10.666667-42.666666 0zM904.533333 138.666667c0-2.133333 0-2.133333 0 0-4.266667-8.533333-10.666667-14.933333-17.066666-17.066667-4.266667-2.133333-8.533333-2.133333-10.666667-2.133333H661.333333c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h136.533334l-187.733334 187.733333c-12.8 12.8-12.8 32 0 44.8 6.4 6.4 14.933333 8.533333 23.466667 8.533333s17.066667-2.133333 23.466667-8.533333l187.733333-187.733333V362.666667c0 17.066667 14.933333 32 32 32s32-14.933333 32-32V149.333333c-2.133333-4.266667-2.133333-8.533333-4.266667-10.666666z" fill="#666666" p-id="5275"></path></svg>';
        const fullscreenOffLogo = '<svg t="1763089178999" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="5443" width="24" height="24"><path d="M313.6 358.4H177.066667c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h213.333333c4.266667 0 8.533333 0 10.666667-2.133333 8.533333-4.266667 14.933333-8.533333 17.066666-17.066667 2.133333-4.266667 2.133333-8.533333 2.133334-10.666667v-213.333333c0-17.066667-14.933333-32-32-32s-32 14.933333-32 32v136.533333L172.8 125.866667c-12.8-12.8-32-12.8-44.8 0-12.8 12.8-12.8 32 0 44.8l185.6 187.733333zM695.466667 650.666667H832c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32H618.666667c-4.266667 0-8.533333 0-10.666667 2.133333-8.533333 4.266667-14.933333 8.533333-17.066667 17.066667-2.133333 4.266667-2.133333 8.533333-2.133333 10.666666v213.333334c0 17.066667 14.933333 32 32 32s32-14.933333 32-32v-136.533334l200.533333 200.533334c6.4 6.4 14.933333 8.533333 23.466667 8.533333s17.066667-2.133333 23.466667-8.533333c12.8-12.8 12.8-32 0-44.8l-204.8-198.4zM435.2 605.866667c-4.266667-8.533333-8.533333-14.933333-17.066667-17.066667-4.266667-2.133333-8.533333-2.133333-10.666666-2.133333H192c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h136.533333L128 851.2c-12.8 12.8-12.8 32 0 44.8 6.4 6.4 14.933333 8.533333 23.466667 8.533333s17.066667-2.133333 23.466666-8.533333l200.533334-200.533333V832c0 17.066667 14.933333 32 32 32s32-14.933333 32-32V618.666667c-2.133333-4.266667-2.133333-8.533333-4.266667-12.8zM603.733333 403.2c4.266667 8.533333 8.533333 14.933333 17.066667 17.066667 4.266667 2.133333 8.533333 2.133333 10.666667 2.133333h213.333333c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32h-136.533333L896 170.666667c12.8-12.8 12.8-32 0-44.8-12.8-12.8-32-12.8-44.8 0l-187.733333 187.733333V177.066667c0-17.066667-14.933333-32-32-32s-32 14.933333-32 32v213.333333c2.133333 4.266667 2.133333 8.533333 4.266666 12.8z" fill="#666666" p-id="5444"></path></svg>';
        
        const switchFullscreen = () => {
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            this.element.requestFullscreen();
          }
        };

        // 监听全屏状态变化，更新按钮图标
        const fullscreenChangeHandler = () => {
          const fullscreenButton = iframe.contentDocument?.querySelector('.customFullscreenButton') as HTMLElement;
          if (fullscreenButton) {
            const iconDiv = fullscreenButton.querySelector('.tool-icon__icon');
            if (iconDiv) {
              iconDiv.innerHTML = document.fullscreenElement ? fullscreenOffLogo : fullscreenOnLogo;
            }
          }
        };
        document.addEventListener('fullscreenchange', fullscreenChangeHandler);

        const onInit = () => {
          cleanupXmindExportMenuInjection();
          cleanupXmindExportMenuInjection = that.setupXmindExportMenuInjection(iframe, imageInfo);

          let data = { children: [] };
          try {
            if (imageInfo.drawnixData) {
              data = JSON.parse(imageInfo.drawnixData);
            }
          } catch (e) {
            console.error("Failed to parse drawnix data", e);
          }
          postMessage({
            type: "init",
            data: data
          });
          
          // 等待 drawnix 工具栏渲染完成后添加全屏按钮
          let retryCount = 0;
          const maxRetries = 20;
          const addFullscreenButton = () => {
            try {
              const toolbarElement = iframe.contentDocument?.querySelector(".zoom-toolbar .stack_horizontal");
              if (toolbarElement) {
                // 创建全屏按钮,样式与drawnix工具栏按钮保持一致
                const doc = iframe.contentDocument;
                const fullscreenButton = doc.createElement('button');
                fullscreenButton.className = 'tool-icon_type_button tool-icon_size_medium customFullscreenButton tool-icon_type_button--show tool-icon';
                fullscreenButton.title = '全屏';
                fullscreenButton.setAttribute('aria-label', '全屏');
                fullscreenButton.type = 'button';
                
                const iconDiv = doc.createElement('div');
                iconDiv.className = 'tool-icon__icon';
                iconDiv.setAttribute('aria-hidden', 'true');
                iconDiv.setAttribute('aria-disabled', 'false');
                iconDiv.innerHTML = fullscreenOnLogo;
                
                fullscreenButton.appendChild(iconDiv);
                
                // 添加到工具栏最后
                toolbarElement.appendChild(fullscreenButton);
                fullscreenButton.addEventListener('click', switchFullscreen);
                
              } else if (retryCount < maxRetries) {
                retryCount++;
                setTimeout(addFullscreenButton, 100);
              } else {
                console.error('[Tab] Failed to find toolbar after max retries');
              }
            } catch (err) {
              console.error('[Tab] Error adding fullscreen button:', err);
            }
          };
          setTimeout(addFullscreenButton, 100);
        }

        const onSave = async (message: any) => {
          // Drawnix 会返回保存的数据
          if (message.data) {
            imageInfo.drawnixData = JSON.stringify(message.data);
          }
          try {
            await that.persistDrawnixPreviewImage(iframe, imageInfo);
          } catch (err) {
            console.error('[Tab] Failed to persist Drawnix preview image', err);
          }
          // 给思源发送保存通知（仅手动保存时）
          if (message.type === 'save') {
            try {
              const msg = (window as any)?.siyuan?.languages?.allChangesSaved || '保存成功';
            } catch (err) {
              console.error('Failed to send save notification', err);
            }
          }
        }

        const onExit = (message: any) => {
          this.tab.close();
        }

        const messageEventHandler = (event) => {
          // 只处理来自 iframe 的消息
          if (event.source !== iframe.contentWindow) return;

          try {
            const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            if (message != null) {
              // console.log('[Drawnix]', message.type);
              if (message.type == "ready") {
                onInit();
              }
              else if (message.type == "save" || message.type == "autosave") {
                void onSave(message);
              }
              else if (message.type == "exit") {
                onExit(message);
              }
            }
          }
          catch (err) {
            console.error(err);
          }
        };

        const keydownEventHandleer = (event: KeyboardEvent) => {
          that.tabHotKeyEventHandler(event, this);
        };

        window.addEventListener("message", messageEventHandler);
        iframe.contentWindow.addEventListener("keydown", keydownEventHandleer);
        this.beforeDestroy = () => {
          window.removeEventListener("message", messageEventHandler);
          iframe.contentWindow.removeEventListener("keydown", keydownEventHandleer);
          document.removeEventListener('fullscreenchange', fullscreenChangeHandler);
          cleanupXmindExportMenuInjection();
        };
      }
    });
  }

  public openEditTab(imageInfo: DrawnixImageInfo) {
    openTab({
      app: this.app,
      custom: {
        id: this.name + this.EDIT_TAB_TYPE,
        icon: "iconEdit",
        title: `${imageInfo.imageURL.split('/').pop()}`,
        data: imageInfo,
      }
    })
  }

  public openEditDialog(imageInfo: DrawnixImageInfo) {
    const iframeID = unicodeToBase64(`drawnix-edit-dialog-${imageInfo.imageURL}`);
    const editDialogHTML = `
  <div class="drawnix-edit-dialog">
    <div class="edit-dialog-header resize__move"></div>
    <div class="edit-dialog-container">
      <div class="edit-dialog-editor">
        <iframe src="/plugins/siyuan-plugin-drawnix/drawnix-embed/index.html?iframeID=${iframeID}"></iframe>
      </div>
      <div class="fn__hr--b"></div>
    </div>
  </div>
    `;

    const dialogDestroyCallbacks = [];

    const dialog = new Dialog({
      content: editDialogHTML,
      width: this.isMobile ? "92vw" : "90vw",
      height: "80vh",
      hideCloseIcon: this.isMobile,
      destroyCallback: () => {
        dialogDestroyCallbacks.forEach(callback => callback());
      },
    });

    // 在对话框右上角添加“在标签页打开”按钮，点击则放弃保存并直接在新标签打开编辑器
    const headerElement = dialog.element.querySelector('.edit-dialog-header') as HTMLElement;
    if (headerElement) {
      const openInTabBtn = document.createElement('button');
      openInTabBtn.className = 'b3-button b3-button--text open-in-tab-btn';
      openInTabBtn.type = 'button';
      openInTabBtn.style.margin = '6px';
      openInTabBtn.textContent = '在标签页打开';
      headerElement.appendChild(openInTabBtn);

      openInTabBtn.addEventListener('click', () => {
        // 直接在标签页打开，不等待保存（视为放弃对话框中的未保存改动）
        try {
          openTab({
            app: this.app,
            custom: {
              id: this.name + this.EDIT_TAB_TYPE,
              icon: "iconEdit",
              title: `${imageInfo.imageURL.split('/').pop()}`,
              data: imageInfo,
            }
          });
        } catch (err) {
          console.error('打开标签页失败', err);
        }
        // 关闭对话框（放弃保存）
        try {
          dialog.destroy();
        } catch (err) {
          console.error('关闭对话框失败', err);
        }
      });
    }

    const iframe = dialog.element.querySelector("iframe");
    iframe.focus();

    const postMessage = (message: any) => {
      if (!iframe.contentWindow) return;
      iframe.contentWindow.postMessage(message, '*');
    };
    let cleanupXmindExportMenuInjection = () => {};

    const onInit = () => {
      cleanupXmindExportMenuInjection();
      cleanupXmindExportMenuInjection = this.setupXmindExportMenuInjection(iframe, imageInfo);

      let data = { children: [] };
      try {
        if (imageInfo.drawnixData) {
          data = JSON.parse(imageInfo.drawnixData);
        }
      } catch (e) {
        console.error("Failed to parse drawnix data", e);
      }
      postMessage({
        type: "init",
        data: data,
        autosave: 1,
        modified: 'unsavedChanges',
        title: this.isMobile ? '' : imageInfo.imageURL,
      });
      
      // 等待 drawnix 工具栏渲染完成后添加全屏按钮
      let retryCount = 0;
      const maxRetries = 20;
      const addFullscreenButton = () => {
        try {
          const toolbarElement = iframe.contentDocument?.querySelector(".zoom-toolbar .stack_horizontal");
          if (toolbarElement) {
            // 创建全屏按钮,样式与drawnix工具栏按钮保持一致
            const doc = iframe.contentDocument;
            const fullscreenButton = doc.createElement('button');
            fullscreenButton.className = 'tool-icon_type_button tool-icon_size_medium customFullscreenButton tool-icon_type_button--show tool-icon';
            fullscreenButton.title = '全屏';
            fullscreenButton.setAttribute('aria-label', '全屏');
            fullscreenButton.type = 'button';
            
            const iconDiv = doc.createElement('div');
            iconDiv.className = 'tool-icon__icon';
            iconDiv.setAttribute('aria-hidden', 'true');
            iconDiv.setAttribute('aria-disabled', 'false');
            iconDiv.innerHTML = fullscreenOnLogo;
            
            fullscreenButton.appendChild(iconDiv);
            
            // 添加到工具栏最后
            toolbarElement.appendChild(fullscreenButton);
            fullscreenButton.addEventListener('click', switchFullscreen);
            
          } else if (retryCount < maxRetries) {
            retryCount++;
            setTimeout(addFullscreenButton, 100);
          } else {
            console.error('[Dialog] Failed to find toolbar after max retries');
          }
        } catch (err) {
          console.error('[Dialog] Error adding fullscreen button:', err);
        }
      };
      setTimeout(addFullscreenButton, 100);
    }

    let isFullscreen = false;
    let dialogContainerStyle = {
      width: "100vw",
      height: "100vh",
      maxWidth: "unset",
      maxHeight: "unset",
      top: "auto",
      left: "auto",
    };
    const fullscreenOnLogo = '<svg t="1763089104127" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="5274" width="24" height="24"><path d="M149.333333 394.666667c17.066667 0 32-14.933333 32-32v-136.533334l187.733334 187.733334c6.4 6.4 14.933333 8.533333 23.466666 8.533333s17.066667-2.133333 23.466667-8.533333c12.8-12.8 12.8-32 0-44.8l-187.733333-187.733334H362.666667c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32H149.333333c-4.266667 0-8.533333 0-10.666666 2.133334-8.533333 4.266667-14.933333 10.666667-19.2 17.066666-2.133333 4.266667-2.133333 8.533333-2.133334 12.8v213.333334c0 17.066667 14.933333 32 32 32zM874.666667 629.333333c-17.066667 0-32 14.933333-32 32v136.533334L642.133333 597.333333c-12.8-12.8-32-12.8-44.8 0s-12.8 32 0 44.8l200.533334 200.533334H661.333333c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h213.333334c4.266667 0 8.533333 0 10.666666-2.133334 8.533333-4.266667 14.933333-8.533333 17.066667-17.066666 2.133333-4.266667 2.133333-8.533333 2.133333-10.666667V661.333333c2.133333-17.066667-12.8-32-29.866666-32zM381.866667 595.2l-200.533334 200.533333V661.333333c0-17.066667-14.933333-32-32-32s-32 14.933333-32 32v213.333334c0 4.266667 0 8.533333 2.133334 10.666666 4.266667 8.533333 8.533333 14.933333 17.066666 17.066667 4.266667 2.133333 8.533333 2.133333 10.666667 2.133333h213.333333c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32h-136.533333l200.533333-200.533333c12.8-12.8 12.8-32 0-44.8s-29.866667-10.666667-42.666666 0zM904.533333 138.666667c0-2.133333 0-2.133333 0 0-4.266667-8.533333-10.666667-14.933333-17.066666-17.066667-4.266667-2.133333-8.533333-2.133333-10.666667-2.133333H661.333333c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h136.533334l-187.733334 187.733333c-12.8 12.8-12.8 32 0 44.8 6.4 6.4 14.933333 8.533333 23.466667 8.533333s17.066667-2.133333 23.466667-8.533333l187.733333-187.733333V362.666667c0 17.066667 14.933333 32 32 32s32-14.933333 32-32V149.333333c-2.133333-4.266667-2.133333-8.533333-4.266667-10.666666z" fill="#666666" p-id="5275"></path></svg>';
    const fullscreenOffLogo = '<svg t="1763089178999" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="5443" width="24" height="24"><path d="M313.6 358.4H177.066667c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h213.333333c4.266667 0 8.533333 0 10.666667-2.133333 8.533333-4.266667 14.933333-8.533333 17.066666-17.066667 2.133333-4.266667 2.133333-8.533333 2.133334-10.666667v-213.333333c0-17.066667-14.933333-32-32-32s-32 14.933333-32 32v136.533333L172.8 125.866667c-12.8-12.8-32-12.8-44.8 0-12.8 12.8-12.8 32 0 44.8l185.6 187.733333zM695.466667 650.666667H832c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32H618.666667c-4.266667 0-8.533333 0-10.666667 2.133333-8.533333 4.266667-14.933333 8.533333-17.066667 17.066667-2.133333 4.266667-2.133333 8.533333-2.133333 10.666666v213.333334c0 17.066667 14.933333 32 32 32s32-14.933333 32-32v-136.533334l200.533333 200.533334c6.4 6.4 14.933333 8.533333 23.466667 8.533333s17.066667-2.133333 23.466667-8.533333c12.8-12.8 12.8-32 0-44.8l-204.8-198.4zM435.2 605.866667c-4.266667-8.533333-8.533333-14.933333-17.066667-17.066667-4.266667-2.133333-8.533333-2.133333-10.666666-2.133333H192c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h136.533333L128 851.2c-12.8 12.8-12.8 32 0 44.8 6.4 6.4 14.933333 8.533333 23.466667 8.533333s17.066667-2.133333 23.466666-8.533333l200.533334-200.533333V832c0 17.066667 14.933333 32 32 32s32-14.933333 32-32V618.666667c-2.133333-4.266667-2.133333-8.533333-4.266667-12.8zM603.733333 403.2c4.266667 8.533333 8.533333 14.933333 17.066667 17.066667 4.266667 2.133333 8.533333 2.133333 10.666667 2.133333h213.333333c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32h-136.533333L896 170.666667c12.8-12.8 12.8-32 0-44.8-12.8-12.8-32-12.8-44.8 0l-187.733333 187.733333V177.066667c0-17.066667-14.933333-32-32-32s-32 14.933333-32 32v213.333333c2.133333 4.266667 2.133333 8.533333 4.266666 12.8z" fill="#666666" p-id="5444"></path></svg>';
    const switchFullscreen = () => {
      const dialogContainerElement = dialog.element.querySelector('.b3-dialog__container') as HTMLElement;
      if (dialogContainerElement) {
        isFullscreen = !isFullscreen;
        if (isFullscreen) {
          dialogContainerStyle.width = dialogContainerElement.style.width;
          dialogContainerStyle.height = dialogContainerElement.style.height;
          dialogContainerStyle.maxWidth = dialogContainerElement.style.maxWidth;
          dialogContainerStyle.maxHeight = dialogContainerElement.style.maxHeight;
          dialogContainerStyle.top = dialogContainerElement.style.top;
          dialogContainerStyle.left = dialogContainerElement.style.left;
          dialogContainerElement.style.width = "100vw";
          dialogContainerElement.style.height = "100vh";
          dialogContainerElement.style.maxWidth = "unset";
          dialogContainerElement.style.maxHeight = "unset";
          dialogContainerElement.style.top = "0";
          dialogContainerElement.style.left = "0";
        } else {
          dialogContainerElement.style.width = dialogContainerStyle.width;
          dialogContainerElement.style.height = dialogContainerStyle.height;
          dialogContainerElement.style.maxWidth = dialogContainerStyle.maxWidth;
          dialogContainerElement.style.maxHeight = dialogContainerStyle.maxHeight;
          dialogContainerElement.style.top = dialogContainerStyle.top;
          dialogContainerElement.style.left = dialogContainerStyle.left;
        }
        const fullscreenButton = iframe.contentDocument.querySelector('.customFullscreenButton') as HTMLElement;
        if (fullscreenButton) fullscreenButton.innerHTML = isFullscreen ? fullscreenOffLogo : fullscreenOnLogo;
      }
    }

    const onSave = async (message: any) => {
      if (message.data) {
        imageInfo.drawnixData = JSON.stringify(message.data);
      }
      try {
        await this.persistDrawnixPreviewImage(iframe, imageInfo, () => {
          postMessage({
            action: 'status',
            messageKey: 'allChangesSaved',
            modified: false
          });
        });
      } catch (err) {
        console.error('[Dialog] Failed to persist Drawnix preview image', err);
      }
      // 给思源发送保存通知（仅手动保存时）
      if (message.type === 'save') {
        try {
          const msg = (window as any)?.siyuan?.languages?.allChangesSaved || '保存成功';
        } catch (err) {
          console.error('Failed to send save notification', err);
        }
      }
    }

    const onExit = (message: any) => {
      dialog.destroy();
    }

    const messageEventHandler = (event) => {
      // Check source (optional, but good practice if we can verify iframeID)
      // if (!((event.source.location.href as string).includes(`iframeID=${iframeID}`))) return; 
      // Note: event.source.location might be restricted by cross-origin policy if domains differ, 
      // but here it's same origin (plugin). 
      // However, checking event.source against iframe.contentWindow is safer.
      if (event.source !== iframe.contentWindow) return;

      try {
        const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (message != null) {
          // console.log(message.type);
          if (message.type == "ready") {
            onInit();
          }
          else if (message.type == "save" || message.type == "autosave") {
            void onSave(message);
          }
          else if (message.type == "exit") {
            onExit(message);
          }
        }
      }
      catch (err) {
        console.error(err);
      }
    };

    window.addEventListener("message", messageEventHandler);
    dialogDestroyCallbacks.push(() => {
      window.removeEventListener("message", messageEventHandler);
      cleanupXmindExportMenuInjection();
    });
  }



  public reloadAllEditor() {
    getAllEditor().forEach((protyle) => { protyle.reload(false); });
  }

  public removeAllDrawnixTab() {
    getAllModels().custom.forEach((custom: any) => {
      if (custom.type == this.name + this.EDIT_TAB_TYPE) {
        custom.tab?.close();
      }
    })
  }

  public fixImageContent(imageDataURL: string) {
    // 解决SVG CSS5的light-dark样式在部分浏览器上无效的问题
    if (imageDataURL.startsWith('data:image/svg+xml')) {
      let base64String = imageDataURL.split(',').pop();
      let svgContent = base64ToUnicode(base64String);
      const regex = /light-dark\s*\(\s*((?:[^(),]|\w+\([^)]*\))+)\s*,\s*(?:[^(),]|\w+\([^)]*\))+\s*\)/gi;
      svgContent = svgContent.replace(regex, '$1');
      base64String = unicodeToBase64(svgContent);
      imageDataURL = `data:image/svg+xml;base64,${base64String}`;
    }
    // 设置PNG DPI
    // if (imageDataURL.startsWith('data:image/png')) {
    //   let binaryArray = base64ToArray(imageDataURL.split(',').pop());
    //   binaryArray = insertPNGpHYs(binaryArray, 96 * 2);
    //   const base64String = arrayToBase64(binaryArray);
    //   imageDataURL = `data:image/png;base64,${base64String}`;
    // }
    // 当图像为空时，使用默认的占位图
    const imageSize = getImageSizeFromBase64(imageDataURL);
    if (imageSize && imageSize.width <= 1 && imageSize.height <= 1) {
      if (imageDataURL.startsWith('data:image/svg+xml;base64,')) {
        let base64String = imageDataURL.split(',').pop();
        let svgContent = base64ToUnicode(base64String);
        const svgElement = HTMLToElement(svgContent);
        if (svgElement) {
          const defaultSvgElement = HTMLToElement(base64ToUnicode(this.getPlaceholderImageContent('svg').split(',').pop()));
          const contentValue = svgElement.getAttribute('content');
          if (contentValue) {
            defaultSvgElement.setAttribute('content', contentValue);
          }
          const drawnixMetadata = svgElement.getAttribute('data-drawnix');
          if (drawnixMetadata) {
            defaultSvgElement.setAttribute('data-drawnix', drawnixMetadata);
          }
          svgContent = defaultSvgElement.outerHTML;
          base64String = unicodeToBase64(svgContent);
          imageDataURL = `data:image/svg+xml;base64,${base64String}`;
        }
      }
      if (imageDataURL.startsWith('data:image/png;base64,')) {
        let binaryArray = base64ToArray(imageDataURL.split(',').pop());
        let defaultBinaryArray = base64ToArray(this.getPlaceholderImageContent('png').split(',').pop());
        const srcLocation = locatePNGtEXt(binaryArray);
        const destLocation = locatePNGtEXt(defaultBinaryArray);
        if (srcLocation && destLocation) {
          binaryArray = replaceSubArray(binaryArray, srcLocation, defaultBinaryArray, destLocation);
          const base64String = arrayToBase64(binaryArray);
          imageDataURL = `data:image/png;base64,${base64String}`;
        }
      }
    }
    return imageDataURL;
  }
}
