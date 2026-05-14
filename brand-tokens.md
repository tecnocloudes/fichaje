# Brand tokens · empleaIA

Este archivo es el ADN visual compartido entre empleaia-landing
(la web) y fichaje (la app). Cualquier cambio aquí debe aplicarse
en los dos proyectos. Regla para saber si algo va aquí o en el
design-system específico: ¿esto debe sentirse igual en landing y
en app? Si sí, va aquí.

## Identidad

Nombre comercial: empleaIA
Razón social: Social Media Cloud Solutions, S.L.
Dominio web: empleaia.es
Dominio app: app.empleaia.es

## Color

### Marca (paleta Royal Blue + Navy + Sky)
--brand-indigo:       #2563EB   Acento principal. Botones primarios,
                                enlaces activos, elementos seleccionados.
--brand-indigo-hover: #1E40AF   Estado hover.
--brand-indigo-deep:  #0F172A   Navy. Texto profundo, fondo dark, base
                                de gradientes volumétricos.
--brand-indigo-soft:  #DBE1FF   Fondos sutiles (badges, hover suave,
                                chips activos).
--brand-sky:          #7DD3FC   Tertiary. Acentos, glassmorphic tints,
                                highlights aireados.
--brand-sky-soft:     #C0E8FF   Background de chips/status.

### Texto
--ink:        #191C1E           Texto principal.
--ink-muted:  #434655           Texto secundario.
--ink-subtle: #737686           Texto terciario, placeholders.

### Estado
--ok:   #10B981                 Fichado, guardado, éxito.
--warn: #F59E0B                 En pausa, advertencia.
--err:  #BA1A1A                 Error real, no para "sin fichar".
--info: #2563EB                 Mismo que marca.

### Estructura
--line:        #E0E3E5          Bordes y separadores estándar.
--line-strong: #C3C6D7          Bordes con más peso visual.

Nota: los fondos (--bg) viven en cada design-system específico.
La landing usa #F7F9FB (neutro frío) con washes Royal Blue + Sky en
el hero. La app usa #FFFFFF o #FAFAFA (neutro de trabajo, sin
washes).

## Tipografía

### Familias
- Display (titulares, marketing): Montserrat (600, 700).
- Body: Inter (variable). Sustituye al antiguo Geist.
- Mono: JetBrains Mono (gratis, para timestamps, horas, IDs,
  números, código).

La display font de marketing (Montserrat con tratamientos grandes
y heroicos) se carga sin restricción en la landing. La app la
puede usar solo en titulares destacados del dashboard; en
formularios y tablas siempre Inter.

### Pesos a cargar
Montserrat: 600, 700
Inter: variable (todos los pesos vía variable font)
JetBrains Mono: 400, 500

## Iconografía

Set único en los dos proyectos: Lucide (stroke-width 1.5).
Tamaños canónicos: 16, 20, 24.
Prohibido mezclar sets. Si falta un icono en Lucide, se dibuja
a mano respetando stroke-width 1.5.

## Movimiento

### Easings
--ease-out-expo:     cubic-bezier(0.16, 1, 0.3, 1)
--ease-in-out-quart: cubic-bezier(0.76, 0, 0.24, 1)

Nunca usar el ease-in-out por defecto del navegador.

### Duraciones
- Microinteracción (hover, focus, toggle): 150ms
- Transición funcional (modal, drawer, menú): 200ms
- Transición narrativa (solo landing, no app): 400-600ms

## Volumetría — diferencia landing/app

La landing aplica el lenguaje Stitch completo: **soft 3D shadows,
gradientes pronunciados Royal Blue→Navy, glassmorphism con
backdrop-blur, glow primary en CTAs y mockups, halos ambientales**.

La app (fichaje) **no** aplica volumetría agresiva. Hereda la misma
paleta y la misma tipografía, pero los componentes son planos:
- Botones primary: color sólido `--brand-indigo` con shadow-sm.
  Sin gradient vertical ni glow.
- Cards: shadow-sm, border 1px `--line`. Sin glow tinted ni
  inner border luminoso.
- Inputs: border 1px, focus con ring `--brand-indigo` 30%.

Razón: la landing convence en 30 segundos, la app trabaja 8 horas
al día. La volumetría cansa en jornadas largas.

## Tono de voz

- Castellano de España. Tuteo.
- Frases cortas, verbos en presente.
- Cero exclamaciones decorativas.
- Cero emojis en UI (sí en marketing si encaja).
- Errores sin culpar al usuario: "No hemos podido guardar los
  cambios" en vez de "Has introducido datos inválidos".
- Números con separador de miles europeo: 1.250 € (no 1250 €).
- Horas en formato 24h: 16:30 (no 4:30 PM).
- Fechas: 14 nov 2026 o 14/11/2026 (nunca 11/14/2026).

## Logo y favicon

Símbolo: cuadrado redondeado con gradiente Royal Blue → Navy
(#2563EB → #0F172A) y un arco abierto blanco (loading/tracker)
con punto central.

- Implementación landing: `public/stitch/logo-source.png` (PNG
  3D generado en Stitch), recortado con `object-position: top`
  para mostrar solo el isotipo cuando el wordmark va en HTML.
- Implementación app: `EmpleaIASymbol` (SVG inline) con el mismo
  gradient Royal Blue → Navy.

Wordmark: "emplea" en `--ink`, "IA" en `--brand-indigo`. Fuente
Inter bold, `tracking: -0.02em`. En la landing puede subir a
Montserrat 700.

Reglas:
- Tamaño mínimo isotipo: 20px.
- Área de respeto: medio isotipo a cada lado.
- Versión en negativo: isotipo igual (el gradient se sostiene
  sobre Navy), wordmark con "emplea" en blanco y "IA" en
  `--brand-sky`.
