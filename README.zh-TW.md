![MorphKit：在瀏覽器裡轉換、編輯圖片、音訊、影片、PDF 和文件，檔案不會上傳](docs/images/cover.webp)

# MorphKit

[English](README.md) | [繁體中文](README.zh-TW.md)

[![Deploy to GitHub Pages](https://github.com/NatLee/morphkit/actions/workflows/deploy.yml/badge.svg)](https://github.com/NatLee/morphkit/actions/workflows/deploy.yml)
[![線上版](https://img.shields.io/badge/live-natlee.github.io%2Fmorphkit-38dfff)](https://natlee.github.io/morphkit/)
![Vite + React + TypeScript](https://img.shields.io/badge/Vite%20%2B%20React%2018%20%2B%20TypeScript-0a0e1c)
[![授權：MIT](https://img.shields.io/badge/license-MIT-a3e635)](LICENSE)

MorphKit 是一個完全在瀏覽器裡執行的轉檔工具，附帶幾個小型編輯器。把圖片、音訊、影片、PDF 或文件丟進來，選好輸出格式就能下載。檔案不會上傳，因為根本沒有伺服器。整個網站都是靜態檔案，直接放在 GitHub Pages 就能用，也可以安裝成 App（PWA）。

**線上試用：** <https://natlee.github.io/morphkit/>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/home-zh-dark.webp">
  <img alt="MorphKit 轉檔畫面：清單裡有六個檔案，其中幾個已經轉好" src="docs/images/home-zh-light.webp">
</picture>

## 能轉哪些格式

![圖片、音訊、影片、PDF、文件的輸入與輸出格式](docs/images/formats-zh.webp)

## 功能

**轉檔**

- 批次轉換：顯示整體進度，可以「全部轉換」、「全部下載（ZIP）」，也能把清單裡的圖片和 PDF「合併成 PDF」。
- 圖片用 Canvas API 轉，附品質滑桿。GIF ⇄ APNG 會保留每一格；APNG 保留完整透明度；GIF 可以保留一位元透明，或壓在指定的底色上。
- 任何圖片都能轉成 ICO 圖示（網站的 favicon），一個檔案裡有 16～256 px 幾種尺寸，都不會比原圖大，圖片置中、四周透明。
- 音訊和影片用 [ffmpeg.wasm](https://ffmpegwasm.netlify.app/)（瀏覽器版 ffmpeg）轉。用的是單執行緒版本，伺服器不需要特別設定；可以同時開 1–4 個轉換引擎。目標格式支援時，標籤和專輯封面會一起保留。影片也能直接轉成任何一種音訊格式（MP3、WAV、OGG、FLAC、M4A）；影片沒有音軌時會直接說明，不會只顯示「轉換失敗」。
- PDF 頁面轉成 PNG / JPG / WEBP（多頁時打包成 ZIP）；PDF 文字可以轉成 TXT / DOCX / Markdown / HTML。有密碼的 PDF 在記憶體裡解鎖，密碼不會被存起來。
- 文件統一先轉成清理過的 HTML，再轉成目標格式：支援 Word、PowerPoint、Markdown、HTML、純文字、CSV / TSV、Excel / ODS 和 JSON。輸出 PDF 時會嵌入 Noto 字型，文字可以選取，中日韓文也沒問題。
- 依檔案類型顯示資訊：尺寸、長度、位元率、頁數、字數，照片的 EXIF 和 GPS（附地圖連結），以及圖片裡的 QR Code。
- 按 Ctrl+V 貼上：檔案或截圖會加進清單；純文字會變成一份新的 Markdown 筆記。
- **壓到指定大小**，給有上傳限制的地方用：選一個目標（圖片 100 KB～5 MB、影片 10～100 MB），每張圖都會壓到這個大小以下（先降品質，不夠才縮尺寸）；MP4 / WebM 會依片長算出位元率，讓檔案落在目標以下。大小用十進位算，「500 KB」就是 500,000 bytes，不管網站用哪種算法都不會超過。
- **文字辨識（OCR）**：把照片或截圖裡的字抓出來（圖片轉 TXT）；掃描的 PDF 轉成 TXT、Markdown、HTML 或 Word 時，沒有文字的頁面也會用同樣的方式辨識。支援繁體中文、簡體中文、日文、韓文和英文。辨識引擎和語言資料（約 4～8 MB）要你同意才會下載，只下載一次，存在瀏覽器裡；檔案本身不會離開你的電腦。
- **音量標準化**：讓每個檔案一樣大聲，可選串流平台（−14 LUFS）、Podcast（−16）或電視廣播（−23）。先量一遍再整體調高或調低一次，不會把聲音壓扁；MP4 / WebM 的聲音也會一起調。
- **每個檔案有自己的選項**：每張卡片會列出影響它這次轉檔的設定（這支影片的目標大小、那段錄音的音量），跟預設不一樣的會顯示成可以拿掉的標籤。設定面板放的是新檔案的預設值。
- 設定面板：圖片最長邊、目標大小和文字辨識語言；音訊位元率、VBR、取樣率、聲道、音量標準化；影片 CRF、目標大小、preset、解析度、幀率；GIF 幀率和寬度；PDF 轉圖解析度；文件頁面大小。

**編輯器**（按檔案上的「編輯」）

| 編輯器 | 可以做什麼 |
|---|---|
| 圖片 | 點陣圖層，可調不透明度、混合模式和遮罩；鋼筆 / 麥克筆 / 螢光筆、橡皮擦、直線、矩形、橢圓、箭頭、文字、油漆桶；裁切、旋轉、翻轉、縮放；魔術棒、矩形和套索選取；完整的復原歷史 |
| GIF / APNG | 影格縮圖條、播放和逐格；逐格刪除 / 複製 / 排序 / 調延遲；合併重複影格、剪裁範圍、變速、倒轉、來回播放；可拖曳的字幕；壓平透明 |
| PDF | 頁面縮圖加即時預覽；從 PDF 或圖片加頁、空白頁、排序、旋轉、翻轉、在頁面上畫、便利貼註解、浮水印、找出空白頁；輸出全部或部分頁面，可加頁碼、壓縮圖片、分割成 ZIP、AES-256 加密 |
| 文件 | Markdown 附格式工具列和即時預覽；Word 和 PowerPoint 會以 Markdown 編輯，存檔時重新產生原格式 |
| 試算表 | CSV / TSV / XLSX / XLS / ODS 表格編輯：工作表分頁，插入 / 移動 / 刪除列和欄，排序 |
| 音訊 / 影片 | 雙把手時間軸剪輯、音量、變速、旋轉、靜音或替換音軌 |

**專案**（2026 年 11 月以前叫 Studio）是給要分幾次完成的作品用的。專案存在瀏覽器裡（IndexedDB），頁面一開始就會說明，也會顯示佔了多少空間：多軌混音，可以錄音、匯出 WAV；影片專案會把混好的聲音一起匯出成 MP4；圖片、GIF、PDF 和文字專案會保留圖層和編輯內容。專案可以匯出、匯入成 ZIP。

**QR Code 工具** 可以產生網址、文字、Wi-Fi、名片和郵件的 QR Code（可調顏色、大小、留白、容錯等級、中央 Logo，輸出 PNG 或 SVG），也能從圖片、剪貼簿或相機讀取。

介面有 English、繁體中文、日本語三種語言，以及淺色、深色、跟隨系統三種主題。

![六個編輯器：圖片、PDF、GIF、文件、QR Code、專案工作區](docs/images/editors-zh.webp)

手機也能用，編輯器會切換成全螢幕、像 App 一樣的版面：

<img alt="MorphKit 在手機上：首頁、檔案清單和圖片編輯器" src="docs/images/mobile-zh.webp" width="720">

## 在本機執行

需要 Node.js 22.13 以上（CI 用的主版本寫在 `.nvmrc`）。

```bash
git clone https://github.com/NatLee/morphkit.git
cd morphkit
npm ci
npm run dev        # 開發伺服器，改程式會自動重新載入
```

其他指令：

```bash
npm test           # 單元測試（Vitest + jsdom）
npm run build      # 先做型別檢查，再把靜態網站打包到 dist/
npm run preview    # 在本機開 dist/，包含 service worker
```

service worker（讓網站能安裝、離線開啟的背景程式）只在正式版註冊。要測試安裝或離線開啟，請用 `npm run preview`。

## 部署到 GitHub Pages

打包時用 `base: './'`，所以 repo 叫什麼名字都能用。

1. Fork 或把 repo 推到 GitHub。
2. 到 **Settings → Pages → Build and deployment**，把 **Source** 設成 **GitHub Actions**。
3. 之後每次推到 `main`，都會跑測試、打包並部署（`.github/workflows/deploy.yml`）。測試寫在 `.github/workflows/ci.yml`，pull request 只跑這一份，不會部署。

## 哪些東西會連網

你的檔案不會離開瀏覽器。不過 App 本身會發出幾個網路請求：

- 第一次轉音訊或影片時，從 unpkg 下載 ffmpeg 核心（約 31 MB）。
- 文件轉成「文字可選取」的 PDF 時，從 Google Fonts 下載需要的 Noto 字型片段。下載失敗時會改用圖片頁面輸出。
- 第一次辨識圖片或掃描 PDF 裡的文字時，從 jsDelivr 下載辨識引擎和語言資料（約 4～8 MB）；會先跳出對話框，你同意才下載。
- 介面字型（Chakra Petch、IBM Plex）來自 Google Fonts。

## 已知限制

- 瀏覽器記憶體上限約 1.8–2 GB，更大的檔案會失敗；加入檔案時 App 會先提醒。
- ffmpeg.wasm 比原生 ffmpeg 慢 5–20 倍，WEBM（VP8）編碼特別慢。
- 動畫圖片最多解碼 300 格，更長的 GIF 會被截斷。
- PDF 轉 TXT / DOCX / Markdown / HTML 讀的是文字層。掃描的 PDF 沒有文字層，App 會直接說明，並建議改轉 PNG / JPG 或先用 OCR 工具（App 本身沒有內建 OCR）。
- 舊版 Safari 不支援 Canvas 輸出 WEBP；把結果複製到剪貼簿需要 HTTPS。
- 影片的目標大小要知道片長，片長是瀏覽器讀出來的。瀏覽器播不了的檔案（部分 AVI / WMV / FLV），卡片會請你先關掉目標大小，不會用猜的。

## 參與開發

`npm test` 和 `npm run build` 都要通過（每個 pull request 的 CI 都會跑）。改到程式結構時，也請跑 `npm run check:context`。

程式附有一套文字地圖，人和程式助手都能用。先看 `CLAUDE.md`，再打開你要改的那一塊的地圖：

| 文件 | 內容 |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | 指令、`src/` 每個檔案的用途、不變條件（每一條都對應一個真的發生過的問題），以及設計語言 |
| [`docs/claude/app-shell.md`](docs/claude/app-shell.md) | 轉檔畫面：App 的狀態、轉檔怎麼分流、檔案卡片、設定面板、小元件 |
| [`docs/claude/editors.md`](docs/claude/editors.md) | 圖片、GIF / APNG、PDF 和文件編輯器 |
| [`docs/claude/studio.md`](docs/claude/studio.md) | 專案（程式裡這一塊仍然叫 Studio）、混音器和影片專案 |
| [`docs/claude/libs.md`](docs/claude/libs.md) | `src/lib/` 的所有模組：ffmpeg 參數、格式、設定、PDF、文件、QR Code、翻譯 |
| [`docs/claude/styles.md`](docs/claude/styles.md) | `styles.css` 的分區、主題和手機版面 |
| [`docs/claude/README.md`](docs/claude/README.md) | 這套地圖怎麼分層、怎麼保持跟程式一致 |
| [`.claude/skills/`](.claude/skills/) | 新增轉檔設定、新增輸出格式的步驟 |

地圖裡寫到的檔案、函式或 CSS class 已經不存在、`src/` 裡有檔案在 `CLAUDE.md` 沒有對應的一行，或三種介面語言的字串鍵不一致時，`npm run check:context` 都會失敗。改程式時，請在同一個 commit 更新對應的地圖。

README 用到的圖片在 [`docs/images/`](docs/images/)。封面的原始檔是 [`cover.html`](docs/images/cover.html)，檔頭寫了怎麼重新產生。

## 授權

[MIT](LICENSE)。可以自由使用、修改，也可以架一份自己的；保留版權聲明就好。
