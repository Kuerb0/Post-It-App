// node tests/test_sync.js  ·  debe terminar en «TEST OK»
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const S = require('../sync.js');

const hoy = new Date(2026, 9, 19, 9, 0);                         // lunes 19/10/2026
const nota = (html, extra = {}) => ({ id: 'n1', html, ...extra });
const ext = (html, extra = { cal: true }) => S.extraer([nota(html, extra)], hoy);

// --- líneas: casillas, marcas «vuelve» y entidades
let l = S.lineas('<div><input type="checkbox" checked> Dentista 18:30<span class="back" contenteditable="false">↻ vuelve 2026-10-20</span></div><div>A &amp; B</div><div><br></div>');
assert.deepStrictEqual(l.map(x => [x.texto, x.caja, x.hecha]), [['Dentista 18:30', true, true], ['A & B', false, false]]);

// --- solo va lo que tiene hora Y está debajo de una fecha
let r = ext('<div>18:00 Antes de la fecha</div><div><b>Martes 20/10</b></div><div>18:30 Dentista</div><div>Comprar pan</div>');
assert.deepStrictEqual(r.map(i => [i.titulo, i.inicio, i.fin, i.hecho]), [['Dentista', '2026-10-20T18:30:00', null, false]]);
assert.strictEqual(ext('<div>Cena 22/10 21:00</div><div>mañana 8:15 gimnasio</div>').length, 0);   // sin cabecera de fecha: nada

// --- rango de horas, tarea marcada, otras formas de hora, cabecera como la de las notas reales
const cab = '<div class="datehead"><span>Miércoles </span><b>21-10</b></div>';
assert.deepStrictEqual(ext(cab + '<div><input type="checkbox" checked> Reunión 10:00-11:30</div>').map(i => [i.titulo, i.inicio, i.fin, i.hecho]),
  [['Reunión', '2026-10-21T10:00:00', '2026-10-21T11:30:00', true]]);
assert.strictEqual(ext(cab + '<div>Médico a las 17:45</div>')[0].titulo, 'Médico');
assert.strictEqual(ext(cab + '<div>19h revisión</div>')[0].inicio, '2026-10-21T19:00:00');
assert.strictEqual(ext(cab + '<div>Llamar a las 9</div>')[0].inicio, '2026-10-21T09:00:00');
assert.strictEqual(ext(cab + '<div>Fiesta 23:00-01:00</div>')[0].fin, '2026-10-22T01:00:00');   // acaba al día siguiente

// --- cada línea va con la fecha que tiene encima
r = ext(cab + '<div>9:00 A</div><div>Jueves 22/10</div><div>9:00 A</div>');
assert.deepStrictEqual(r.map(i => i.inicio), ['2026-10-21T09:00:00', '2026-10-22T09:00:00']);
assert.notStrictEqual(r[0].id, r[1].id);                            // mismo texto en otro día, otro id

// --- solo notas unidas; la nota Agenda y los eventos pintados del Calendario no vuelven
assert.strictEqual(ext(cab + '<div>18:00 Dentista</div>', {}).length, 0);
assert.strictEqual(ext(cab + '<div>18:00 Dentista</div>', { cal: true, agenda: true }).length, 0);
assert.strictEqual(ext(cab + '<div class="cal" contenteditable="false">📅 10:00 Reunión</div>').length, 0);

// --- año siguiente para una fecha que ya pasó hace mucho; fecha imposible: no es cabecera
assert.strictEqual(S.extraer([nota('<div>05/01</div><div>10:00 Revisión</div>', { cal: true })], new Date(2026, 11, 20, 9))[0].inicio, '2027-01-05T10:00:00');
assert.strictEqual(ext('<div>31/02</div><div>10:00 Algo</div>').length, 0);

// --- ficheros: se escriben por equipo, no se reescriben si no cambian, y la agenda junta todos los equipos sin repetir
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-'));
assert.strictEqual(S.escribirNotas(dir, r, 'PC1'), true);
assert.strictEqual(S.escribirNotas(dir, r, 'PC1'), false);
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
