// Sincronización entre equipos y enlace con el Calendario por una carpeta compartida (la de OneDrive), sin servidor ni cuenta.
//  · notas-<EQUIPO>.json  lo escribe Post-It: las líneas de las notas que llevan hora (se ven en el Calendario)
//  · agenda-<EQUIPO>.json lo escribe el Calendario: sus próximos eventos (salen bajo cada fecha de las notas unidas)
// Cada equipo escribe solo su fichero y todos leen todos: así OneDrive no crea copias en conflicto.
// Sin dependencias de Electron: se prueba con node (tests/test_sync.js).
const fs = require('fs'), path = require('path'), os = require('os');

const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoHora = (d, h, m) => `${iso(d)}T${pad(h)}:${pad(m)}:00`;
const sumar = (d, n) => { const r = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); r.setDate(r.getDate() + n); return r; };
const versionMayor = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
const equipo = () => os.hostname().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'PC';

// ------------------------------------------------------------------ de HTML a líneas
const entidades = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
function lineas(html) {
  html = String(html || '')
    .replace(/<span[^>]*class=["']?(?:back|rep|alarm)[^>]*>[\s\S]*?<\/span>/gi, '')    // «vuelve…», el icono de periódica y las etiquetas de alarma (su hora no es una actividad)
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
const HORA = /\b([01]?\d|2[0-3])[:.h]([0-5]\d)\b(?:\s*(?:-|–|a|hasta)\s*\b([01]?\d|2[0-3])[:.h]([0-5]\d)\b)?/;
const HORA_SUELTA = /\b(?:a\s+las\s+)?([01]?\d|2[0-3])\s*h\b|\ba\s+las\s+([01]?\d|2[0-3])(?![\d:])/;

function resolverFecha(dia, mes, anio, hoy) {
  let a = anio ? (+anio < 100 ? 2000 + +anio : +anio) : hoy.getFullYear();
  let d = new Date(a, mes - 1, dia, 12);
  if (d.getMonth() !== mes - 1) return null;                                      // 31/02…
  if (!anio && hoy - d > 183 * 864e5) d = new Date(a + 1, mes - 1, dia, 12);      // «14/01» escrito en diciembre: el año que viene
  return d;
}
const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

// ------------------------------------------------------------------ de las notas a actividades
// Solo van al Calendario las líneas de una nota unida (botón 📅) que llevan hora y están debajo de una fecha (Jueves 22/10).
// notas: [{id, html, cal?}] · hoy: Date. Devuelve los items: {id, titulo, inicio, fin, hecho, nota}
function extraer(notas, hoy) {
  hoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 12);
  const items = [];
  for (const n of notas) {
    if (!n.cal) continue;
    let cabecera = null;
    for (const l of lineas(n.html)) {
      const solo = FECHA_SOLA.exec(norm(l.texto));
      if (solo && !l.caja) { cabecera = resolverFecha(+solo[1], +solo[2], solo[3], hoy) || cabecera; continue; }
      if (!cabecera) continue;
      let t = l.texto, h = HORA.exec(t), hi, mi, hf = null, mf = null;
      if (h) { hi = +h[1]; mi = +h[2]; if (h[3] != null) { hf = +h[3]; mf = +h[4]; } t = t.replace(h[0], ' '); }
      else if ((h = HORA_SUELTA.exec(t))) { hi = +(h[1] ?? h[2]); mi = 0; t = t.replace(h[0], ' '); }
      else continue;                                                              // sin hora no va al Calendario
      const titulo = t.replace(/@\S+/g, '').replace(/^[\s\-–:,.·]+|[\s\-–:,.·]+$/g, '').replace(/\s{2,}/g, ' ').replace(/\b(?:a\s+las|las|el|a)\s*$/i, '').trim() || 'Actividad';
      let fin = null;
      if (hf != null) { const f2 = (hf * 60 + mf) <= (hi * 60 + mi) ? sumar(cabecera, 1) : cabecera; fin = isoHora(f2, hf, mf); }
      items.push({ id: 'postit:' + n.id + ':' + hash(iso(cabecera) + norm(l.texto)), titulo, inicio: isoHora(cabecera, hi, mi), fin, hecho: l.hecha, nota: n.id });
    }
  }
  return items;
}

// ------------------------------------------------------------------ alarmas
// n.alarms = [{t: '2026-10-26T18:30' (hora local), txt}] (las manda el editor al guardar). Devuelve las que ya vencieron y no constaban como sonadas:
// {nota, a, clave, suena}. suena=false si vencieron hace más de un día (el equipo estaba apagado): se dan por sonadas sin avisar.
function alarmasVencidas(notas, sonadas, ahora = Date.now()) {
  const out = [];
  for (const n of notas) for (const a of n.alarms || []) {
    const clave = n.id + '|' + a.t, t = new Date(a.t).getTime();
    if (sonadas.has(clave) || !(t <= ahora)) continue;
    out.push({ nota: n, a, clave, suena: ahora - t < 864e5 });
  }
  return out;
}

// ------------------------------------------------------------------ carpeta de sincronización
// Una sola carpeta (la que comparte OneDrive entre equipos) con un fichero por equipo: postit-<EQUIPO>.json (notas, ajustes y colores recordados)
// y los de la agenda (notas-/agenda-/estado-) si se usa el Calendario. Cada equipo escribe SOLO el suyo y lee todos: OneDrive nunca crea copias en conflicto.
// Sin sincronización la «carpeta» es la de datos de la app (local) y todo funciona igual.
const NOMBRE_SYNC = 'Carpeta de Sincronización';
function carpetaOneDrive({ entorno = process.env, hogar = os.homedir() } = {}) { // carpeta propuesta dentro del OneDrive del equipo, o null
  const existe = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  const raices = ['OneDriveConsumer', 'OneDrive', 'OneDriveCommercial'].map(k => entorno[k]).filter(Boolean).concat(path.join(hogar, 'OneDrive'));
  const raiz = raices.find(existe);
  return raiz ? path.join(raiz, NOMBRE_SYNC) : null;
}
const huella = n => JSON.stringify({ ...n, mod: undefined });
// Estado de seguimiento: qué se sabe de cada nota para marcar cuándo cambió (mod) y qué se borró (borradas).
const estadoNuevo = () => ({ huellas: new Map(), borradas: new Map() });
function iniciarEstado(estado, notas, borradas = []) {      // tras leer/fusionar: se da por «tal cual está», sin tocar ningún mod
  estado.huellas = new Map(notas.map(n => [n.id, huella(n)]));
  estado.borradas = new Map(borradas.map(b => [b.id, b.mod]));
}
function marcar(estado, notas, ahora = Date.now()) {         // antes de guardar: las notas cambiadas llevan mod = ahora; las que faltan pasan a borradas
  const ids = new Set();
  for (const n of notas) {
    ids.add(n.id);
    const h = huella(n);
    if (estado.huellas.get(n.id) !== h) { n.mod = ahora; estado.huellas.set(n.id, h); estado.borradas.delete(n.id); }
  }
  for (const id of [...estado.huellas.keys()]) if (!ids.has(id)) { estado.huellas.delete(id); estado.borradas.set(id, ahora); }
  return [...estado.borradas].map(([id, mod]) => ({ id, mod }));
}
// Une lo que escribió cada equipo: por nota gana el cambio más reciente (mod); un borrado más reciente que la nota la quita.
// archivos: [{notas, borradas?, ajustes?, colores?}] · los antiguos (notes.json de la 1.x) valen mod 0. Devuelve {notas, borradas, ajustes, colores}.
function fusionar(archivos) {
  const mejor = new Map(), borr = new Map(); let ajustes = { mod: -1 }, colores = { categorias: {}, titulos: {} };
  for (const f of archivos) {
    for (const n of f.notas || []) { const m = mejor.get(n.id); if (!m || (n.mod || 0) > (m.mod || 0)) mejor.set(n.id, n); }
    for (const b of f.borradas || []) if (!borr.has(b.id) || b.mod > borr.get(b.id)) borr.set(b.id, b.mod);
    if (f.ajustes && f.ajustes.mod > ajustes.mod) ajustes = f.ajustes;      // sin mod (vacío, como el de memoria al arrancar) no cuenta
    if (f.colores) { Object.assign(colores.categorias, f.colores.categorias); Object.assign(colores.titulos, f.colores.titulos); }
  }
  const notas = [], borradas = [];
  for (const [id, n] of mejor) { if (borr.has(id) && borr.get(id) >= (n.mod || 0)) continue; notas.push(n); }
  for (const [id, mod] of borr) if (!mejor.has(id) || mejor.get(id).mod < mod) borradas.push({ id, mod });
  return { notas, borradas, ajustes: ajustes.mod < 0 ? {} : ajustes, colores };
}
const ficheroEquipo = (carpeta, nombre = equipo()) => path.join(carpeta, `postit-${nombre}.json`);
function leerSync(carpeta, { menos } = {}) {                 // todos los ficheros de notas de la carpeta (menos el que se indique: el propio, que ya está en memoria)
  let nombres = []; try { nombres = fs.readdirSync(carpeta); } catch { return []; }
  const out = [];
  for (const f of nombres) {
    const nuevo = /^postit-.+\.json$/i.test(f), viejo = /^notes.*\.json$/i.test(f);        // viejo = notes.json de la 1.x y sus copias en conflicto (una lista de notas)
    if ((!nuevo && !viejo) || (menos && path.resolve(carpeta, f) === path.resolve(menos))) continue;
    try { const o = JSON.parse(fs.readFileSync(path.join(carpeta, f), 'utf8')); out.push(nuevo && o && !Array.isArray(o) ? o : { notas: Array.isArray(o) ? o : [] }); } catch { /* medio escrito o roto: se ignora */ }
  }
  return out;
}
function firmaSync(carpeta, menos) {                         // cambia cuando otro equipo guarda algo (menos = el fichero propio, que no cuenta)
  try { return fs.readdirSync(carpeta).filter(f => /^(postit-.+|notes.*)\.json$/i.test(f) && !(menos && path.resolve(carpeta, f) === path.resolve(menos))).map(f => f + fs.statSync(path.join(carpeta, f)).mtimeMs).join('|'); } catch { return ''; }
}
function escribirSync(carpeta, datos, nombre = equipo()) {   // datos: {notas, borradas, ajustes, colores}
  fs.mkdirSync(carpeta, { recursive: true });
  return escribirAtomico(ficheroEquipo(carpeta, nombre), { version: 2, equipo: nombre, ...datos });
}

// ------------------------------------------------------------------ ficheros
function escribirAtomico(ruta, objeto) {
  const nuevo = JSON.stringify(objeto, null, 1);
  try { if (fs.readFileSync(ruta, 'utf8') === nuevo) return false; } catch { /* no existía */ }
  const tmp = ruta + '.tmp';
  fs.writeFileSync(tmp, nuevo); fs.renameSync(tmp, ruta);
  return true;
}
function pedirRefresco(carpeta, nombre = equipo()) {                    // aviso al Calendario de este equipo: que relea Outlook ya (él borra el fichero al recogerlo)
  fs.writeFileSync(path.join(carpeta, `refrescar-${nombre}.txt`), iso(new Date()));
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

module.exports = { versionMayor, lineas, extraer, alarmasVencidas, carpetaOneDrive, estadoNuevo, iniciarEstado, marcar, fusionar, ficheroEquipo, leerSync, firmaSync, escribirSync, escribirNotas, pedirRefresco, leerAgenda, firmaAgenda, equipo, iso };
