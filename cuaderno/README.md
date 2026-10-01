# Cuaderno

PWA instalable (iPhone/Android) para guardar **recetas** (con fotos, ingredientes y pasos), **ejercicios del gimnasio** (series, reps, peso, descanso) y **notas**, y para editarlas con ChatGPT, Claude o Gemini. Sin servidor ni cuentas; funciona offline.

## Cómo se edita con una IA
No usa APIs ni claves ni conexión: el puente es **Markdown** (texto o archivo `.md`).
1. En ✨, escribí qué querés ("receta de pollo al horno…") y tocá **Copiar pedido**. El texto incluye el formato del cuaderno.
2. Pegalo en ChatGPT / Claude / Gemini. Responden con un bloque markdown.
3. Volvé, pegá la respuesta en ✨ (o elegí el archivo `.md` que te dio) → **Revisar** → **Guardar**. Muestra qué es nuevo y qué reemplaza.
- Para editar algo existente: abrí la nota → ⋯ → *Editar con una IA* (incluye la nota con su `id`; al volver reemplaza esa misma nota y conserva sus fotos).
- También: ⋯ → *Copiar como Markdown* / *Descargar .md*, y en Ajustes *Exportar todo como Markdown* (un solo `.md`, sin fotos). Se puede editar a mano o con cualquier IA y volver a importar.
- Las fotos nunca se mandan a la IA; se agregan a mano desde el editor.

### Formato
```markdown
---
tipo: receta            (receta | ejercicio | nota)
titulo: Tortilla de papas
etiquetas: cena, rapido
porciones: 4
tiempo: 40 min
id: ...                 (opcional: si coincide con una nota existente, la reemplaza)
---
## Ingredientes
- 4 papas
## Pasos
1. Pelar y cortar
## Notas
Texto libre.
```
Los ejercicios van en una tabla `| Ejercicio | Series | Reps | Peso | Descanso | Notas |` bajo `## Ejercicios`; en una nota de tipo `nota` todo lo que sigue al encabezado es el contenido. Varias notas = una detrás de otra, cada una con su encabezado `---`. El importador es tolerante (tildes, mayúsculas, negritas, listas en vez de tabla) y también acepta JSON.

## Notas como archivos del repo (`contenido/`)
Además del copiar y pegar, la app puede leer notas que vivan como `.md` en `cuaderno/contenido/` (por ejemplo, editadas con Claude Code y subidas con un push).
- Al abrir la app aparece **📥 N cambios en el repo**; también en Ajustes → *Buscar cambios en el repo*. Siempre muestra qué es nuevo y qué reemplaza antes de aplicar.
- Solo se ofrece una nota si **su archivo cambió** desde la última importación: lo que editaste en la app no se pisa mientras el archivo siga igual. Una nota borrada en la app no vuelve hasta que su archivo cambie, y borrar un archivo del repo no borra la nota local.
- Sin `id:` en el encabezado, el id sale del nombre del archivo (renombrarlo crea una nota nueva).
- Después de agregar, renombrar o borrar archivos: `node cuaderno/tools/indexar.mjs` (GitHub Pages no lista carpetas, así que la app lee `contenido/index.json`).
- Es de un solo sentido (repo → app) y sin fotos. Lo editado en la app llega al repo con Ajustes → *Exportar todo como Markdown* y un commit.
- **Es público** si el sitio es público: nada privado en esa carpeta. Los dos archivos que vienen de ejemplo se pueden borrar.

## Datos
- Texto en `localStorage`, fotos (reducidas a 1280 px JPEG) en IndexedDB. Todo queda en el dispositivo.
- **Ajustes → Guardar copia** exporta un `.json` con notas y fotos; **Importar** lo restaura (también acepta uno o varios `.md`, o JSON).
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
                    markdown.js (nota ⇄ Markdown), ai.js (prompts, parseo e importación), backup.js (exportar copia),
                    repo.js (leer contenido/ y detectar cambios)
js/ui/              overlays.js (toast, sheet, lightbox), platform.js (portapapeles, archivos), components.js, repoSheet.js
js/views/           una pantalla por archivo: list, detail, edit, ia, settings
contenido/          notas en .md + index.json (generado)
tools/indexar.mjs   regenera contenido/index.json
sw.js               offline (network-first); su lista ASSETS debe incluir cada archivo nuevo
```

Para agregar algo:
- **Una pantalla nueva:** crear `js/views/x.js` que exporte `viewX()` y registrarla en `js/main.js`.
- **Un campo nuevo en las notas:** `data/model.js` (normalize), `views/edit.js`, `views/detail.js`, `data/markdown.js` (leer/escribir) y la descripción del formato en `data/ai.js` para que las IAs lo conozcan.
- **Un tipo nuevo de nota:** `config.js` (TIPOS) más lo anterior.
- Al sumar archivos, agregarlos a `ASSETS` en `sw.js` y subir `CACHE`.

Las fotos de `comidas/` y este código no comparten nada: cada app es independiente.
