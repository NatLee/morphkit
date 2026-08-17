/** Convert an image entirely in the browser via Canvas — no library download needed. */
export async function convertImage(
  file: File,
  target: 'png' | 'jpeg' | 'webp',
  quality: number,
  /** Longest-edge cap in px; 0 keeps the original size. Never upscales. */
  maxDim = 0
): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('decode');
  });
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = maxDim > 0 && longest > maxDim ? maxDim / longest : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  if (target === 'jpeg') {
    // JPEG has no alpha channel — composite on white
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, `image/${target}`, quality)
  );
  if (!blob) throw new Error('encode');
  return blob;
}
