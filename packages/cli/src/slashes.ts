/**
 * Removes the slashes at the end of a URL or a path.
 *
 * It walks back from the end, so its time grows with the text's length. A
 * regular expression ending in `/+$` backtracks on a long run of slashes.
 */
export function trimEndSlashes(text: string): string {
  let end = text.length
  while (end > 0 && text[end - 1] === '/') end--
  return text.slice(0, end)
}
