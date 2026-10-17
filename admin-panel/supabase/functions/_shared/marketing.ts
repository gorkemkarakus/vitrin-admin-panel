// Ticari ileti (kampanya) kurallari — 6563 sayili Kanun / IYS.

// Her kampanya mesajinin sonuna sunucu tarafinda eklenir; isletme kaldiramaz.
export const OPT_OUT_FOOTER = 'Kampanya mesajı almak istemiyorsanız RET yazın.'

// Musterinin mesaji YALNIZCA bu kelimeden ibaretse ret sayilir ("iptal"
// randevu iptali icin kullanildigindan bilerek listede yok).
const OPT_OUT_WORDS = new Set(['ret', 'red', 'stop'])

export function isOptOutMessage(text: string): boolean {
  const normalized = text
    .toLocaleLowerCase('tr')
    .replace(/[^a-zçğıöşü ]/g, '')
    .trim()
  return OPT_OUT_WORDS.has(normalized)
}

export function withOptOutFooter(message: string): string {
  return message.includes(OPT_OUT_FOOTER) ? message : `${message.trimEnd()}\n\n${OPT_OUT_FOOTER}`
}
