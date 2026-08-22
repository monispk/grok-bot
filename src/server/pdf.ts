import type { Reading, Word } from './ocr.ts'

/**
 * A PDF that still has its text layer — a bill downloaded from the utility's own
 * site rather than photographed — needs no OCR at all. The characters and their
 * positions are already in the file, so extraction is exact rather than ~95%,
 * and the same geometry rules apply because we keep the coordinates.
 *
 * A PDF that is only a scan has no text layer. That returns null and the caller
 * accepts the document unchecked.
 */
export async function readPdf(bytes: Uint8Array): Promise<Reading | null> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await pdfjs.getDocument({
      data: bytes,
      // Server side: no fonts to render, no worker to spawn. The standard font
      // data still has to be locatable or every parse logs a warning.
      disableFontFace: true,
      useSystemFonts: false,
      standardFontDataUrl: new URL(
        '../../node_modules/pdfjs-dist/standard_fonts/',
        import.meta.url,
      ).href,
    }).promise

    const words: Word[] = []
    const pages = Math.min(doc.numPages, 3)

    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n)
      const height = page.getViewport({ scale: 1 }).height
      const content = await page.getTextContent()

      for (const item of content.items) {
        const it = item as { str?: string; transform?: number[]; width?: number; height?: number }
        const text = (it.str ?? '').trim()
        if (!text || !it.transform) continue
        const h = it.height || 10
        words.push({
          text,
          x: it.transform[4] ?? 0,
          // PDF coordinates start at the bottom; ours start at the top.
          y: height - (it.transform[5] ?? 0) - h,
          w: it.width || text.length * (h * 0.5),
          h,
        })
      }
    }
    await doc.cleanup()

    if (words.length === 0) return null // scanned PDF, nothing to read

    // Rebuild reading lines by grouping words that share a baseline.
    const sorted = [...words].sort((a, b) => a.y - b.y || a.x - b.x)
    const lines: string[] = []
    let row: Word[] = []
    let baseline = Number.NaN

    const flush = () => {
      if (!row.length) return
      lines.push(
        row
          .sort((a, b) => a.x - b.x)
          .map((w) => w.text)
          .join(' '),
      )
      row = []
    }

    for (const w of sorted) {
      if (Number.isNaN(baseline) || Math.abs(w.y - baseline) <= Math.max(3, w.h * 0.6)) {
        if (Number.isNaN(baseline)) baseline = w.y
        row.push(w)
      } else {
        flush()
        baseline = w.y
        row = [w]
      }
    }
    flush()

    return { lines, words }
  } catch {
    return null
  }
}
