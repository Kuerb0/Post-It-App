// node tests/test_sync.js  ·  debe terminar en «TEST OK»
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const S = require('../sync.js');

const hoy = new Date(2026, 9, 19, 9, 0);                         // lunes 19/10/2026
const nota = (html, extra = {}) => ({ id: 'n1', html, ...extra });
const ext = (html, vistos = {}) => S.extraer([nota(html)], hoy, vistos);

// --- líneas: casillas, marcas «vuelve» y entidades
let l = S.lineas('<div><input type="checkbox" checked> Dentista 18:30<span class="back" contenteditable="false">↻ vuelve 2026-10-20</span></div><div>A &amp; B</div><div><br></div>');
assert.deepStrictEqual(l.map(x => [x.texto, x.caja, x.hecha]), [['Dentista 18:30', true, true], ['A & B', false, false]]);

// --- hora con la fecha de la cabecera de arriba
let r = ext('<div><b>Martes 20/10</b></div><div>18:30 Dentista</div><div>Comprar pan</div>');
assert.strictEqual(r.items.length, 1);                            // «Comprar pan» no lleva hora: no es del calendario
assert.deepStrictEqual([r.items[0].titulo, r.items[0].inicio, r.items[0].fin, r.items[0].hecho], ['Dentista', '2026-10-20T18:30:00', null, false]);

// --- rango de horas y tarea marcada
r = ext('<div><input type="checkbox" checked> Reunión 10:00-11:30</div>');
assert.deepStrictEqual([r.items[0].titulo, r.items[0].inicio, r.items[0].fin, r.items[0].hecho], ['Reunión', '2026-10-19T10:00:00', '2026-10-19T11:30:00', true]);

// --- fecha dentro de la línea, «mañana» y días de la semana
assert.strictEqual(ext('<div>Cena con Ana 22/10 21:00</div>').items[0].inicio, '2026-10-22T21:00:00');
assert.strictEqual(ext('<div>Cena con Ana 22/10 21:00</div>').items[0].titulo, 'Cena con Ana');
assert.strictEqual(ext('<div>mañana 8:15 gimnasio</div>').items[0].inicio, '2026-10-20T08:15:00');
assert.strictEqual(ext('<div>Médico el viernes a las 17:45</div>').items[0].inicio, '2026-10-23T17:45:00');
assert.strictEqual(ext('<div>lunes 19h revisión</div>').items[0].inicio, '2026-10-19T19:00:00');
assert.strictEqual(ext('<div>Llamar a las 9</div>').items[0].inicio, '2026-10-19T09:00:00');

// --- sin fecha: es la del primer día en que se vio y no se mueve cuando pasan los días
r = ext('<div>18:00 Dentista</div>');
assert.strictEqual(r.items[0].inicio, '2026-10-19T18:00:00');
const manana = new Date(2026, 9, 20, 9, 0);
const r2 = S.extraer([nota('<div>18:00 Dentista</div>')], manana, r.vistos);
assert.strictEqual(r2.items[0].inicio, '2026-10-19T18:00:00');
assert.strictEqual(r2.items[0].id, r.items[0].id);                 // mismo texto, mismo id

// --- otra línea, otro id; mismo texto en otra nota, otro id
assert.notStrictEqual(ext('<div>18:00 Dentista</div>').items[0].id, ext('<div>18:00 Pediatra</div>').items[0].id);
assert.notStrictEqual(S.extraer([nota('<div>18:00 A</div>')], hoy).items[0].id, S.extraer([{ id: 'n2', html: '<div>18:00 A</div>' }], hoy).items[0].id);

// --- la nota Agenda no vuelve al Calendario
assert.strictEqual(S.extraer([nota('<div>18:00 Dentista</div>', { agenda: true })], hoy).items.length, 0);

// --- nota unida: las tareas sin hora bajo una fecha salen como todo el día; los eventos pintados del Calendario no vuelven
const unida = '<div class="datehead"><span>Miércoles </span><b>21-10</b></div><div><input type="checkbox" checked>Cama @diario</div>' +
  '<div class="cal" contenteditable="false">📅 10:00 Reunión</div><div>18:00 Dentista</div><div><br></div>';
r = S.extraer([nota(unida, { cal: true })], hoy);
assert.deepStrictEqual(r.items.map(i => [i.titulo, i.inicio, !!i.todo_dia, i.hecho]),
  [['Cama', '2026-10-21T12:00:00', true, true], ['Dentista', '2026-10-21T18:00:00', false, false]]);
assert.strictEqual(S.extraer([nota(unida)], hoy).items.length, 1);   // sin unir: solo lo que lleva hora
assert.strictEqual(S.extraer([nota('<div>Cama</div>', { cal: true })], hoy).items.length, 0);   // sin fecha encima: nada

// --- año siguiente para una fecha que ya pasó hace mucho
assert.strictEqual(S.extraer([nota('<div>05/01 10:00 Revisión</div>')], new Date(2026, 11, 20, 9)).items[0].inicio, '2027-01-05T10:00:00');
// --- fecha imposible: se ignora la fecha y se usa hoy
assert.strictEqual(ext('<div>31/02 10:00 Algo</div>').items[0].inicio.slice(0, 10), '2026-10-19');

// --- ficheros: se escriben por equipo, no se reescriben si no cambian, y la agenda junta todos los equipos sin repetir
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-'));
assert.strictEqual(S.escribirNotas(dir, r.items, 'PC1'), true);
assert.strictEqual(S.escribirNotas(dir, r.items, 'PC1'), false);
fs.writeFileSync(path.join(dir, 'agenda-PC1.json'), JSON.stringify({ version: 1, equipo: 'PC1', eventos: [
  { id: 'cal:a', titulo: 'Reunión', inicio: '2026-10-20T10:00:00', fin: null, todo_dia: false },
  { id: 'cal:fuera', titulo: 'Lejano', inicio: '2026-12-20T10:00:00', fin: null, todo_dia: false }] }));
fs.writeFileSync(path.join(dir, 'agenda-PC2.json'), JSON.stringify({ version: 1, equipo: 'PC2', eventos: [
  { id: 'cal:a', titulo: 'Reunión', inicio: '2026-10-20T10:00:00', fin: null, todo_dia: false },
  { id: 'cal:b', titulo: 'Cumple', inicio: '2026-10-19T00:00:00', fin: null, todo_dia: true }] }));
fs.writeFileSync(path.join(dir, 'agenda-PC3.json'), '{ roto');
const ag = S.leerAgenda(dir, hoy);
assert.deepStrictEqual(ag.map(e => e.id), ['cal:b', 'cal:a']);
const h = S.htmlAgenda(ag, hoy);
assert.ok(h.includes('Lunes 19/10') && h.includes('Todo el día Cumple') && h.includes('10:00 Reunión'));

// --- carpeta: la guardada manda; si no, se detecta la hermana de la app; si no, se crea
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'raiz-')), app = path.join(raiz, 'Post-It'); fs.mkdirSync(app);
let c = S.carpetaCompartida({ raiz: app, entorno: {}, hogar: raiz });
assert.deepStrictEqual([c.origen, c.ruta], ['creada', path.join(raiz, 'AgendaCompartida')]);
c = S.carpetaCompartida({ raiz: app, entorno: {}, hogar: raiz });
assert.strictEqual(c.origen, 'detectada');
c = S.carpetaCompartida({ guardada: dir, raiz: app, entorno: {}, hogar: raiz });
assert.deepStrictEqual([c.origen, c.ruta], ['guardada', dir]);
console.log('TEST OK');
