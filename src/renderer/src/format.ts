const nf = (min: number, max: number) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: min, maximumFractionDigits: max })

export const eur = (n: number): string => `${nf(2, 2).format(n)} €`
export const num = (n: number, decimals = 8): string => nf(0, decimals).format(n)
export const price = (n: number, decimals: number): string => nf(Math.min(decimals, 2), decimals).format(n)
export const pct = (n: number): string => `${nf(1, 1).format(n * 100)} %`
