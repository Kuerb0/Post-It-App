"""Capturas del Post-It REAL para el tráiler: abre note.html y lanzador.html de verdad en Edge sin ventana (con un `api` de mentira y la fecha fijada en
viernes 06/11/2026), los maneja con eventos de ratón y teclado reales (clic derecho, arrastrar, escribir) y guarda una captura por cada estado en
trailer/capturas/capturas.js (que trailer.html lee). Así los botones, el menú, las tablas, las carpetas, el calendario y el lanzador son los de la app,
no un dibujo parecido.

    python herramientas/trailer_capturas.py           # todas las escenas
    python herramientas/trailer_capturas.py --prueba  # solo una nota vacía en trailer/capturas/prueba.png
"""
import base64
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import trailer
from trailer import Pagina

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent
SAL = RAIZ / "trailer" / "capturas"
NW, NH, DSF = 380, 440, 2

STUB = r"""
(() => {
  const FIX = new Date(2026, 10, 6, 10, 0, 0).getTime(), RD = Date;
  class D extends RD { constructor(...a) { a.length ? super(...a) : super(FIX); } static now() { return FIX; } }
  window.Date = D;
  window.__cb = {}; window.__agenda = [];
  window.api = new Proxy({}, { get: (_, k) => {
    if (k.startsWith('on')) return f => { window.__cb[k] = f; };
    if (k === 'get') return () => new Promise(() => {});
    if (k === 'estilo') return () => Promise.resolve({ fs: 15, lh: 1.35 });
    if (k === 'agenda') return () => Promise.resolve(window.__agenda);
    if (k === 'cal') return () => Promise.resolve(true);
    if (k === 'lanz') return () => {};
    if (k === 'icsGet') return () => Promise.resolve({ ics: '', fuente: 'outlook', n: 14, estadoOutlook: 'abierto' });
    return () => Promise.resolve(null);
  } });
})();
"""


