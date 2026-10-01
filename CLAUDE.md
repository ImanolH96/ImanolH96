# Notas para Claude

- `cuaderno/` es una PWA sin build (módulos ES nativos). Estructura y cómo extenderla: `cuaderno/README.md`.
- `cuaderno/contenido/` guarda las notas como archivos `.md` (formato en `cuaderno/README.md`). **Después de agregar, renombrar o borrar un `.md` ahí, correr `node cuaderno/tools/indexar.mjs`** para actualizar `contenido/index.json`; si no, la app no los ve.
- Todo en `cuaderno/contenido/` es público (GitHub Pages): nada privado.
- Si agregás un archivo a `cuaderno/js/` o `css/`, sumalo a `ASSETS` en `cuaderno/sw.js` y subí `CACHE`.
