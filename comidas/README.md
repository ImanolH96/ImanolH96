# Comidas libres

Web app instalable (PWA) para iPhone que registra las comidas libres de un plan nutricional.
Todo corre en el dispositivo: sin servidor, sin cuentas, sin backend. Funciona offline.

## Qué hace

- Registrar comida libre: fecha, hora, momento (desayuno/almuerzo/…), qué comiste, dónde/con quién, disfrute (1–5) y notas.
- Contador semanal contra tu cupo (configurable en ⚙️, por defecto 2 por semana; semana de lunes o domingo).
- Historial con editar y borrar.
- **Exportar a Excel (.xlsx)** con dos hojas: `Comidas` y `Resumen semanal`. En iPhone abre el menú Compartir → "Guardar en Archivos" (iCloud Drive o En mi iPhone), WhatsApp, mail, etc.
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
- `sw.js` – service worker (cache offline). Si cambiás archivos, subí la versión de `CACHE` para que el iPhone baje la nueva.
- `manifest.webmanifest`, `icon-*.png` – instalación en pantalla de inicio
