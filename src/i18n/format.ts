// Locale-aware number, plural and date helpers shared by the dictionaries.

export function fmt(locale: string) {
  const nf = new Intl.NumberFormat(locale), rules = new Intl.PluralRules(locale)
  const pct = new Intl.NumberFormat(locale, { style: 'percent' })
  const month = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' })
  const num = (x: number) => nf.format(x)
  return {
    num,
    /** Rounded to the half point, sign dropped (score estimates). */
    half: (x: number) => num(Math.round(Math.abs(x) * 2) / 2),
    /** "1 capture" / "2 captures": `one` covers 0 too in French. */
    plural: (n: number, one: string, other: string) => `${num(n)} ${rules.select(n) === 'one' ? one : other}`,
    pct: (p: number) => pct.format(p / 100),
    month: (iso: string) => month.format(new Date(iso)),
  }
}
