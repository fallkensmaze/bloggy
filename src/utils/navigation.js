// Single catalogue for desktop and mobile: new tools cannot disappear on one menu.
export const NAV_SECTIONS = ['Blog', 'Medicina nuclear', 'Radioterapia', 'Resonancia magnética', 'Radioafición', 'Herramientas', 'Juegos']
export const NAV_LINKS = [
  { href: '/', icon: 'bi-house-door', label: 'Inicio', section: 'Blog' },
  { href: '/convert-units', icon: 'bi-arrow-left-right', label: 'Conversor Ci–Bq', section: 'Medicina nuclear' },
  { href: '/decay-calculator', icon: 'bi-clock-history', label: 'Decay Calculator', section: 'Medicina nuclear' },
  { href: '/restricciones-lu177', icon: 'bi-activity', label: 'Lu-177 Restricciones', section: 'Medicina nuclear' },
  { href: '/uniformidad-gamma', icon: 'bi-grid-1x2-fill', label: 'Uniformidad NEMA', section: 'Medicina nuclear' },
  { href: '/centro-rotacion-spect', icon: 'bi-crosshair', label: 'Centro rotación SPECT', section: 'Medicina nuclear' },
  { href: '/resolucion-espacial-gamma', icon: 'bi-rulers', label: 'Resolución espacial', section: 'Medicina nuclear' },
  { href: '/sensibilidad-gamma', icon: 'bi-speedometer2', label: 'Sensibilidad', section: 'Medicina nuclear' },
  { href: '/informe-mensual-gamma', icon: 'bi-calendar-check', label: 'Informe mensual privado', section: 'Medicina nuclear', admin: true },
  { href: '/informe-tanques', icon: 'bi-droplet-half', label: 'Tanques Lu-177', section: 'Medicina nuclear' },
  { href: '/pet-nema-fraccionamiento', icon: 'bi-prescription2', label: 'Fraccionamiento PET', section: 'Medicina nuclear' },
  { href: '/pet-nema-analisis', icon: 'bi-bullseye', label: 'Análisis PET NEMA', section: 'Medicina nuclear' },
  { href: '/rtplan-compare', icon: 'bi-file-earmark-diff', label: 'Comparar RT Plans', section: 'Radioterapia' },
  { href: '/tg43-calculator', icon: 'bi-radioactive', label: 'Calculador TG-43', section: 'Radioterapia' },
  { href: '/dosimetria-pelicula', icon: 'bi-film', label: 'Dosimetría de película', section: 'Radioterapia' },
  { href: '/rt-anonymizer', icon: 'bi-shield-lock', label: 'Anonimizar RT', section: 'Radioterapia' },
  { href: '/acr-qc', icon: 'bi-magnet', label: 'ACR MRI QC', section: 'Resonancia magnética' },
  { href: '/q-codes', icon: 'bi-broadcast', label: 'Códigos Q', section: 'Radioafición' },
  { href: '/morse', icon: 'bi-soundwave', label: 'Código Morse', section: 'Radioafición' },
  { href: '/fdtd-simulator', icon: 'bi-wifi', label: 'Simulador FDTD', section: 'Radioafición' },
  { href: '/radioaficionado', icon: 'bi-mortarboard', label: 'Examen radio', section: 'Radioafición', admin: true },
  { href: '/lector', icon: 'bi-speedometer2', label: 'Lector rápido', section: 'Herramientas' },
  { href: '/quizzes', icon: 'bi-trophy', label: 'Quizzes', section: 'Juegos' }
]
