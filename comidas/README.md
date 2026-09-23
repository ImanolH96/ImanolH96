# Comidas libres

Web app instalable (PWA) para iPhone que registra las comidas libres de un plan nutricional.
Todo corre en el dispositivo: sin servidor, sin cuentas, sin backend. Funciona offline.

## Qué hace

En Registrar, una tarjeta con barra de progreso de la semana ("Usaste ⅔ de 2 comidas libres", marcas en cada comida libre y lo que excede el cupo en rojo). Al pasar el cupo semanal se muestra cupo + extra, ej. "2+⅔".

Cuatro pestañas abajo: **Registrar** (abre siempre en el día de hoy; se puede cambiar a ayer u otro día), **Semana**, **Mes** y **Planificar**. Exportar/importar Excel está en ⚙️ Ajustes.

- **Botonera circular estilo Simon**: el anillo tiene 🍔 Comida fuera del plan, 🍷 Alcohol y 🍰 Dulce (⅓ cada una; las tres forman una comida libre) y el centro es 🍽️ Comida libre completa (1). Cada parte es una tecla redondeada de una sola pieza (borde almohadillado, canto macizo, sombra suave) que se hunde al tocarla, con vibración en el iPhone (iOS 18+); la ya sumada queda metida en su hueco (mismo color, con una sombra fina en el borde y ✓), y otro toque la saca.
- El centro **🍽️ Comida libre completa** registra 1 comida libre entera como registro propio (se suma a las partes que haya en ese momento) (también se puede activar desde el detalle de un registro con "Contar como comida libre completa"). En gráficas aparece en lavanda y el Excel tiene la columna "Completa".
- Al sumar, efecto de "daño": bordes rojos, sacudida y un "−⅓ 💔" flotando (−1 y más fuerte con la comida completa). Con "Reducir movimiento" queda solo un destello rojo.
- Usa la fecha de hoy y detecta el momento por la hora (editable en ⚙️):
  Desayuno 05:00–11:00 · Almuerzo 11:00–15:30 · Merienda 15:30–19:00 · Cena 19:00–05:00.
  Se puede cambiar el momento con los botones, o el día en la tira semanal de arriba (hoy va en mostaza y dice "Hoy"; ‹ › recorren las semanas del mes actual, los días de otros meses y los futuros quedan apagados, y "↺ Hoy" vuelve a hoy).
- Los toques del mismo momento y día se juntan en un solo registro (ej. cena con comida + alcohol = ⅔). Las teclas funcionan como interruptor: tocar una parte ya sumada (✓) la saca, y si no queda ninguna el registro se borra. Cada toque se puede deshacer.
- Tarjeta semanal: un círculo de tres porciones por cada comida libre permitida (por defecto 2 por semana, configurable). Si te pasás aparecen círculos extra punteados.
- Estado con color, ícono y texto en la semana, el mes, el listado de semanas y la gráfica semanal: ★ Semana limpia (0 comidas libres) y ✓ Vas bien / Dentro del plan en verde, = Al límite en blanco, ! Por encima del cupo / del límite en rojo. El mes se compara con lo permitido hasta hoy.
- Ajuste del mes (solo el mes actual): una frase con lo que queda del mes y cuánto por semana para cerrar en el plan (o, si ya estás por encima del límite, cuánto y cuándo arranca el mes nuevo), y una línea punteada en la gráfica Acumulado con el margen hasta fin de mes.
- **Ciclo desde la consulta** (⚙️ Ajustes → Fecha de tu consulta): cada "mes" pasa a ser un ciclo de 4 semanas desde esa fecha (ej. 22 sept–19 oct, 20 oct–16 nov) y las semanas empiezan ese día de la semana; límite = 4 × cupo. Sin fecha, se usan los meses del calendario.
- El mes se cuenta en semanas enteras: cada semana pertenece al mes que tiene la mayoría de sus días, y el límite del mes es cupo semanal × semanas (ej. septiembre 2026: 31 ago–27 sept, 4 semanas × 2 = 8).
- Navegación por semana con las flechas ‹ ›: la tarjeta y los registros muestran la semana elegida ("Volver a esta semana" regresa).
- Resumen del mes con sus propias flechas y un selector de gráficas (tocá la gráfica para ver el detalle):
  **Acumulado** día a día contra el límite (tu cupo semanal repartido por día), **Por semana** (columnas con comida / alcohol / dulce contra el cupo), **Momentos** (en qué momento del día caen) y **Calendario** (mapa de calor del mes).
  Debajo: total de comidas libres, cuántas veces hubo comida, alcohol y dulce, y una barra por semana (tocándola vas a esa semana). El Excel suma la hoja `Resumen mensual`.
