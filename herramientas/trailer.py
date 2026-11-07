"""Graba el tráiler de Post-It (1920×1080, 30 fps): abre trailer.html en Edge sin ventana, lo avanza fotograma a fotograma por el protocolo
de depuración (así no se pierde ningún cuadro) y compone el MP4 con una música generada, en trailer/ (ignorado por git).
La página dibuja el post-it con los colores y los menús de la app y datos de ejemplo: nada de lo que sale es de nadie.

    python herramientas/trailer.py            # graba y compone (1-2 minutos)
    python herramientas/trailer.py --vista    # una captura por escena en trailer/vista/ para revisar el guion
    python herramientas/trailer.py --musica   # solo recompone el audio sobre el último vídeo sin música

Necesita: pip install websocket-client imageio-ffmpeg pillow numpy   (ffmpeg lo trae imageio-ffmpeg) y Edge instalado.
"""
import argparse
import base64
import io
import json
import math
import subprocess
import sys
import tempfile
import time
import urllib.request
import wave
from pathlib import Path

import numpy as np
import websocket
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")
AQUI = Path(__file__).resolve().parent
SALIDA = AQUI.parent / "trailer"
ANCHO, ALTO, FPS, PUERTO_CDP = 1920, 1080, 30, 9229
EDGE = next((p for p in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", r"C:\Program Files\Microsoft\Edge\Application\msedge.exe") if Path(p).exists()), "msedge")
ESCENAS = {"intro": 2.3, "nota": 4.4, "tareas": 9.3, "hecha": 11.0, "seleccion": 12.6, "menu": 14.2, "color": 16.9, "complementario": 19.6, "tabla": 25.9, "pasadas": 27.5, "ajustes": 28.5, "carpetas": 31.5, "ordenadas": 35.4, "lanzador": 39.0, "calendario": 45.0, "ics": 48.0, "titulo": 54.0}


class Pagina:
    """Edge sin ventana con el protocolo de depuración y trailer.html?video abierto."""

    def __init__(self, url=None, ancho=ANCHO, alto=ALTO, dsf=1, esperar="window.__listo || ''", puerto=PUERTO_CDP):
        PUERTO_CDP = puerto
        self.perfil = tempfile.mkdtemp(prefix="postit_edge_")
        self.edge = subprocess.Popen([EDGE, "--headless=new", "--disable-gpu", f"--remote-debugging-port={PUERTO_CDP}", f"--user-data-dir={self.perfil}",
                                      "--no-first-run", "--remote-allow-origins=*", "--hide-scrollbars", "--allow-file-access-from-files", "about:blank"],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        destino = None
        for _ in range(60):
            try:
                destino = next(t for t in json.load(urllib.request.urlopen(f"http://127.0.0.1:{PUERTO_CDP}/json")) if t["type"] == "page")
                break
            except Exception:
                time.sleep(0.5)
        self.ws = websocket.create_connection(destino["webSocketDebuggerUrl"], max_size=None, timeout=120)
        self.n = 0
        self.cmd("Emulation.setDeviceMetricsOverride", width=ancho, height=alto, deviceScaleFactor=dsf, mobile=False)
        self.cmd("Page.navigate", url=url or ((AQUI / "trailer.html").as_uri() + "?video"))
        for _ in range(120):
            if esperar is None:
                if self.js("document.readyState") == "complete":
                    break
            elif self.js(esperar, espera=True) is True:
                break
            time.sleep(0.5)
        time.sleep(0.5)

    def cmd(self, metodo, **p):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": metodo, "params": p}))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == self.n:
                if "error" in r:
                    raise RuntimeError(r["error"])
                return r.get("result", {})

    def js(self, expr, espera=False):
        r = self.cmd("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=espera)
        if "exceptionDetails" in r:
            raise RuntimeError(r["exceptionDetails"])
        return r.get("result", {}).get("value")

    def fotograma(self, t):
        return base64.b64decode(self.js(f"window.__frame({t})"))

    def cerrar(self):
        self.edge.terminate()


def U(t):
    """Del tiempo del guion al de la película: todo un 15 % más lento y la escena del menú de formato (11,9–20,7 s) un 60 % más larga (igual que aU en trailer.html)."""
    return 1.15 * (t + 0.6 * (min(max(t, 11.9), 20.7) - 11.9))


def musica(segundos, ruta):
    """Una base ambiental generada con numpy (acordes en re menor, arpegio suave y eco) más unos efectos suaves que siguen el guion: no lleva derechos de nadie."""
    sr = 44100; n = int(segundos * sr); t = np.arange(n) / sr; bpm = 96; beat = 60 / bpm
    acordes = [(146.83, 220.0, 293.66, 349.23), (116.54, 174.61, 233.08, 293.66), (174.61, 261.63, 349.23, 440.0), (130.81, 196.0, 261.63, 329.63)]
    izq, der = np.zeros(n), np.zeros(n); largo = 8 * beat
    for k in range(int(segundos / largo) + 2):
        i0 = int(k * largo * sr); i1 = min(n, int((k + 1) * largo * sr + 1.5 * sr))
        if i0 >= n:
            break
        tt = t[i0:i1] - k * largo; env = np.minimum(1, tt / 1.4) * np.exp(-np.maximum(0, tt - largo) * 2.2); ch = acordes[k % 4]
        for j, f in enumerate(ch):
            for desafine, canal in ((0.997, izq), (1.003, der)):
                canal[i0:i1] += 0.07 * env * (np.sin(2 * np.pi * f * desafine * tt) + 0.35 * np.sin(2 * np.pi * 2 * f * desafine * tt + j))
        for s in range(16):                                           # arpegio de corcheas
            ini = k * largo + s * beat / 2
            if ini * sr >= n:
                break
            nota = ch[(0, 2, 3, 2, 1, 3, 2, 3)[s % 8]] * 2; a0 = int(ini * sr); a1 = min(n, a0 + int(1.6 * sr)); ta = np.arange(a1 - a0) / sr
            pluck = np.sin(2 * np.pi * nota * ta) * np.exp(-ta * 5.5) * 0.11 * (0.7 + 0.3 * math.sin(s)); pan = 0.5 + 0.35 * math.sin(s * 1.7)
            izq[a0:a1] += pluck * (1 - pan); der[a0:a1] += pluck * pan
    rng = np.random.default_rng(7)

    def sonido(ini, onda, ganancia=1.0):
        a0 = int(U(ini) * sr)
        if 0 <= a0 < n:
            a1 = min(n, a0 + len(onda)); izq[a0:a1] += onda[:a1 - a0] * ganancia; der[a0:a1] += onda[:a1 - a0] * ganancia

    def ping(f, dur=0.9):
        tp = np.arange(int(dur * sr)) / sr
        return np.sin(2 * np.pi * f * tp) * np.exp(-tp * 4.5) * 0.2 + np.sin(2 * np.pi * 2 * f * tp) * np.exp(-tp * 8) * 0.05

    def whoosh(dur, f0, f1):                                          # ruido filtrado que sube o baja: la tarjeta baja o se abre
        tp = np.arange(int(dur * sr)) / sr; ruido = rng.standard_normal(len(tp))
        fc = np.linspace(f0, f1, len(tp)); lp = np.zeros(len(tp)); a = 0.0
        for i in range(len(tp)):
            a += min(1.0, 2 * np.pi * fc[i] / sr) * (ruido[i] - a); lp[i] = a
        return lp * np.sin(np.pi * np.linspace(0, 1, len(tp))) ** 1.5 * 0.55

    sonido(3.2, whoosh(0.85, 250, 2600), 0.8)                          # la nota cae al escritorio
    for tt, f in ((5.5, 523.25), (7.1, 659.25), (8.7, 783.99)):        # cada tarea nueva
        sonido(tt, ping(f, 0.6), 0.8)
    sonido(10.0, ping(1046.5, 0.5), 0.9)                               # Ctrl+Enter: tarea hecha
    for tt in (13.2, 15.5, 17.7):                                      # clic derecho: el menú
        sonido(tt, ping(700, 0.18), 0.6)
    for tt in (14.6, 16.6, 18.9):                                      # elegir formato / color
        sonido(tt, ping(1200, 0.12), 0.7)
    sonido(18.9, ping(587.33, 1.2), 0.7)                               # el complementario: un acorde suave
    sonido(21.0, whoosh(0.7, 300, 2200), 0.6)                          # la tabla
    for tt in (22.2, 23.0, 23.8, 24.6, 25.4):
        sonido(tt, ping(440 + 40 * ((tt * 5) % 4), 0.4), 0.55)
    sonido(30.7, ping(1200, 0.12), 0.7); sonido(33.0, whoosh(0.9, 400, 1800), 0.7)   # abrir carpeta y ordenarlas
    sonido(36.6, whoosh(0.7, 300, 2200), 0.8); sonido(40.0, ping(1200, 0.12), 0.7)    # el lanzador y la nota elegida
    sonido(41.9, ping(880, 0.5), 0.6); sonido(46.2, whoosh(0.7, 300, 2200), 0.5)
    for tt in (42.3, 42.9, 43.5, 44.1):                                # los eventos del calendario
        sonido(tt, ping(659.25, 0.35), 0.5)
    for tt, f in ((51.5, 293.66), (51.5, 440.0), (51.5, 587.33), (51.55, 698.46)):
        sonido(tt, ping(f, 3.2), 0.9)                                  # el acorde del título
    for canal, retardo in ((izq, 0.31), (der, 0.43)):                  # eco
        d = int(retardo * sr); eco = np.zeros_like(canal); eco[d:] = canal[:-d] * 0.4; canal += eco
        eco2 = np.zeros_like(canal); eco2[2 * d:] = canal[:-2 * d] * 0.16; canal += eco2
    fade = np.minimum(1, t / 1.5) * np.minimum(1, (segundos - t) / 3.0); est = np.stack([izq * fade, der * fade], 1); est *= 0.62 / max(np.abs(est).max(), 1e-9)
    with wave.open(str(ruta), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes((est * 32767).astype("<i2").tobytes())


def vista(pg):
    carpeta = SALIDA / "vista"; carpeta.mkdir(parents=True, exist_ok=True)
    for nombre, t in ESCENAS.items():
        (carpeta / f"{nombre}.jpg").write_bytes(pg.fotograma(U(t))); print("vista", nombre)


def con_musica(sin, con, segundos):
    import imageio_ffmpeg
    wav = Path(tempfile.gettempdir()) / "postit_musica.wav"; musica(segundos, wav)
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-i", str(sin), "-i", str(wav), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", str(con)], check=True)
    print(f"OK {con.relative_to(AQUI.parent)}  ({segundos:.0f} s, {con.stat().st_size / 1e6:.1f} MB)")


def grabar():
    import imageio_ffmpeg
    SALIDA.mkdir(exist_ok=True); sin = SALIDA / "Post-It - Trailer (sin musica).mp4"; con = SALIDA / "Post-It - Trailer.mp4"
    pg = Pagina()
    try:
        total = int(pg.js("window.__duracion") * FPS)
        escritor = imageio_ffmpeg.write_frames(str(sin), (ANCHO, ALTO), fps=FPS, codec="libx264", pix_fmt_in="rgb24", pix_fmt_out="yuv420p", quality=None,
                                               macro_block_size=1, output_params=["-crf", "17", "-preset", "medium", "-movflags", "+faststart"])
        escritor.send(None)
        for i in range(total):
            escritor.send(np.asarray(Image.open(io.BytesIO(pg.fotograma(i / FPS))).convert("RGB"), dtype=np.uint8).tobytes())
            if i % 90 == 0:
                print(f"{i / FPS:.0f} s de {total / FPS:.0f}")
        escritor.close()
    finally:
        pg.cerrar()
    con_musica(sin, con, total / FPS)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--vista", action="store_true"); ap.add_argument("--musica", action="store_true"); a = ap.parse_args()
    if a.musica:
        con_musica(SALIDA / "Post-It - Trailer (sin musica).mp4", SALIDA / "Post-It - Trailer.mp4", U(54.6))
    elif a.vista:
        pg = Pagina()
        try:
            vista(pg)
        finally:
            pg.cerrar()
    else:
        grabar()
