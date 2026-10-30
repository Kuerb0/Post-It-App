// Eventos del calendario para las notas unidas: Outlook clásico si está abierto (con el color de su etiqueta) o, si no, el enlace ICS publicado.
// Todos los eventos salen como {id, titulo, inicio, fin, todo_dia, color|null} con las horas locales en ISO sin zona (2026-10-30T18:30:00).
// Sin dependencias de Electron: se prueba con node (tests/test_eventos.js).
const fs = require('fs'), path = require('path'), https = require('https'), { execFile } = require('child_process');

const pad = n => String(n).padStart(2, '0');
const isoLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const HEX = /^#[0-9a-f]{6}$/i;

// ------------------------------------------------------------------ ICS
function lineasICS(texto) { // desdobla las líneas largas (continúan con un espacio o tabulador)
  return String(texto).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
}
const sinEscape = s => s.replace(/\\([nN,;\\])/g, (m, c) => c === 'n' || c === 'N' ? ' ' : c);
function fechaICS(valor, params) { // → {d: Date local, dia: bool}. Con «Z» es UTC; con TZID u hora suelta se toma como hora local
  const m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?$/.exec(valor.trim());
  if (!m) return null;
  if (m[4] == null) return { d: new Date(+m[1], +m[2] - 1, +m[3]), dia: true };
  // ponytail: con TZID se asume la zona del equipo (Outlook publica la del usuario); un TZID ajeno saldría desplazado
  return { d: m[7] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))) : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)), dia: false };
}
function parseICS(texto) {
  const evs = []; let e = null;
  for (const l of lineasICS(texto)) {
    if (l === 'BEGIN:VEVENT') { e = { exdates: [] }; continue; }
    if (l === 'END:VEVENT') { if (e && e.ini) evs.push(e); e = null; continue; }
    if (!e) continue;
    const i = l.indexOf(':'); if (i < 0) continue;
    const [nombre, ...ps] = l.slice(0, i).split(';'), valor = l.slice(i + 1), p = ps.join(';');
    switch (nombre.toUpperCase()) {
      case 'UID': e.uid = valor; break;
      case 'SUMMARY': e.titulo = sinEscape(valor); break;
      case 'DTSTART': e.ini = fechaICS(valor, p); break;
      case 'DTEND': e.fin = fechaICS(valor, p); break;
      case 'RRULE': e.rrule = Object.fromEntries(valor.split(';').map(x => x.split('='))); break;
      case 'EXDATE': for (const v of valor.split(',')) { const f = fechaICS(v, p); if (f) e.exdates.push(isoLocal(f.d)); } break;
      case 'RECURRENCE-ID': e.recId = fechaICS(valor, p); break;
      case 'STATUS': e.cancelado = /cancel/i.test(valor); break;
      case 'CATEGORIES': e.categoria = valor.split(',')[0]; break;
      case 'COLOR': if (HEX.test(valor)) e.color = valor; break;
    }
  }
  return evs;
}
const DIAS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
function ocurrencias(e, desde, hasta) { // fechas de inicio (Date) de un evento dentro de [desde, hasta)
  const r = e.rrule, ini = e.ini.d;
  if (!r) return ini >= desde && ini < hasta ? [ini] : [];
  const paso = Math.max(1, +r.INTERVAL || 1), limite = r.UNTIL ? fechaICS(r.UNTIL, '').d : null, max = r.COUNT ? +r.COUNT : Infinity;
  const dias = r.BYDAY ? r.BYDAY.split(',').map(x => DIAS[x.slice(-2)]).filter(x => x != null) : [ini.getDay()];
  // ponytail: BYDAY con número (1.º lunes del mes) se trata como el día del mes de la fecha de inicio
  const out = []; let n = 0;
  const avanza = { DAILY: d => new Date(d.getFullYear(), d.getMonth(), d.getDate() + paso, d.getHours(), d.getMinutes()),
    WEEKLY: d => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, d.getHours(), d.getMinutes()),
    MONTHLY: d => new Date(d.getFullYear(), d.getMonth() + paso, d.getDate(), d.getHours(), d.getMinutes()),
    YEARLY: d => new Date(d.getFullYear() + paso, d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) }[r.FREQ];
  if (!avanza) return ini >= desde && ini < hasta ? [ini] : [];
  const semana0 = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() - ini.getDay());
  for (let d = ini, guardia = 0; d < hasta && guardia < 20000; d = avanza(d), guardia++) {
    if (limite && d > limite) break;
    if (r.FREQ === 'WEEKLY') { // solo los días de BYDAY, y solo cada «paso» semanas
      const sem = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()) - semana0) / (7 * 864e5));
      if (sem % paso || !dias.includes(d.getDay())) continue;
    }
    if (++n > max) break;
    if (d >= desde) out.push(d);
  }
  return out;
}
function eventosICS(texto, desde, hasta) {
  const todos = parseICS(texto), cambios = new Map();
  for (const e of todos) if (e.recId) cambios.set(e.uid + '|' + isoLocal(e.recId.d), e);
  const out = [];
  for (const e of todos) {
    if (e.recId || e.cancelado) continue;
    const dur = e.fin ? e.fin.d - e.ini.d : (e.ini.dia ? 864e5 : 0);
    for (const o of ocurrencias(e, new Date(desde.getTime() - dur), hasta)) {
      const clave = isoLocal(o); if (e.exdates.includes(clave)) continue;
      const v = cambios.get(e.uid + '|' + clave); if (v && v.cancelado) continue;
      const x = v || e, ini = v ? v.ini.d : o, fin = new Date(ini.getTime() + (v && v.fin ? v.fin.d - v.ini.d : dur));
      if (fin <= desde && ini < desde) continue;
      out.push({ id: `${e.uid}@${isoLocal(ini)}`, titulo: x.titulo || '(sin título)', inicio: isoLocal(ini), fin: isoLocal(fin), todo_dia: e.ini.dia, color: HEX.test(x.color || '') ? x.color : null, categoria: x.categoria || '' });
    }
  }
  return out.sort((a, b) => a.inicio < b.inicio ? -1 : 1);
}