- Detalle opcional: tocando un registro se puede agregar qué fue y notas, cambiar día/hora/partes o borrarlo.
- **Exportar a Excel (.xlsx)** con dos hojas: `Comidas` (una columna Sí/No por parte y el valor, ej. 0.67) y `Resumen semanal`. En iPhone abre el menú Compartir → "Guardar en Archivos", WhatsApp, mail, etc.
- **Importar desde Excel**: lee la hoja `Comidas` (podés editarla en Numbers/Excel y volver a cargarla). Te deja reemplazar todo o combinar.

## Planificar

- Reservá comidas libres que ya sabés que vienen (cumpleaños, eventos, salidas) con atajos de un toque, día, momento y valor (⅓, ⅔ o 1).
- Balance del mes: usadas + reservadas (rayado) + libres para imprevistos, contra el límite del mes.
- "Te quedan" grande con una ficha por comida libre del mes (en tercios: usadas, reservadas, libres) y la cuenta del mes.
- **Repartí lo que queda**: asigná con − / + a cada semana que falta cuánto pensás usar; muestra lo usado, reservado y asignado contra el cupo semanal, lo que queda sin repartir, "Repartir parejo" (hasta el cupo de cada semana) y "Borrar reparto". El plan de la semana aparece en Registrar.
- El día del evento aparece en Registrar con un botón para registrarlo; los que ya pasaron quedan con "Registrar".
- Lo reservado también se ve rayado en la barra de la semana y se descuenta en el ajuste del mes. El Excel suma la hoja `Planificados`.
- **Buscar eventos en Google Calendar** (conexión directa, solo lectura): ver "Conectar Google Calendar" abajo.
- **O importar un archivo .ics**: exportá tu calendario (calendar.google.com → ⚙️ Configuración → Importar y exportar → Exportar; en el iPhone, abrí el .zip en Archivos y tocá el .ics) y elegilo con "Importar de Google Calendar". La app muestra los eventos de los próximos 6 meses (incluye cumpleaños anuales; ignora repeticiones semanales y cancelados), preselecciona los que parecen de comida y reservás los que marques. Los ya reservados no se duplican.

## Conectar Google Calendar

Funciona en la app publicada (GitHub Pages), no en la vista previa de Claude. Se hace una sola vez:

1. Entrá a https://console.cloud.google.com/ con tu cuenta de Google y creá un proyecto (ej. "Comidas libres").
2. **APIs y servicios → Biblioteca** → buscá **Google Calendar API** → **Habilitar**.
3. **APIs y servicios → Pantalla de consentimiento de OAuth** (Google Auth Platform): tipo **Externo**, nombre de la app, tu mail. En **Público / Usuarios de prueba** agregá tu propio mail. Dejala en modo **Prueba** (no hace falta verificarla).
4. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**:
   - Tipo: **Aplicación web**
   - **Orígenes de JavaScript autorizados**: `https://imanolh96.github.io`
   - **URI de redireccionamiento autorizados**: `https://imanolh96.github.io/ImanolH96/comidas/`
5. Copiá el **ID de cliente** (termina en `.apps.googleusercontent.com`) y pegalo en la app: ⚙️ Ajustes → **Google Client ID** → Guardar.
6. En **Planificar** tocá **Buscar eventos en Google Calendar**, iniciá sesión y aceptá el permiso de **solo lectura** del calendario.

La app lee los calendarios visibles (sin feriados) de los próximos 6 meses, conserva cumpleaños y repeticiones anuales, descarta repeticiones semanales y cancelados, y te deja elegir cuáles reservar. El permiso dura una hora; después, el botón vuelve a pedir acceso (sin volver a preguntar el consentimiento). El ID de cliente no es secreto: identifica a la app, no da acceso a tu cuenta.

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
- `sw.js` – service worker: con conexión siempre carga lo último de la red y guarda copia; sin conexión usa la copia. Al publicar, subí `CACHE` y `APP_VERSION` (app.js); la app se recarga sola al detectar la versión nueva.
- `manifest.webmanifest`, `icon-*.png` – instalación en pantalla de inicio
