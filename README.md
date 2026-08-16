# MorphKit — 瑞士刀級檔案轉換器

100% 靜態網站。圖片、音訊、影片轉換全部在瀏覽器內完成，檔案永遠不會離開使用者的裝置。

## 功能

支援三大類轉換：圖片（PNG / JPG / WEBP / BMP / GIF / AVIF → WEBP / PNG / JPG，附品質滑桿）、音訊（MP3 / WAV / OGG / FLAC / M4A / AAC / OPUS 互轉）、影片（MP4 / WEBM / MOV / AVI / MKV → MP4 / WEBM / GIF，或抽出 MP3 音軌）。介面支援深淺色主題與三語系（中文／English／日本語），設定會記憶在 localStorage。

進階功能：轉換進度條（含引擎下載進度）；可設定的平行工作數（1–4 個 worker，每個是獨立的 ffmpeg.wasm 實體，core 只下載一次共用）；轉換參數面板（音訊位元率、影片 CRF、GIF 幀率與寬度）；檔案 metadata 萃取——圖片尺寸、影音時長，以及照片 EXIF（相機型號、鏡頭、ISO、快門、光圈、焦距、拍攝時間、GPS 位置附地圖連結，透過 [exifr](https://github.com/MikeKovarik/exifr) 解析）。

## 技術架構

- **Vite + React + TypeScript**，`base: './'` 讓 build 結果在任何 GitHub Pages 路徑下都能運作
- **圖片**：瀏覽器原生 Canvas API，零額外下載
- **音訊／影片**：[ffmpeg.wasm](https://ffmpegwasm.netlify.app/) 單執行緒核心（約 31 MB），首次使用時才從 CDN 延遲載入。單執行緒版不需要 COOP/COEP header，因此 GitHub Pages 可以直接跑
- 轉換任務以佇列序列化執行（ffmpeg.wasm 一次只能跑一個任務）

## 本機開發

```bash
npm install
npm run dev      # 開發伺服器
npm run build    # 產出 dist/
```

## 部署到 GitHub Pages

1. 在 GitHub 建立 repo，push 這個資料夾：

   ```bash
   git init
   git add -A
   git commit -m "MorphKit initial commit"
   git branch -M main
   git remote add origin https://github.com/<你的帳號>/<repo名>.git
   git push -u origin main
   ```

2. 到 repo 的 **Settings → Pages → Build and deployment → Source**，選 **GitHub Actions**。
3. push 到 `main` 就會自動 build + 部署（workflow 在 `.github/workflows/deploy.yml`）。

## 已知限制

- 瀏覽器記憶體上限約 1.8–2 GB，超過的檔案幾乎必定失敗（UI 會警告使用者）
- ffmpeg.wasm 比原生 ffmpeg 慢 5–20 倍，大影片請耐心等候；轉 WEBM（VP8）特別慢
- 動態 GIF 目前以圖片處理（只取第一格）；要保留動畫請把來源當影片轉 GIF
- Canvas 轉出 WEBP 在較舊的 Safari 不支援
- 轉換引擎從 unpkg CDN 載入，離線時音訊／影片轉換無法使用（圖片不受影響）