class Real(Pagina):
    """Una página real de la app (note.html o lanzador.html) con el api de mentira."""

    def __init__(self, archivo, ancho, alto, query=""):
        super().__init__(url="about:blank", ancho=ancho, alto=alto, dsf=DSF, esperar=None, puerto=9230)
        self.cmd("Page.enable")
        self.cmd("Emulation.setFocusEmulationEnabled", enabled=True)
        self.cmd("Page.addScriptToEvaluateOnNewDocument", source=STUB)
        self.cmd("Page.navigate", url=(RAIZ / archivo).as_uri() + query)
        time.sleep(1.5)

    def foto(self, nombre, clip=None):
        p = {"format": "png"}
        if clip:
            p["clip"] = {"x": clip[0], "y": clip[1], "width": clip[2], "height": clip[3], "scale": 1}
        d = base64.b64decode(self.cmd("Page.captureScreenshot", **p)["data"])
        SAL.mkdir(parents=True, exist_ok=True)
        (SAL / f"{nombre}.png").write_bytes(d)
        return nombre

    # --- ratón y teclado de verdad
    def mover(self, x, y):
        self.cmd("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y)

    def clic(self, x, y, boton="left"):
        self.cmd("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y)
        self.cmd("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y, button=boton, clickCount=1)
        self.cmd("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y, button=boton, clickCount=1)

    def escribir(self, s):
        self.cmd("Input.insertText", text=s)

    def tecla(self, key, code=None, mod=0, texto=None):
        vk = {"Tab": 9, "Enter": 13, "KeyT": 84, "KeyF": 70, "Escape": 27}.get(code or key, 0)
        base = dict(key=key, code=code or key, modifiers=mod, windowsVirtualKeyCode=vk)
        if texto:
            base["text"] = texto
        self.cmd("Input.dispatchKeyEvent", type="keyDown", **base)
        self.cmd("Input.dispatchKeyEvent", type="keyUp", **{k: v for k, v in base.items() if k != "text"})

    def rect(self, sel):
        return self.js(f"(()=>{{const r=document.querySelector({json.dumps(sel)}).getBoundingClientRect();return [r.left,r.top,r.width,r.height]}})()")

    def nota(self, html, color="#fff176", cal=False):
        self.js(f"window.__cb.onSet({{id:'demo',color:{json.dumps(color)},html:{json.dumps(html)},z:0,glass:false,cols:0,limpia:false,calHechos:[],cal:{str(cal).lower()}}})")
        time.sleep(.5)


ESTADOS = []   # [t del guion, nombre de la captura]
PUNTOS = {}    # posiciones (px CSS dentro de la ventana) para el cursor
AMA, AZU = "#fff176", "#81d4fa"


def estado(pg, t, nombre):
    pg.foto(nombre)
    ESTADOS.append([round(t, 3), nombre])


def punto(nombre, x, y):
    PUNTOS[nombre] = [round(x, 1), round(y, 1)]


def teclear(pg, texto, t0, cps, pref):
    """Escribe letra a letra con el teclado real y deja una captura tras cada una (t = cuándo se ve)."""
    for i, c in enumerate(texto):
        pg.escribir(c)
        estado(pg, t0 + i / cps, f"{pref}{i:02d}")
    return t0 + len(texto) / cps


def poner_sel(pg, linea, a, b):
    """Selecciona [a, b) del texto de la línea con ese índice (el último nodo de texto)."""
    return pg.js(f"""(()=>{{const d=ed.children[{linea}];const w=document.createTreeWalker(d,4);let n,t;while(n=w.nextNode())t=n;
      ed.focus();const r=document.createRange();r.setStart(t,{a});r.setEnd(t,{b} < 0 ? t.length : {b});const s=getSelection();s.removeAllRanges();s.addRange(r);
      const q=r.getBoundingClientRect();return [q.left,q.top,q.width,q.height]}})()""")


def caret_fin(pg, linea):
    pg.js(f"""(()=>{{const d=ed.children[{linea}];ed.focus();const r=document.createRange();r.selectNodeContents(d);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r)}})()""")


def esc_tareas(pg):
    pg.nota("<div><br></div>", AMA)
    estado(pg, 3.2, "a_vacio")
    pg.js("ed.focus()")
    teclear(pg, "Viernes 06/11", 4.2, 16, "a_fecha")
    time.sleep(.7); estado(pg, 5.5, "a_fecha_hoy")
    pg.tecla("Enter", texto="\r"); time.sleep(.6)
    for linea, (txt, t0, tx0) in enumerate([("Llamar al dentista", 5.7, 6.0), ("Entregar el informe", 7.4, 7.4), ("Comprar regalo de Ana", 9.0, 9.0)], 1):
        if linea == 1:                                           # solo la primera lleva «- » + espacio: las siguientes ya nacen tarea (Intro en una tarea)
            pg.escribir("-"); estado(pg, t0, f"a_l{linea}_g")
            pg.escribir(" "); estado(pg, t0 + .15, f"a_l{linea}_caja")
        teclear(pg, txt, tx0, 20, f"a_l{linea}_")
        if linea < 3:
            pg.tecla("Enter", texto="\r"); time.sleep(.6); estado(pg, tx0 + len(txt) / 20 + .1, f"a_l{linea}_nl")
    time.sleep(.6)
    caret_fin(pg, 1); pg.tecla("Enter", code="Enter", mod=2, texto="\r"); time.sleep(.3)
    estado(pg, 10.6, "a_hecha")
    # --- seleccionar «Entregar el informe» y clic derecho
    n = len("Entregar el informe")
    r = poner_sel(pg, 2, 0, n); y = r[1] + r[3] / 2
    punto("sel_ini", r[0], y); punto("sel_fin", r[0] + r[2], y)
    for i in range(1, 9):
        r = poner_sel(pg, 2, 0, round(n * i / 8))
        estado(pg, 12.0 + .1 * i, f"b_sel{i}")
    xr, yr = r[0] + r[2] - 10, y
    punto("clic_der", xr, yr)
    for k, (t_open, t_clic, item) in enumerate([(13.2, 14.6, "[data-c=bold]"), (15.5, 16.6, "#cms button:nth-child(3)"), (17.7, 18.9, "button[data-v=comp]")], 1):
        pg.clic(xr, yr, "right"); time.sleep(.25)
        estado(pg, t_open, f"b_menu{k}")
        c = pg.rect("#cm " + item); cx, cy = c[0] + c[2] / 2, c[1] + c[3] / 2
        punto(f"item{k}", cx, cy)
        pg.mover(cx, cy); time.sleep(.15)
        estado(pg, t_clic - .45, f"b_hover{k}")
        pg.clic(cx, cy); time.sleep(.35)
        estado(pg, t_clic + .1, f"b_hecho{k}")
        pg.js("getSelection().collapseToEnd()"); time.sleep(.2)          # sin la selección encima se ve el resultado (negrita, rojo, complementario)
        estado(pg, t_clic + .55, f"b_vista{k}")
        poner_sel(pg, 2, 0, -1)
        pg.mover(xr, yr)
    pg.clic(r[0] + 40, 330); time.sleep(.3)             # quitar la selección
    estado(pg, 19.6, "b_fin")


def esc_tabla(pg):
    pg.nota("<div><br></div>", AMA)
    caret_fin(pg, 0)
    pg.tecla("T", code="KeyT", mod=10); time.sleep(.5)
    estado(pg, 21.1, "c_vacia")
    filas = [("Dentista", "06/11", 22.2), ("Entregar informe", "08/11", 23.0), ("Cumple de Ana", "12/11", 23.8), ("Vuelo a Lisboa", "25/11", 24.6), ("Vacaciones", "20/12", 25.4), ("Pagar la luz", "03/11", 26.2)]
    for i, (ev, fe, ta) in enumerate(filas):
        teclear(pg, ev, ta, 26, f"c_r{i}e")
        pg.tecla("Tab", code="Tab")
        teclear(pg, fe, ta + .4, 22, f"c_r{i}f")
        time.sleep(.7); estado(pg, ta + .9, f"c_r{i}ok")
        pg.tecla("Tab", code="Tab")
    pg.js("ed.blur()"); time.sleep(.8)                    # salir de la tabla: se ordena y se colorea
    estado(pg, 27.0, "c_final")
    c = pg.rect("#ed table tr:nth-child(3) td")
    pg.clic(c[0] + 20, c[1] + 10, "right"); time.sleep(.5)
    punto("tp_clic", c[0] + 20, c[1] + 10)
    estado(pg, 28.0, "c_ajustes")
    pg.tecla("Escape", code="Escape"); time.sleep(.3)


def esc_carpetas(pg):
    html = ('<div class=fold data-closed>Ideas de regalo</div><div>Libro de cocina</div><div>Entradas de teatro</div>'
            '<div class=fold data-closed>Aniversarios</div><div>Boda 02/12</div>'
            '<div class=fold data-closed>Cumpleaños</div><div>Ana 12/11</div><div>Pablo 30/11</div><div><br></div>')
    pg.nota("<div><br></div>", AMA)
    pg.js(f"(()=>{{ed.innerHTML={json.dumps(html)};refold();paintDias()}})()"); time.sleep(.4)
    pg.js("ed.blur()")
    estado(pg, 29.5, "d_cerradas")
    f = pg.js("(()=>{const r=[...ed.querySelectorAll('.fold')].at(-1).getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
    punto("fold_cumple", f[0] + 60, f[1] + f[3] / 2)
    pg.clic(f[0] + 60, f[1] + f[3] / 2); time.sleep(.4)
    estado(pg, 30.7, "d_abierta")
    pg.js("ed.blur()"); pg.js("sortFolds()"); time.sleep(.4)
    estado(pg, 33.0, "d_ordenadas")


def esc_lanzador(pg):
    notas = [("a", AMA, "<div>Viernes 06/11</div><div><input type=checkbox>Llamar al dentista</div><div><input type=checkbox>Entregar el informe</div>", True, True, True),
             ("b", "#ffab91", "<h3>Compra</h3><div>Leche</div><div>Pan</div><div>Fruta</div>", False, True, True),
             ("c", "#a5d6a7", "<div>Ideas para el viaje</div><div>• Lisboa</div><div>• Oporto</div>", False, False, False),
             ("d", AZU, "<div>Lunes 09/11</div><div>09:30 Reunión de equipo</div>", False, True, True),
             ("e", "#f48fb1", "<div>Regalo de Ana</div><div>Libro de cocina</div>", False, False, False),
             ("f", "#ce93d8", "<div>Tesis</div><div>Capítulo 3: revisar</div>", False, True, False),
             ("g", AMA, "<div>Contraseñas de la wifi</div><div>Salón: …</div>", False, False, False)]
    L = [dict(id=i, color=c, html=h, main=m, start=s, open=o) for i, c, h, m, s, o in notas]
    pg.js(f"window.__cb.onLanz({json.dumps(L)})"); time.sleep(.5)
    estado(pg, 36.6, "e_base")
    c = pg.rect('[data-id=d]'); cx, cy = c[0] + c[2] / 2, c[1] + c[3] / 2
    punto("thumb", cx, cy)
    pg.mover(cx, cy); time.sleep(.3)
    estado(pg, 39.2, "e_hover")


def esc_calendario(pg):
    ev = [dict(id="1", inicio="2026-11-09T09:30", titulo="Reunión de equipo", color="#d93025"), dict(id="2", inicio="2026-11-09T12:00", titulo="Comida con Ana", color="#188038"),
          dict(id="3", inicio="2026-11-10T16:00", titulo="Dentista", color="#1a73e8"), dict(id="4", inicio="2026-11-10T18:30", titulo="Gimnasio", color="#e8710a")]
    pg.js("window.__agenda=[]")
    pg.nota("<div>Lunes 09/11</div><div><br></div><div>Martes 10/11</div><div><br></div>", AZU, cal=True)
    estado(pg, 40.6, "f_base")
    r = pg.rect("#refb"); punto("ref", r[0] + r[2] / 2, r[1] + r[3] / 2)
    pg.clic(r[0] + r[2] / 2, r[1] + r[3] / 2); time.sleep(.2)
    estado(pg, 41.9, "f_ref")
    for t, n in [(42.5, 1), (43.1, 2), (43.7, 3), (44.3, 4)]:
        pg.js(f"(()=>{{window.__agenda={json.dumps(ev[:n])};window.__cb.onAgenda(window.__agenda)}})()"); time.sleep(.3)
        estado(pg, t, f"f_ev{n}")


def esc_ajustes():
    pg = Real("calendario.html", 520, 430)
    try:
        time.sleep(.8); estado(pg, 46.4, "g_ics")
    finally:
        pg.cerrar()


def escenas():
    ESTADOS.clear(); PUNTOS.clear()
    pg = Real("note.html", NW, NH, "?id=demo")
    try:
        esc_tareas(pg); esc_tabla(pg); esc_carpetas(pg); esc_calendario(pg)
    finally:
        pg.cerrar()
    pl = Real("lanzador.html", 470, 330)
    try:
        esc_lanzador(pl)
    finally:
        pl.cerrar()
    esc_ajustes()
    (SAL / "estados.json").write_text(json.dumps({"estados": ESTADOS, "puntos": PUNTOS}), encoding="utf-8")
    juntar()


def juntar():
    """Todas las capturas en un solo .js (data URI): el lienzo no queda «manchado» al leerlas. Se puede rehacer sin volver a capturar (--js)."""
    d = json.loads((SAL / "estados.json").read_text(encoding="utf-8")); est, pts = d["estados"], d["puntos"]
    datos = {n: "data:image/png;base64," + base64.b64encode((SAL / f"{n}.png").read_bytes()).decode() for n in sorted({n for _, n in est})}
    icono = "data:image/png;base64," + base64.b64encode((RAIZ / "assets" / "icon.png").read_bytes()).decode()
    (SAL / "capturas.js").write_text("const CAP = " + json.dumps({"estados": est, "puntos": pts, "img": datos, "icono": icono, "nota": [NW, NH], "lanz": [470, 330], "cfg": [520, 430]}) + ";", encoding="utf-8")
    print(f"OK {len(est)} estados, {sum(len(v) for v in datos.values()) / 1e6:.1f} MB")


def prueba():
    pg = Real("note.html", NW, NH, "?id=demo")
    try:
        pg.nota("<div><br></div>")
        pg.foto("prueba")
        print("ok", SAL / "prueba.png")
    finally:
        pg.cerrar()


if __name__ == "__main__":
    if "--prueba" in sys.argv:
        prueba()
    elif "--js" in sys.argv:
        juntar()
    else:
        escenas()
