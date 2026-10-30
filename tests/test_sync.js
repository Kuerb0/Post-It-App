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

// --- solo notas unidas; los eventos pintados del Calendario (con su casilla) no vuelven
assert.strictEqual(ext(cab + '<div>18:00 Dentista</div>', {}).length, 0);
assert.strictEqual(ext(cab + '<div class="cal" contenteditable="false"><input type="checkbox">📅 10:00 Reunión</div>').length, 0);
assert.strictEqual(ext(cab + '<div class="cal" contenteditable="false"><input type="checkbox" checked>📅 10:00 Reunión</div><div>18:00 Dentista</div>').length, 1);

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

// --- carpeta propuesta: el OneDrive del equipo, subcarpeta «Post-It»; sin OneDrive, nada
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'raiz-'));
assert.strictEqual(S.carpetaOneDrive({ entorno: {}, hogar: raiz }), null);
fs.mkdirSync(path.join(raiz, 'OneDrive'));
assert.strictEqual(S.carpetaOneDrive({ entorno: {}, hogar: raiz }), path.join(raiz, 'OneDrive', 'Carpeta de Sincronización'));
assert.strictEqual(S.carpetaOneDrive({ entorno: { OneDrive: raiz }, hogar: '/no' }), path.join(raiz, 'Carpeta de Sincronización'));
// con dos OneDrive (personal y de la organización) se propone el personal
const org = fs.mkdtempSync(path.join(os.tmpdir(), 'org-'));
assert.strictEqual(S.carpetaOneDrive({ entorno: { OneDrive: org, OneDriveConsumer: raiz }, hogar: '/no' }), path.join(raiz, 'Carpeta de Sincronización'));
// --- sync entre equipos: cada uno escribe su fichero y se fusionan por nota (gana el cambio más reciente); los borrados no resucitan
const sd = fs.mkdtempSync(path.join(os.tmpdir(), 'postit-sync-'));
const A = S.estadoNuevo(), B = S.estadoNuevo();
let na = [{ id: '1', html: 'uno' }, { id: '2', html: 'dos' }];
S.marcar(A, na, 100);                                                              // PC A crea dos notas
S.escribirSync(sd, { notas: na, borradas: [] }, 'A');
let f = S.fusionar(S.leerSync(sd));
assert.deepStrictEqual(f.notas.map(n => [n.id, n.mod]), [['1', 100], ['2', 100]]);
let nb = f.notas.map(n => ({ ...n })); S.iniciarEstado(B, nb, f.borradas);          // PC B las recibe sin cambiarlas
assert.strictEqual(S.marcar(B, nb, 150).length, 0); assert.deepStrictEqual(nb.map(n => n.mod), [100, 100]);
nb[0].html = 'uno editado en B'; S.marcar(B, nb, 200);                              // B edita la 1 …
const borr = S.marcar(A, na = na.filter(n => n.id !== '2'), 300);                   // … y A borra la 2
assert.deepStrictEqual(borr, [{ id: '2', mod: 300 }]);
S.escribirSync(sd, { notas: nb, borradas: [] }, 'B'); S.escribirSync(sd, { notas: na, borradas: borr }, 'A');
f = S.fusionar(S.leerSync(sd));
assert.deepStrictEqual(f.notas.map(n => [n.id, n.html]), [['1', 'uno editado en B']]);   // la 1 con la edición de B; la 2 borrada aunque B aún la tenga
assert.deepStrictEqual(f.borradas, [{ id: '2', mod: 300 }]);
// misma nota editada en los dos: gana la última · una nota recreada después del borrado vuelve
const dosEdit = S.fusionar([{ notas: [{ id: 'x', html: 'a', mod: 5 }] }, { notas: [{ id: 'x', html: 'b', mod: 9 }] }]);
assert.strictEqual(dosEdit.notas[0].html, 'b');
assert.strictEqual(S.fusionar([{ notas: [{ id: 'x', mod: 10 }] }, { notas: [], borradas: [{ id: 'x', mod: 4 }] }]).notas.length, 1);
// notes.json de la 1.x y sus copias en conflicto entran como mod 0: cualquier cambio posterior (o borrado) las supera
fs.writeFileSync(path.join(sd, 'notes.json'), JSON.stringify([{ id: '1', html: 'viejo' }, { id: '9', html: 'solo en la 1.x' }]));
fs.writeFileSync(path.join(sd, 'notes-Portatil_Mario-2.json'), '[{"id":"8","html":"copia en conflicto"}]');
fs.writeFileSync(path.join(sd, 'postit-roto.json'), '{ roto');
f = S.fusionar(S.leerSync(sd));
assert.deepStrictEqual(f.notas.map(n => n.id).sort(), ['1', '8', '9']);
assert.strictEqual(f.notas.find(n => n.id === '1').html, 'uno editado en B');
// ajustes (enlace ICS) y colores recordados: gana el ajuste más reciente, los colores se suman; el propio fichero se puede excluir
S.escribirSync(sd, { notas: [], ajustes: { ics: 'https://nuevo', mod: 50 }, colores: { categorias: { Salud: '#e5533d' }, titulos: {} } }, 'C');
S.escribirSync(sd, { notas: [], ajustes: { ics: 'https://viejo', mod: 10 }, colores: { categorias: {}, titulos: { cita: '#3a86ff' } } }, 'D');
f = S.fusionar(S.leerSync(sd));
assert.deepStrictEqual([f.ajustes.ics, f.colores.categorias.Salud, f.colores.titulos.cita], ['https://nuevo', '#e5533d', '#3a86ff']);
assert.ok(!S.leerSync(sd, { menos: S.ficheroEquipo(sd, 'C') }).some(x => x.ajustes && x.ajustes.ics === 'https://nuevo'));
// al arrancar, la memoria va vacía (sin ajustes) y delante de los ficheros: no debe taparlos
const alArrancar = S.fusionar([{ notas: [], borradas: [], ajustes: {}, colores: { categorias: {}, titulos: {} } }, ...S.leerSync(sd)]);
assert.strictEqual(alArrancar.ajustes.ics, 'https://nuevo');
// la firma cambia cuando alguien guarda
const propio = S.ficheroEquipo(sd, 'E'), f0 = S.firmaSync(sd, propio);
S.escribirSync(sd, { notas: [{ id: 'z', mod: 1 }] }, 'E'); assert.strictEqual(S.firmaSync(sd, propio), f0);       // lo que escribo yo no cuenta
S.escribirSync(sd, { notas: [{ id: 'z', mod: 1 }] }, 'F'); assert.notStrictEqual(S.firmaSync(sd, propio), f0);    // lo que escribe otro, sí
// --- alarmas: vencidas y no sonadas · sonadas ya no · futuras no · de hace más de un día se dan por sonadas sin avisar · la etiqueta ⏰ no es una actividad del Calendario
const ahoraA = new Date(2026, 9, 26, 18, 30).getTime();
const conAlarmas = [{ id: 'a', alarms: [{ t: '2026-10-26T18:30', txt: 'Dentista' }, { t: '2026-10-26T19:00', txt: 'Futura' }, { t: '2026-10-24T09:00', txt: 'Vieja' }] }, { id: 'b' }];
let v = S.alarmasVencidas(conAlarmas, new Set(), ahoraA);
assert.deepStrictEqual(v.map(x => [x.a.txt, x.suena]), [['Dentista', true], ['Vieja', false]]);
assert.deepStrictEqual(S.alarmasVencidas(conAlarmas, new Set(v.map(x => x.clave)), ahoraA), []);
assert.deepStrictEqual(S.lineas('<div>Dentista <span class="alarm past" contenteditable="false" data-t="2026-10-26T18:30">⏰ hoy 18:30</span>&nbsp;</div>').map(x => x.texto), ['Dentista']);
assert.deepStrictEqual(ext('<div>Lunes 26/10</div><div>Dentista <span class="alarm" data-t="2026-10-26T18:30">⏰ hoy 18:30</span></div>'), []);
// --- aviso al Calendario (botón ⟳): deja refrescar-<equipo>.txt en la carpeta compartida, y no se confunde con la agenda ni las notas
const carpetaR = fs.mkdtempSync(path.join(os.tmpdir(), 'postit-refresco-'));
S.pedirRefresco(carpetaR, 'PCX');
assert.deepStrictEqual(fs.readdirSync(carpetaR), ['refrescar-PCX.txt']);
assert.deepStrictEqual(S.leerAgenda(carpetaR, hoy, 7), []);
// --- rango de la agenda: un evento a 100 días entra con la ventana de Post-It (127 = 7 atrás + 120) y no con la antigua de 40
const carpetaG = fs.mkdtempSync(path.join(os.tmpdir(), 'postit-agenda-'));
fs.writeFileSync(path.join(carpetaG, 'agenda-PCX.json'), JSON.stringify({ version: 1, equipo: 'PCX', eventos: [{ id: 'lejos', titulo: 'Lejos', inicio: '2027-01-27T10:00:00', fin: '2027-01-27T11:00:00', todo_dia: false }] }));
assert.deepStrictEqual(S.leerAgenda(carpetaG, hoy, 127).map(e => e.id), ['lejos']);
assert.deepStrictEqual(S.leerAgenda(carpetaG, hoy, 40), []);
// --- versiones: 2.0.0 > 1.12.1 > 1.9 · iguales no son mayores
assert.ok(S.versionMayor('2.0.0', '1.12.1') && S.versionMayor('1.12.1', '1.9') && S.versionMayor('1.0.1', '1.0'));
assert.ok(!S.versionMayor('1.12.1', '1.12.1') && !S.versionMayor('1.9', '1.12.1'));
console.log('TEST OK');
