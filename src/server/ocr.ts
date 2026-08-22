/**
 * PaddleOCR via onnxruntime, in-process. No Python, no second service.
 *
 * Everything here fails open: if OCR is unavailable or throws, the caller gets
 * null and the document is accepted unchecked. A rider must never be blocked
 * because our model failed to load — the branch visit is the real backstop.
 */
export const OCR_ENABLED = process.env.OCR_ENABLED !== 'false'

export type Word = { text: string; x: number; y: number; w: number; h: number }
export type Reading = { lines: string[]; words: Word[] }

type Service = {
  recognize: (
    image: ArrayBuffer,
    options?: { flatten?: boolean },
  ) => Promise<{
    text?: string
    results?: { text?: string; box?: { x: number; y: number; width: number; height: number } }[]
  }>
}

let pending: Promise<Service | null> | null = null

function service(): Promise<Service | null> {
  if (!pending) {
    pending = (async () => {
      try {
        const mod = (await import('ppu-paddle-ocr')) as {
          PaddleOcrService: new () => Service & { initialize: () => Promise<void> }
        }
        const svc = new mod.PaddleOcrService()
        await svc.initialize()
        console.log('ocr: ready')
        return svc
      } catch (err) {
        console.error('ocr: unavailable —', err instanceof Error ? err.message : err)
        return null
      }
    })()
  }
  return pending
}

/** Load the models at boot so no rider pays for it mid-conversation. */
export function warmOcr() {
  if (OCR_ENABLED) void service()
}

export async function read(bytes: Uint8Array, mime: string): Promise<Reading | null> {
  if (!OCR_ENABLED) return null

  // A PDF with its text layer intact beats OCR outright — exact characters and
  // exact positions. One with only a scan inside returns null and is accepted
  // unchecked, same as before.
  if (mime === 'application/pdf') {
    const { readPdf } = await import('./pdf.ts')
    return readPdf(bytes)
  }

  try {
    const svc = await service()
    if (!svc) return null

    const image = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer

    // Grouped text keeps label and value on one line, which suits the ID cards.
    // The flattened pass gives boxes, which the bill needs. The second call is
    // served from the library's own cache.
    const grouped = await svc.recognize(image)
    const flat = await svc.recognize(image, { flatten: true })

    const lines = (grouped.text ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)

    const words: Word[] = (flat.results ?? [])
      .filter((r) => r.text && r.box)
      .map((r) => ({
        text: r.text!.trim(),
        x: r.box!.x,
        y: r.box!.y,
        w: r.box!.width,
        h: r.box!.height,
      }))

    return { lines, words }
  } catch (err) {
    console.error('ocr: read failed —', err instanceof Error ? err.message : err)
    return null
  }
}
