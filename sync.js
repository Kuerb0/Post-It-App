// Enlace con el Calendario por una carpeta compartida (AgendaCompartida), sin servidor ni cuenta.
//  · notas-<EQUIPO>.json  lo escribe Post-It: las líneas de las notas que llevan hora (se ven en el Calendario)
//  · agenda-<EQUIPO>.json lo escribe el Calendario: sus próximos eventos (salen bajo cada fecha de las notas unidas)
// Cada equipo escribe solo su fichero y todos leen todos: así OneDrive no crea copias en conflicto.
// Sin dependencias de Electron: se prueba con node (tests/test_sync.js).
const fs = require('fs'), path = require('path'), os = require('os');

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

// ------------------------------------------------------------------ dónde viven las notas
// Junto a la carpeta compartida (OneDrive\Post-It\notes.json): lo que sincroniza OneDrive es lo que ven todos los equipos.
// La app instalada vive en local (%LOCALAPPDATA%), así que sus notas NO pueden quedarse junto a ella. Sin carpeta compartida: junto a la app.
function rutaNotas({ carpeta, local }) {
  return carpeta ? path.join(path.dirname(carpeta), 'Post-It', 'notes.json') : local;
}
// Primera vez en esa ruta: se llevan las notas que tenía la app. Si ya hay unas allí (de otro equipo), mandan esas y las locales no se tocan.
function migrarNotas(destino, local) {
  if (destino === local || fs.existsSync(destino) || !fs.existsSync(local)) return false;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(local, destino);
  return true;
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

module.exports = { lineas, extraer, carpetaCompartida, rutaNotas, migrarNotas, escribirNotas, leerAgenda, firmaAgenda, equipo, iso, NOMBRE_CARPETA };
