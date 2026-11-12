/** Datum nach der Uhr des Macs (nicht UTC), z. B. für Dateinamen: am 1.1.2027 um 00:30 in Berlin „2027-01-01“ */
export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
