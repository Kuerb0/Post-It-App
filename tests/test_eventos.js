// node tests/test_eventos.js  ·  debe terminar en «TEST OK»
const assert = require('assert');
const E = require('../eventos.js');

const desde = new Date(2026, 9, 26), hasta = new Date(2026, 10, 30);          // 26/10/2026 – 30/11/2026
const ics = (...ev) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${ev.map(e => `BEGIN:VEVENT\r\nUID:${e.uid}\r\n${e.l.join('\r\n')}\r\nEND:VEVENT\r\n`).join('')}END:VCALENDAR\r\n`;
const ver = t => E.eventosICS(t, desde, hasta).map(e => [e.titulo, e.inicio, e.fin, e.todo_dia]);

// --- un evento con TZID, otro de día completo, otro en UTC (el ICS lleva líneas largas desdobladas y comas escapadas)
let t = ics(
  { uid: 'a', l: ['SUMMARY:Dentista\\, Dr. Pérez', 'DTSTART;TZID=Romance Standard Time:20261028T183000', 'DTEND;TZID=Romance Standard Time:20261028T193000'] },
  { uid: 'b', l: ['SUMMARY:Festivo', 'DTSTART;VALUE=DATE:20261101', 'DTEND;VALUE=DATE:20261102'] },
  { uid: 'c', l: ['SUMMARY:Reunión muy larga que\r\n  continúa', 'DTSTART:20261029T120000Z', 'DTEND:20261029T130000Z'] },
  { uid: 'd', l: ['SUMMARY:Fuera de rango', 'DTSTART:20270101T120000Z', 'DTEND:20270101T130000Z'] });
const r = ver(t);
assert.deepStrictEqual(r.map(x => x[0]), ['Dentista, Dr. Pérez', 'Reunión muy larga que continúa', 'Festivo']);
assert.deepStrictEqual(r[0].slice(1), ['2026-10-28T18:30:00', '2026-10-28T19:30:00', false]);
assert.strictEqual(r[2][3], true);
assert.strictEqual(new Date(Date.UTC(2026, 9, 29, 12)).getHours() + ':00', r[1][1].slice(11, 13).replace(/^0/, '') + ':00');   // la hora UTC pasa a la local

// --- repeticiones: cada 10 días con UNTIL, semanal con BYDAY, EXDATE y un cambio de una sola ocurrencia
t = ics(
  { uid: 'r', l: ['SUMMARY:Cada10', 'DTSTART:20261020T080000', 'DTEND:20261020T090000', 'RRULE:FREQ=DAILY;INTERVAL=10;UNTIL=20261115T000000Z'] },
  { uid: 's', l: ['SUMMARY:Gimnasio', 'DTSTART:20261019T170000', 'DTEND:20261019T180000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'EXDATE:20261104T170000'] },
  { uid: 's', l: ['SUMMARY:Gimnasio movido', 'RECURRENCE-ID:20261109T170000', 'DTSTART:20261109T190000', 'DTEND:20261109T200000'] });
const rr = ver(t);
assert.deepStrictEqual(rr.filter(x => x[0] === 'Cada10').map(x => x[1].slice(0, 10)), ['2026-10-30', '2026-11-09']);   // 20/10 +10 = 30/10, 9/11; el 19/11 ya pasa del UNTIL
const gim = rr.filter(x => x[0].startsWith('Gimnasio')).map(x => x[1].slice(5, 10) + ' ' + x[0]);
assert.ok(gim.includes('10-26 Gimnasio') && gim.includes('10-28 Gimnasio') && gim.includes('11-02 Gimnasio'));
assert.ok(!gim.some(x => x.startsWith('11-04')), 'EXDATE');
assert.ok(gim.includes('11-09 Gimnasio movido') && !gim.includes('11-09 Gimnasio'), 'cambio de una ocurrencia');
assert.strictEqual(rr.filter(x => x[0] === 'COUNT').length, 0);
assert.strictEqual(E.eventosICS(ics({ uid: 'k', l: ['SUMMARY:Tres', 'DTSTART:20261026T100000', 'DTEND:20261026T110000', 'RRULE:FREQ=DAILY;COUNT=3'] }), desde, hasta).length, 3);
assert.strictEqual(E.eventosICS(ics({ uid: 'x', l: ['SUMMARY:Cancelado', 'STATUS:CANCELLED', 'DTSTART:20261027T100000', 'DTEND:20261027T110000'] }), desde, hasta).length, 0);

// --- colores recordados: Outlook abierto los enseña, y con Outlook cerrado el ICS los usa
const cache = E.cacheVacia();
E.recordar(cache, [{ titulo: 'Dentista, Dr. Pérez', color: '#e5533d' }, { titulo: 'Sin color', color: null }], { Salud: '#e5533d' });
const pintados = E.colorear(E.eventosICS(ics({ uid: 'a', l: ['SUMMARY:dentista, dr. perez', 'DTSTART:20261028T183000', 'DTEND:20261028T193000'] }), desde, hasta), cache);
assert.strictEqual(pintados[0].color, '#e5533d');                       // mayúsculas y acentos no importan
assert.strictEqual(E.colorear([{ titulo: 'Nada', color: null, categoria: 'Salud' }], cache)[0].color, '#e5533d');   // o por etiqueta
assert.strictEqual(E.colorear([{ titulo: 'Nada', color: null }], cache)[0].color, null);

// --- elegir fuente: Outlook abierto → Outlook; cerrado → ICS; sin ICS → nada; ICS roto → error (sin tirar la app)
(async () => {
  const feed = ics({ uid: 'a', l: ['SUMMARY:Cita', 'DTSTART:20261028T183000', 'DTEND:20261028T193000'] });
  const abierto = async () => ({ estado: 'ok', eventos: [{ id: 'o1', titulo: 'Cita', inicio: '2026-10-28T18:30:00', color: '#3a86ff' }], categorias: { Trabajo: '#3a86ff' } });
  const cerrado = async () => ({ estado: 'cerrado', eventos: [], categorias: {} });
  const c = E.cacheVacia();
  let o = await E.obtener({ ics: 'https://x', cache: c, desde, hasta, outlook: abierto, descargar: async () => assert.fail('no debe bajar el ICS') });
  assert.strictEqual(o.fuente, 'outlook'); assert.strictEqual(c.titulos['cita'], '#3a86ff');
  o = await E.obtener({ ics: 'https://x', cache: c, desde, hasta, outlook: cerrado, descargar: async () => feed });
  assert.deepStrictEqual([o.fuente, o.eventos[0].color], ['ics', '#3a86ff']);
  o = await E.obtener({ ics: '', cache: c, desde, hasta, outlook: cerrado });
  assert.strictEqual(o.fuente, 'ninguna');
  o = await E.obtener({ ics: 'https://x', cache: c, desde, hasta, outlook: cerrado, descargar: async () => { throw new Error('HTTP 404'); } });
  assert.deepStrictEqual([o.fuente, o.error], ['error', 'HTTP 404']);
  console.log('TEST OK');
})();
