/**
 * One argument as a POSIX shell reads it back unchanged. A value of plain
 * characters is left bare. Anything else goes in single quotes, where the
 * only character that needs care is the single quote itself.
 */
export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+:,./-]+$/.test(value)) return value
  return `'${value.replaceAll("'", `'\\''`)}'`
}
