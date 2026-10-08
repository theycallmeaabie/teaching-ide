/**
 * The teacher's words, without the long dash.
 *
 * The model is told not to use it and mostly obeys, but it is a habit models
 * have, and it is the quickest tell that a sentence was machine-written. So
 * whatever arrives is normalised on the way in: a dash with its spaces becomes
 * a comma, and a comma left dangling against other punctuation is tidied.
 *
 * While text is still streaming, apply it to the whole text so far, never to a
 * single chunk: a dash and its spaces can arrive split across chunks. Pass
 * `final` only for text that is complete, because a trailing comma may still be
 * waiting for the words that follow it.
 */
export function plain(text: string, final = false): string {
  const out = text
    .replace(/\s*\u2014\s*/g, ', ')
    .replace(/,(\s*,)+/g, ',')
    .replace(/,\s*([.!?:;)])/g, '$1')
    .replace(/,[ \t]{2,}/g, ', ')
    .replace(/^\s*,\s*/, '')
  return final ? out.replace(/,\s*$/, '') : out
}
