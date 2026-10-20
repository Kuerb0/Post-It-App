// Enlace con el Calendario por una carpeta compartida (AgendaCompartida), sin servidor ni cuenta.
//  · notas-<EQUIPO>.json  lo escribe Post-It: las líneas de las notas que llevan hora (se ven en el Calendario)
//  · agenda-<EQUIPO>.json lo escribe el Calendario: sus próximos eventos (salen en la nota «Agenda»)
// Cada equipo escribe solo su fichero y todos leen todos: así OneDrive no crea copias en conflicto.
// Sin dependencias de Electron: se prueba con node (tests/test_sync.js).
const fs = require('fs'), path = require('path'), os = require('os');

const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const NOMBRE_CARPETA = 'AgendaCompartida';
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoHora = (d, h, m) => `${iso(d)}T${pad(h)}:${pad(m)}:00`;
const sumar = (d, n) => { const r = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); r.setDate(r.getDate() + n); return r; };
const equipo = () => os.hostname().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'PC';

// ------------------------------------------------------------------ de HTML a líneas
const entidades = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
function lineas(html) {
  html = String(html || '')
    .replace(/<span[^>]*class=["']?(?:back|rep)[^>]*>[\s\S]*?<\/span>/gi, '')    // «vuelve…» y el icono de periódica
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<div[^>]*class=["']?cal\b[^>]*>[\s\S]*?<\/div>/gi, '');              // eventos del Calendario pintados en la nota: no vuelven a él
  return html.split(/<\/(?:div|li|h3|p)>|<br\s*\/?>/i).map(seg => {
    const caja = /<input[^>]*type=["']?checkbox["']?[^>]*>/i.exec(seg);
    const texto = seg.replace(/<[^>]+>/g, '').replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, m => entidades[m]).replace(/\s+/g, ' ').trim();
    return { texto, caja: !!caja, hecha: !!caja && /\bchecked\b/i.test(caja[0]) };
  }).filter(l => l.texto || l.caja);
}

// ------------------------------------------------------------------ fechas y horas
const FECHA_SOLA = /^(?:(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+)?(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?:?$/;
const FECHA_EN_LINEA = /\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/;
const HORA = /\b([01]?\d|2[0-3])[:.h]([0-5]\d)\b(?:\s*(?:-|–|a|hasta)\s*\b([01]?\d|2[0-3])[:.h]([0-5]\d)\b)?/;
const HORA_SUELTA = /\b(?:a\s+las\s+)?([01]?\d|2[0-3])\s*h\b|\ba\s+las\s+([01]?\d|2[0-3])(?![\d:])/;

function resolverFecha(dia, mes, anio, hoy) {
  let a = anio ? (+anio < 100 ? 2000 + +anio : +anio) : hoy.getFullYear();
  let d = new Date(a, mes - 1, dia, 12);
  if (d.getMonth() !== mes - 1) return null;                                      // 31/02…
  if (!anio && hoy - d > 183 * 864e5) d = new Date(a + 1, mes - 1, dia, 12);      // «14/01» escrito en diciembre: el año que viene
  return d;
}
function palabraDeFecha(t, hoy) {                  // hoy, mañana, pasado mañana, un día de la semana
  const n = norm(t);
  let m = /\bpasado\s+manana\b/.exec(n); if (m) return { d: sumar(hoy, 2), quita: m[0] };
  m = /\bmanana\b/.exec(n); if (m) return { d: sumar(hoy, 1), quita: m[0] };
  m = /\bhoy\b/.exec(n); if (m) return { d: hoy, quita: m[0] };
  m = new RegExp('\\b(' + DIAS.join('|') + ')\\b').exec(n);
  if (m) { const i = DIAS.indexOf(m[1]); return { d: sumar(hoy, (i - hoy.getDay() + 7) % 7), quita: m[0] }; }
  return null;
}
function quitar(texto, patron) {                   // quita de «texto» lo que casa con un patrón (sin tildes) conservando el resto tal cual
  const n = norm(texto); const m = typeof patron === 'string' ? { index: n.indexOf(patron), 0: patron } : patron.exec(n);
  if (!m || m.index < 0) return texto;
  return texto.slice(0, m.index) + ' ' + texto.slice(m.index + m[0].length);
}
const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

// ------------------------------------------------------------------ de las notas a actividades
// notas: [{id, html, agenda?}] · hoy: Date · vistos: {id: 'AAAA-MM-DD'} (primer día en que se vio una línea sin fecha: no se mueve con los días)
// Devuelve {items, vistos}. Cada item: {id, titulo, inicio, fin, hecho, nota}
function extraer(notas, hoy, vistos = {}) {
  hoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 12);
  const items = [], vistosNuevos = {};
  for (const n of notas) {
    if (n.agenda) continue;                                                       // la nota Agenda viene del Calendario: no vuelve a él
    let cabecera = null;
    for (const l of lineas(n.html)) {
      const solo = FECHA_SOLA.exec(norm(l.texto));
      if (solo && !l.caja) { cabecera = resolverFecha(+solo[1], +solo[2], solo[3], hoy) || cabecera; continue; }
      let t = l.texto, h = HORA.exec(t), hi, mi, hf = null, mf = null;
      if (h) { hi = +h[1]; mi = +h[2]; if (h[3] != null) { hf = +h[3]; mf = +h[4]; } t = t.replace(h[0], ' '); }
      else if ((h = HORA_SUELTA.exec(t))) { hi = +(h[1] ?? h[2]); mi = 0; t = t.replace(h[0], ' '); }
      else {                                                                      // sin hora: solo en notas unidas y bajo una fecha → tarea de todo el día
        const titulo = t.replace(/@\S+/g, '').replace(/\s{2,}/g, ' ').trim();
        if (n.cal && cabecera && titulo) items.push({ id: 'postit:' + n.id + ':' + hash(iso(cabecera) + norm(l.texto)), titulo,
          inicio: isoHora(cabecera, 12, 0), fin: null, todo_dia: true, hecho: l.hecha, nota: n.id });
        continue;
      }
      let fecha = null;
      const f = FECHA_EN_LINEA.exec(t);
      if (f) { fecha = resolverFecha(+f[1], +f[2], f[3], hoy); if (fecha) t = t.replace(f[0], ' '); }
      if (!fecha) { const p = palabraDeFecha(t, hoy); if (p) { fecha = p.d; t = quitar(t, p.quita); } }
      const clave = 'postit:' + n.id + ':' + hash(norm(l.texto));
      if (!fecha) fecha = cabecera;
      if (!fecha) { const v = vistos[clave]; fecha = v ? new Date(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10), 12) : hoy; }
      vistosNuevos[clave] = iso(fecha);
      const titulo = t.replace(/^[\s\-–:,.·@]+|[\s\-–:,.·]+$/g, '').replace(/\s{2,}/g, ' ').replace(/\b(?:a\s+las|las|el|a)\s*$/i, '').trim() || 'Actividad';
      let fin = null;
      if (hf != null) { const f2 = (hf * 60 + mf) <= (hi * 60 + mi) ? sumar(fecha, 1) : fecha; fin = isoHora(f2, hf, mf); }
      items.push({ id: clave, titulo, inicio: isoHora(fecha, hi, mi), fin, hecho: l.hecha, nota: n.id });
    }
  }
  return { items, vistos: vistosNuevos };
}

// ------------------------------------------------------------------ carpeta compartida
// Orden: la guardada · la variable AGENDA_COMPARTIDA · una carpeta AgendaCompartida junto a la app, en OneDrive o en Documentos · se crea junto a la app.
function carpetaCompartida({ guardada, raiz, entorno = process.env, hogar = os.homedir() } = {}) {
  const existe = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  if (guardada && existe(guardada)) return { ruta: guardada, origen: 'guardada' };
  if (entorno.AGENDA_COMPARTIDA && existe(entorno.AGENDA_COMPARTIDA)) return { ruta: entorno.AGENDA_COMPARTIDA, origen: 'entorno' };
  const candidatas = [];
  if (raiz) { candidatas.push(path.join(path.dirname(raiz), NOMBRE_CARPETA), path.join(path.dirname(path.dirname(raiz)), NOMBRE_CARPETA)); }
  for (const k of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) if (entorno[k]) candidatas.push(path.join(entorno[k], NOMBRE_CARPETA));
  candidatas.push(path.join(hogar, 'OneDrive', NOMBRE_CARPETA), path.join(hogar, 'Documents', NOMBRE_CARPETA), path.join(hogar, 'Documentos', NOMBRE_CARPETA));
  for (const c of candidatas) if (existe(c)) return { ruta: c, origen: 'detectada' };
  const nueva = raiz ? path.join(path.dirname(raiz), NOMBRE_CARPETA) : path.join(hogar, NOMBRE_CARPETA);
  try { fs.mkdirSync(nueva, { recursive: true }); return { ruta: nueva, origen: 'creada' }; } catch { return { ruta: null, origen: 'ninguna' }; }
}

// ------------------------------------------------------------------ ficheros
function escribirAtomico(ruta, objeto) {
  const nuevo = JSON.stringify(objeto, null, 1);
  try { if (fs.readFileSync(ruta, 'utf8') === nuevo) return false; } catch { /* no existía */ }
  const tmp = ruta + '.tmp';
  fs.writeFileSync(tmp, nuevo); fs.renameSync(tmp, ruta);
  return true;
}
function escribirNotas(carpeta, items, nombre = equipo()) {            // el contenido no lleva la hora de escritura: si no cambia nada, no se toca el fichero
  return escribirAtomico(path.join(carpeta, `notas-${nombre}.json`), { version: 1, equipo: nombre, items });
}
function leerFicheros(carpeta, prefijo) {
  let nombres = []; try { nombres = fs.readdirSync(carpeta).filter(f => f.startsWith(prefijo + '-') && f.endsWith('.json')); } catch { return []; }
  const salida = [];
  for (const f of nombres) { try { const o = JSON.parse(fs.readFileSync(path.join(carpeta, f), 'utf8')); if (o && o.version === 1) salida.push({ fichero: f, ...o }); } catch { /* medio escrito o roto: se ignora */ } }
  return salida;
}
// Eventos del Calendario de todos los equipos, de ahora a «dias» días, sin repetidos
function leerAgenda(carpeta, ahora, dias = 7) {
  const desde = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()), hasta = sumar(desde, dias);
  const vistos = new Map();
  for (const f of leerFicheros(carpeta, 'agenda')) for (const e of f.eventos || []) {
    const ini = new Date(e.inicio); if (isNaN(ini) || ini < desde || ini >= hasta) continue;
    if (!vistos.has(e.id)) vistos.set(e.id, e);
  }
  return [...vistos.values()].sort((a, b) => a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0);
}
function firmaAgenda(carpeta) {
  try { return fs.readdirSync(carpeta).filter(f => f.startsWith('agenda-')).map(f => f + fs.statSync(path.join(carpeta, f)).mtimeMs).join('|'); } catch { return ''; }
}

// ------------------------------------------------------------------ la nota «Agenda»
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function htmlAgenda(eventos, ahora) {
  const NOMBRES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  let h = `<h3>Agenda del Calendario</h3><div style="opacity:.6">Se rellena sola. Lo que escribas aquí se borra.</div>`, dia = '';
  if (!eventos.length) h += '<div><br></div><div>Sin eventos en los próximos días.</div>';
  for (const e of eventos) {
    const d = new Date(e.inicio), k = iso(d);
    if (k !== dia) { dia = k; h += `<div><br></div><div><b>${NOMBRES[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}</b></div>`; }
    h += `<div>${e.todo_dia ? 'Todo el día' : pad(d.getHours()) + ':' + pad(d.getMinutes())} ${esc(e.titulo)}</div>`;
  }
  return h;
}

module.exports = { lineas, extraer, carpetaCompartida, escribirNotas, leerAgenda, firmaAgenda, htmlAgenda, equipo, iso, NOMBRE_CARPETA };