// ------------------------------------------------------------------ colores recordados
// El ICS de Outlook web no lleva etiquetas ni colores. Cuando Outlook clásico está abierto, se recuerda el color de cada título
// (cache.titulos) y de cada etiqueta (cache.categorias) para pintar luego los eventos del ICS aunque Outlook esté cerrado.
const cacheVacia = () => ({ categorias: {}, titulos: {} });
function recordar(cache, eventos, categorias) {
  Object.assign(cache.categorias, categorias || {});
  for (const e of eventos) if (e.color) cache.titulos[norm(e.titulo)] = e.color;
  const k = Object.keys(cache.titulos); if (k.length > 2000) for (const x of k.slice(0, k.length - 2000)) delete cache.titulos[x]; // ponytail: tope simple; el más viejo sale primero
  return cache;
}
const colorear = (eventos, cache) => eventos.map(e => e.color ? e : { ...e, color: cache.titulos[norm(e.titulo)] || cache.categorias[e.categoria] || null });

// ------------------------------------------------------------------ fuentes
function leerOutlook(desde, hasta, ps1 = path.join(__dirname, 'outlook.ps1')) { // → {estado: 'ok'|'cerrado'|'no'|'error', eventos, categorias}
  const f = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return new Promise(res => execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Desde', f(desde), '-Hasta', f(hasta)],
    { windowsHide: true, timeout: 60000, maxBuffer: 64 << 20, encoding: 'utf8' }, (err, out) => {
      if (!err) { try { const j = JSON.parse(out); return res({ estado: 'ok', eventos: [].concat(j.eventos || []), categorias: j.categorias || {} }); } catch { return res({ estado: 'error', eventos: [], categorias: {} }); } }
      res({ estado: { 3: 'cerrado', 4: 'no' }[err.code] || 'error', eventos: [], categorias: {} });
    }));
}
function bajar(url, saltos = 4) {
  return new Promise((ok, mal) => {
    https.get(url.replace(/^webcal:/i, 'https:'), { timeout: 30000 }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && saltos > 0) { r.resume(); return bajar(new URL(r.headers.location, url).href, saltos - 1).then(ok, mal); }
      if (r.statusCode !== 200) { r.resume(); return mal(new Error('HTTP ' + r.statusCode)); }
      let s = ''; r.setEncoding('utf8'); r.on('data', d => s += d); r.on('end', () => ok(s));
    }).on('error', mal).on('timeout', function () { this.destroy(new Error('sin respuesta')); });
  });
}
// Outlook clásico abierto → él (con colores); si no, el ICS con los colores recordados. cfg: {ics}. Devuelve {fuente, eventos, cache}
async function obtener({ ics, cache = cacheVacia(), desde, hasta, outlook = leerOutlook, descargar = bajar }) {
  const o = await outlook(desde, hasta);
  if (o.estado === 'ok') { recordar(cache, o.eventos, o.categorias); return { fuente: 'outlook', eventos: o.eventos, cache }; }
  if (!ics) return { fuente: 'ninguna', estadoOutlook: o.estado, eventos: [], cache };
  try { return { fuente: 'ics', estadoOutlook: o.estado, eventos: colorear(eventosICS(await descargar(ics), desde, hasta), cache), cache }; }
  catch (err) { return { fuente: 'error', error: String(err.message || err), estadoOutlook: o.estado, eventos: [], cache }; }
}

module.exports = { parseICS, eventosICS, recordar, colorear, cacheVacia, leerOutlook, obtener, bajar, norm };
