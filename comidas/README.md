# Comidas libres

Web app instalable (PWA) para iPhone que registra las comidas libres de un plan nutricional.
Todo corre en el dispositivo: sin servidor, sin cuentas, sin backend. Funciona offline.

## Qué hace

- **Botonera de un toque**: 🍔 Comida fuera del plan, 🍷 Alcohol y 🍰 Postre. Cada tecla suma ⅓; las tres juntas son una comida libre.
- Usa la fecha de hoy y detecta el momento por la hora (editable en ⚙️):
  Desayuno 05:00–11:00 · Almuerzo 11:00–15:30 · Merienda 15:30–19:00 · Cena 19:00–05:00.
  Se puede cambiar a Ayer / otro día u otro momento antes de tocar.
- Los toques del mismo momento y día se juntan en un solo registro (ej. cena con comida + alcohol = ⅔). Cada toque se puede deshacer.
- Tarjeta semanal: un círculo de tres porciones por cada comida libre permitida (por defecto 2 por semana, configurable). Si te pasás aparecen círculos extra punteados.
- Estado con color, ícono y texto en la semana, el mes, el listado de semanas y la gráfica semanal: ★ Semana limpia (0 comidas libres) y ✓ Vas bien / Dentro del plan en verde, = Al límite en blanco, ! Te pasaste en rojo. El mes se compara con lo permitido hasta hoy.
- Navegación por semana con las flechas ‹ ›: la tarjeta y los registros muestran la semana elegida ("Volver a esta semana" regresa).
- Resumen del mes con sus propias flechas y un selector de gráficas (tocá la gráfica para ver el detalle):
  **Acumulado** día a día contra el límite (tu cupo semanal repartido por día), **Por semana** (columnas con comida / alcohol / postre contra el cupo), **Momentos** (en qué momento del día caen) y **Calendario** (mapa de calor del mes).
  Debajo: total de comidas libres, cuántas veces hubo comida, alcohol y postre, y una barra por semana (tocándola vas a esa semana). El Excel suma la hoja `Resumen mensual`.
- Detalle opcional: tocando un registro se puede agregar qué fue y notas, cambiar día/hora/partes o borrarlo.
- **Exportar a Excel (.xlsx)** con dos hojas: `Comidas` (una columna Sí/No por parte y el valor, ej. 0.67) y `Resumen semanal`. En iPhone abre el menú Compartir → "Guardar en Archivos", WhatsApp, mail, etc.
- **Importar desde Excel**: lee la hoja `Comidas` (podés editarla en Numbers/Excel y volver a cargarla). Te deja reemplazar todo o combinar.

## Cómo instalarla en el iPhone

Hace falta servirla por HTTPS **una sola vez** para instalarla; después queda cacheada y funciona sin conexión.

1. Publicar esta carpeta con GitHub Pages (Settings → Pages → rama → `/root`), la URL queda `https://<usuario>.github.io/<repo>/comidas/`.
   Alternativas: arrastrar la carpeta a Netlify Drop, o `python3 -m http.server` en la compu + la misma Wi‑Fi (en ese caso sin HTTPS el modo offline no queda activo).
2. Abrir la URL en **Safari** en el iPhone.
3. Compartir → **Agregar a pantalla de inicio**.
4. Abrirla desde el ícono: corre a pantalla completa y offline.

## Dónde quedan los datos

- Se guardan en el almacenamiento local de la app (localStorage) en el iPhone. Nada sale del teléfono.
- Las apps agregadas a la pantalla de inicio no sufren el borrado automático de 7 días de Safari, pero si borrás la app se pierden los datos: **exportá el Excel de vez en cuando** como backup.
- iOS no permite que una web app escriba de forma continua sobre un archivo en Archivos, por eso el Excel se genera al exportar y se lee al importar.

## Archivos

- `index.html` – interfaz y estilos
- `app.js` – lógica, almacenamiento, exportar/importar Excel
- `vendor/xlsx.mini.min.js` – SheetJS 0.18.5 (incluida localmente para funcionar offline)
- `fonts/bricolage.woff2` – tipografía Bricolage Grotesque (OFL), local para funcionar offline
- `sw.js` – service worker (cache offline). Si cambiás archivos, subí la versión de `CACHE` para que el iPhone baje la nueva.
- `manifest.webmanifest`, `icon-*.png` – instalación en pantalla de inicio
