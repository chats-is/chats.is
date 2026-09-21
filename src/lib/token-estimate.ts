/**
 * Roughly how many tokens a piece of text is.
 *
 * Not a tokenizer — there are eight providers behind this app and no two count
 * alike. It is for the two places that need a number before, or instead of,
 * the provider's own: deciding how much of a long conversation still fits, and
 * charging for a reply that was stopped before the provider reported anything.
 *
 * English runs about four characters to a token. Text outside ASCII does not:
 * a Chinese character is a token or more by itself, and counting it as a
 * quarter of one would let a conversation grow to four times what fits. So
 * ASCII is counted by fours and everything else one each.
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const char of text) {
    if (char.charCodeAt(0) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 4) + other;
}
