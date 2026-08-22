/**
 * Pulls the OCR models at build time so they are baked into the image. Without
 * this the first rider after every deploy waits for a ~15MB download mid-chat.
 * Never fails the build: if the download is unavailable the app still boots and
 * simply accepts documents unchecked.
 */
try {
  const { PaddleOcrService } = await import('ppu-paddle-ocr')
  await PaddleOcrService.downloadModels({ verbose: true })
  console.log('ocr models cached')
} catch (err) {
  console.warn('ocr models not cached:', err?.message ?? err)
}
