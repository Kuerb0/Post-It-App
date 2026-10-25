# Post-It

Notas adhesivas de escritorio para Windows (Electron). Se pueden minimizar con `Ctrl+M`.

**Lanzador:** clic en el icono de la bandeja y salen 8 miniaturas de tus notas (el resto, en «Más»). Una es la **principal** (★) y siempre arranca con Windows; las demás arrancan solo si activas ⏻, y si no quedan dormidas hasta que las abras desde el lanzador. Cada nota se queda en el escritorio virtual donde está.

**Unión con el [Calendario](https://github.com/Kuerb0/Calendario-App):** en una nota unida (botón 📅) las líneas con hora que están debajo de una fecha pasan al Calendario como eventos, y los eventos del Calendario aparecen bajo cada fecha. Se comparten por una carpeta (`AgendaCompartida`) que se detecta sola.

- **Instalar:** descarga el instalador en [descargas → Post-It](https://github.com/Kuerb0/descargas/releases?q=postit). Se instala encima de la versión anterior y conserva tus notas.
- **Probar la sincronización:** `node tests/test_sync.js`

Forma parte del [portal](https://kuerb0.github.io/portal/).
