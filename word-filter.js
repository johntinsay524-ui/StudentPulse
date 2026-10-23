(function (root) {
  const source = value => String(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\p{M}\p{Cf}\p{Cc}]/gu, '');
  const normalize = value => source(value)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const normalizeIgnoringPunctuation = value => source(value)
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function matches(text, term) {
    const pattern = term.split(' ').map(escape).join('\\s+');
    return new RegExp('(^|[^\\p{L}\\p{N}])' + pattern + '(?=$|[^\\p{L}\\p{N}])', 'u').test(text);
  }

  function findBlockedWord(text, words) {
    const normalText = normalize(text);
    const punctuationFoldedText = normalizeIgnoringPunctuation(text);
    for (const word of words) {
      const term = normalize(word);
      if (!term) continue;
      if (matches(normalText, term) || (!term.includes(' ') && matches(punctuationFoldedText, term))) return word;
    }
    return null;
  }

  const api = { normalize, findBlockedWord };
  root.StudentPulseWordFilter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
