# contenido/

Notas del Cuaderno como archivos Markdown. La app las lee de acá y, cuando un archivo cambia, ofrece importarlo ("📥 N cambios en el repo").

- Un archivo por nota (o varias, cada una con su encabezado `---`). Formato: ver `../README.md`.
- Sin `id:` en el encabezado, el id sale del nombre del archivo, así que renombrarlo crea una nota nueva.
- **Después de agregar, renombrar o borrar archivos:** `node cuaderno/tools/indexar.mjs` (actualiza `index.json`; Pages no puede listar carpetas).
- Esta carpeta es pública si el sitio es público. No pongas nada privado.
- Es de un solo sentido: lo que editás en la app no vuelve acá. Para eso: Ajustes → Exportar Markdown y commitear.
