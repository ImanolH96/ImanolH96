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

## Estructura del código
JavaScript con módulos ES nativos: sin build ni dependencias, se edita y se publica tal cual. Las dependencias van en una sola dirección (`views` → `data`/`ui` → `core`), así que un módulo de abajo nunca importa uno de arriba.

```
index.html          esqueleto (carga css/styles.css y js/main.js)
css/styles.css      estilos y colores (variables CSS, claro/oscuro)
js/main.js          arranque: registra las rutas y el service worker
js/config.js        constantes: tipos de nota, links de IA, versión
js/core/            dom.js (helper h), store.js (estado + localStorage), router.js (rutas por hash)
js/data/            model.js (forma de una nota y normalización), images.js (IndexedDB + fotos),
                    ai.js (prompts, parseo e importación), backup.js (exportar copia)
js/ui/              overlays.js (toast, sheet, lightbox), platform.js (portapapeles, archivos), components.js
js/views/           una pantalla por archivo: list, detail, edit, ia, settings
sw.js               offline (network-first); su lista ASSETS debe incluir cada archivo nuevo
```

Para agregar algo:
- **Una pantalla nueva:** crear `js/views/x.js` que exporte `viewX()` y registrarla en `js/main.js`.
- **Un campo nuevo en las notas:** `data/model.js` (normalize), `views/edit.js`, `views/detail.js` y la descripción del formato en `data/ai.js` para que las IAs lo conozcan.
- **Un tipo nuevo de nota:** `config.js` (TIPOS) más lo anterior.
- Al sumar archivos, agregarlos a `ASSETS` en `sw.js` y subir `CACHE`.

Las fotos de `comidas/` y este código no comparten nada: cada app es independiente.
