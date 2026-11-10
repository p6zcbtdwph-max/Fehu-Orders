// Hell/Dunkel folgt dem System (vereinfachte Fassung aus dem Lifemanager)
function apply(): void {
  document.documentElement.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches)
}

export function initTheme(): void {
  apply()
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply)
}
