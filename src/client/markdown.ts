import { marked } from 'marked'

// Model output is untrusted. We escape every HTML-significant character before
// parsing, so no raw HTML can survive, then neutralise any non-http(s) link
// target that markdown syntax could still smuggle through.
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string,
  )

marked.use({
  gfm: true,
  breaks: true,
  walkTokens(token) {
    if (token.type === 'link' || token.type === 'image') {
      const href = String((token as { href?: string }).href ?? '')
      if (!/^(https?:|mailto:)/i.test(href)) (token as { href: string }).href = '#'
    }
  },
})

export function render(src: string): string {
  return marked.parse(escapeHtml(src), { async: false }) as string
}
