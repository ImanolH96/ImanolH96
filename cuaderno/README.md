# Cuaderno

PWA instalable (iPhone/Android) para guardar **recetas** (con fotos, ingredientes y pasos), **ejercicios del gimnasio** (series, reps, peso, descanso) y **notas**, y para editarlas con ChatGPT, Claude o Gemini. Sin servidor ni cuentas; funciona offline.

## Cómo se edita con una IA
No usa APIs ni claves: el puente es copiar y pegar un JSON.
1. En ✨, escribí qué querés ("receta de pollo al horno…") y tocá **Copiar pedido**. El texto incluye el formato del cuaderno.
2. Pegalo en ChatGPT / Claude / Gemini. Responden con un bloque JSON.
3. Volvé, pegá la respuesta en ✨ → **Revisar** → **Guardar**. Muestra qué es nuevo y qué reemplaza.
- Para editar algo existente: abrí la nota → ⋯ → *Editar con una IA* (incluye la nota con su `id`; al volver reemplaza esa misma nota y conserva sus fotos).
- También se puede copiar todo el cuaderno (sin fotos) para cambios grandes.
- Las fotos nunca se mandan a la IA; se agregan a mano desde el editor.

## Datos
- Texto en `localStorage`, fotos (reducidas a 1280 px JPEG) en IndexedDB. Todo queda en el dispositivo.
- **Ajustes → Guardar copia** exporta un `.json` con notas y fotos; **Importar** lo restaura (también acepta el JSON de una IA).
- Hacé copias de vez en cuando: borrar los datos del navegador o cambiar de teléfono borra el cuaderno.

## Publicar en GitHub Pages
Repo → Settings → Pages → *Deploy from a branch* → rama y carpeta `/ (root)`. La app queda en `https://<usuario>.github.io/<repo>/cuaderno/`. En iPhone: Safari → Compartir → *Agregar a pantalla de inicio*.

## Archivos
`index.html` (estilos), `app.js` (lógica), `sw.js` (offline, network-first), `manifest.webmanifest`, íconos y la fuente Bricolage (OFL).
