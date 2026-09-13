/**
 * Shrinks a photograph before it is uploaded.
 *
 * A phone camera hands back four to eight megabytes, and the riders this is for
 * are on 3G with a data cap. Drawn through a canvas at 1600px on the long edge
 * the same CNIC is about three hundred kilobytes — and, as a side effect worth
 * more than the saving, the browser bakes in the EXIF orientation while it
 * draws, so a card photographed with the phone held sideways is no longer
 * handed to OCR lying on its side.
 *
 * Anything that goes wrong returns the original file: a photograph that is too
 * big is still a photograph, and one that is lost is not.
 */
const MAX_EDGE = 1600
const QUALITY = 0.85

export async function shrinkImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file

  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    // decode() is the reliable signal on Chrome; older browsers only fire load.
    await (img.decode ? img.decode() : new Promise<void>((ok, no) => {
      img.onload = () => ok()
      img.onerror = () => no(new Error('undecodable'))
    }))
    const w0 = img.naturalWidth
    const h0 = img.naturalHeight
    if (!w0 || !h0) return file

    const scale = Math.min(1, MAX_EDGE / Math.max(w0, h0))
    const w = Math.round(w0 * scale)
    const h = Math.round(h0 * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const g = canvas.getContext('2d')
    if (!g) return file
    g.drawImage(img, 0, 0, w, h)

    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', QUALITY))
    if (!blob) return file
    // Re-encoding a small file can make it bigger. Then the original was fine.
    if (scale === 1 && blob.size >= file.size) return file
    const name = file.name.replace(/\.[^.]+$/, '') || 'photo'
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(url)
  }
}
