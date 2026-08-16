/** Convert an image entirely in the browser via Canvas — no library download needed. */
export async function convertImage(
  file: File,
  target: 'png' | 'jpeg' | 'webp',
  quality: number
): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('decode');
  });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  if (target === 'jpeg') {
    // JPEG has no alpha channel — composite on white
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, `image/${target}`, quality)
  );
  if (!blob) throw new Error('encode');
  return blob;
}
