# MorphKit — Simple file converter

[English](README.md) | [繁體中文](README.zh-TW.md)

100% 靜態網站。圖片、音訊、影片、GIF、APNG 的轉換**與編輯**全部在瀏覽器內完成，零後端、零上傳。

## 轉換

圖片：PNG / JPG / WEBP / BMP / GIF / APNG / AVIF → WEBP / PNG / JPG / **APNG** / **GIF**（附品質滑桿；GIF ⇄ APNG 保留每一幀，APNG 保留完整 alpha，GIF 輸出可保留一位元透明或以背景色壓平）。音訊：MP3 / WAV / OGG / FLAC / M4A / AAC / OPUS 互轉。影片：MP4 / WEBM / MOV / AVI / MKV → MP4 / WEBM / GIF，或抽出 MP3 音軌。

批次工具列含整體進度與 ZIP 打包下載；可設定平行工作數（1–4 個 ffmpeg.wasm 實體共用一份 core）；設定抽屜含分類參數（圖片最長邊、音訊位元率/取樣率/聲道、影片 CRF/preset/解析度/幀率/靜音、GIF 幀率/寬度）。檔案資訊按類型顯示：尺寸、時長、估算位元率、照片 EXIF（相機、鏡頭、ISO、快門、光圈、GPS 附地圖連結）。Ctrl+V 直接貼上檔案加入列表；圖片結果一鍵複製回剪貼簿。

## 編輯

- **音訊／影片**：剪輯（雙把手時間軸＋播放位置取點）、音量、變速、旋轉——以 ffmpeg 參數在轉換時套用。
- **圖片**（Graphite 概念）：非破壞性物件模型＋圖層面板——每筆畫都可選取/移動/排序/隱藏；畫筆三種筆刷（鋼筆/麥克筆/螢光筆）、形狀、箭頭、文字（字體/粗體/自動對比描邊，中日文用系統字型）、裁切、旋轉/翻轉、**魔術棒去背**（flood fill 含容差）、縮放、40 步 undo、Ctrl+C 複製合成圖、Ctrl+V 貼上文字。
- **GIF / APNG**（ScreenToGif 概念）：影格縮圖條、播放/逐幀控制、逐幀刪除/複製/移動/延遲、重複幀合併、幀範圍剪裁、變速、倒轉、來回播放、**可拖曳的多字幕圖層**（各自的幀範圍）、透明度壓平＋背景色、輸出 GIF 或 APNG。

## 技術架構

- **Vite + React 18 + TypeScript**，`base: './'`，任何 GitHub Pages 路徑都能跑
- 靜態圖片走 Canvas API；動態圖片走 gifuct-js + gifenc + upng-js；音訊影片走 [ffmpeg.wasm](https://ffmpegwasm.netlify.app/) 單執行緒核心（約 31 MB，首次使用才從 CDN 載入；不需 COOP/COEP header，GitHub Pages 直接能用）
- 完整檔案地圖、不變量與設計語言請見 `CLAUDE.md`

## 本機開發

```bash
npm install
npm run dev      # 開發伺服器
npm run build    # 產出 dist/
```

## 部署到 GitHub Pages

1. 把這個資料夾 push 到 GitHub repo。
2. **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。
3. 之後每次 push 到 `main` 自動 build + 部署（`.github/workflows/deploy.yml`）。

## 已知限制

- 瀏覽器記憶體上限約 1.8–2 GB，超過的檔案會失敗（UI 會警告）
- ffmpeg.wasm 比原生慢 5–20 倍；WEBM（VP8）特別慢
- 動態圖片解碼上限 300 幀，過長的 GIF 會被截斷
- 較舊的 Safari 不支援 Canvas 輸出 WEBP；剪貼簿功能需要 HTTPS 環境
- 轉換引擎從 unpkg CDN 載入，離線時音訊／影片轉換無法使用（圖片不受影響）
