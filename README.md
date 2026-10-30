# Post-It

Notas adhesivas de escritorio para Windows (Electron). Se pueden minimizar con `Ctrl+M`.

**Lanzador:** clic en el icono de la bandeja y salen 8 miniaturas de tus notas (el resto, en «Más»). Una es la **principal** (★) y siempre arranca con Windows; las demás arrancan solo si activas ⏻, y si no quedan dormidas hasta que las abras desde el lanzador. Cada nota se queda en el escritorio virtual donde está.

**Calendario:** en una nota unida (botón 📅) los eventos salen bajo cada fecha como tareas. Post-It los lee por su cuenta: de **Outlook clásico** si está abierto (con el color de cada etiqueta, que recuerda aunque lo cierres) o, si no, del **enlace ICS** que publicas en Outlook web (que no trae etiquetas ni colores). El botón ⟳ lo relee al momento. Se elige en el icono de la bandeja → *Calendario…*. Las líneas con hora que escribas bajo una fecha pasan además al [Calendario](https://github.com/Kuerb0/Calendario-App) si lo tienes en la misma carpeta.

**Sincronizar entre equipos (opcional):** una carpeta de OneDrive, distinta de la del programa (que es local). Cada equipo escribe solo su fichero (`postit-<equipo>.json`) y Post-It los fusiona nota a nota (gana el cambio más reciente; los borrados no resucitan), así OneDrive nunca crea copias en conflicto. El enlace ICS y los colores recordados viajan con ellas. Se activa en el instalador o después en la bandeja → *Carpeta de sincronización…*. Las notas de la 1.x (`notes.json`) se leen una vez y se conservan.

**Primera vez:** el instalador explica la sincronización, pide las dos carpetas y el enlace ICS (todo opcional), y la primera nota es un post-it de bienvenida corto; `F1` lista todos los atajos. **Actualizaciones:** al abrir, un aviso si hay versión nueva en GitHub («Actualizar» baja el instalador y lo abre; tus notas se conservan).

**Letra:** el botón Tт de la barra ajusta el tamaño de la letra y el interlineado de todas las notas (con − y + para afinar). Las cabeceras de fecha (`Lunes 02/11`) salen siempre en negrita.

- **Instalar:** descarga el instalador en [descargas → Post-It](https://github.com/Kuerb0/descargas/releases?q=postit). Se instala encima de la versión anterior y conserva tus notas.
- **Pruebas:** `node tests/test_sync.js` y `node tests/test_eventos.js` (deben acabar en `TEST OK`). El lector de Outlook (`outlook.ps1`) solo se puede probar con Outlook clásico abierto.

Forma parte del [portal](https://kuerb0.github.io/portal/).
