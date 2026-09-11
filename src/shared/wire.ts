/**
 * What actually goes upstream: a role and words, nothing else.
 *
 * A message in the thread also carries how it should be drawn — whether it is a
 * photo or a voice note, where its audio lives, whether it is still uploading.
 * Groq rejects the entire request if any of that reaches it ("property 'kind'
 * is unsupported"), and it rejected a real rider's spoken question that way. So
 * the shape is rebuilt here rather than trusted to be clean, by both the client
 * and the server, because whichever one forgets is the one that breaks.
 */
export type Wire = { role: 'user' | 'assistant'; content: string }

/**
 * Images, documents and the scripted voice notes carry empty content and drop
 * out. A transcribed voice note carries the rider's own words and stays.
 */
export function forModel(messages: readonly unknown[]): Wire[] {
  const out: Wire[] = []
  for (const m of messages) {
    const v = m as { role?: unknown; content?: unknown } | null
    if (!v) continue
    if (v.role !== 'user' && v.role !== 'assistant') continue
    if (typeof v.content !== 'string') continue
    const content = v.content.trim()
    if (!content) continue
    out.push({ role: v.role, content })
  }
  return out
}
