"""Genera el instalador de Post-It (asistente de Windows + .exe) a partir del codigo de la app.

Uso (desde cualquier sitio):

    python herramientas/generar_instaladores.py

Escribe en instaladores/:

    Post-It <version> - Instalador.bat
    Post-It <version> - Instalador.exe    (el mismo instalador, con el icono de la app y sin consola)

Lleva dentro main.js, sync.js, note.html, lanzador.html, preload.js, package.json y assets/. Electron (el motor de la app) no va dentro: el asistente lo
descarga de la publicacion oficial y comprueba su SHA-256. Nunca empaqueta notes.json: tus notas se quedan donde estan.
El actualizador (instalador/actualizar.bat) sigue usando git.
"""
import base64
import hashlib
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLANTILLAS = os.path.join(RAIZ, "herramientas", "plantillas")
SALIDA = os.path.join(RAIZ, "instaladores")

# ruta relativa a la carpeta principal -> modo ("text" o "b64")
ARCHIVOS = [
    ("main.js", "text"),
    ("sync.js", "text"),
    ("note.html", "text"),
    ("lanzador.html", "text"),
    ("preload.js", "text"),
    ("package.json", "text"),
    ("assets/icon.ico", "b64"),
    ("assets/icon.png", "b64"),
]

# datos del asistente de instalacion (plantillas/instalador.ps1.txt)
ASISTENTE = {
    "NOMBRE": "Post-It",
    "TIPO": "electron",
    "ELECTRON_VERSION": "44.7.2",                          # la que ya usa la app
    "ELECTRON_ANTIGUO": r"PostIt\node_modules\electron\dist\electron.exe",   # instalacion antigua con npm: se reutiliza si esta
    "SIN_ARRANQUE": "1",                                    # la propia app se registra para arrancar con Windows
    "COMPRUEBA": "main.js", "LANZADOR": ".", "ICONO": r"assets\icon.ico",
    "DATOS": "notes.json",
    "PROGRAMA": ["main.js", "sync.js", "note.html", "lanzador.html", "preload.js", "package.json", "assets"],
    "VERSION_FILE": "package.json", "VERSION_RE": r'"version"\s*:\s*"([^"]+)"',
    "PORTAL_PREFIJO": "Post-It", "ICONO_PNG": "assets/icon.png",
}

PLANTILLAS_BAT = [
    ("instalador.bat.txt", "Post-It {v} - Instalador.bat", "titulo_instalador.txt"),
]


def leer_bytes(rel):
    with open(os.path.join(RAIZ, *rel.split("/")), "rb") as f:
        return f.read()


def lineas_de_texto(rel):
    texto = leer_bytes(rel).decode("utf-8-sig")
    return texto.replace("\r\n", "\n").replace("\r", "\n").rstrip("\n").split("\n")


def version_del_programa():
    import json
    return json.loads(leer_bytes("package.json").decode("utf-8-sig"))["version"]


def sha256_de(rel, modo):
    """SHA-256 de lo que acaba en disco al extraer (el texto con CRLF, o los bytes tal cual); el asistente lo comprueba."""
    if modo == "b64":
        datos = leer_bytes(rel)
    else:
        datos = ("\r\n".join(lineas_de_texto(rel)) + "\r\n").encode("utf-8")
    return hashlib.sha256(datos).hexdigest()


def bloque(rel, modo):
    """Las lineas de un fichero dentro del .bat."""
    salida = [f":::BEGIN {rel}|{modo}|{sha256_de(rel, modo)}"]
    if modo == "b64":
        b64 = base64.b64encode(leer_bytes(rel)).decode("ascii")
        salida += [b64[i:i + 76] for i in range(0, len(b64), 76)]
    else:
        for linea in lineas_de_texto(rel):
            if linea.startswith(":::"):
                sys.exit(f"{rel}: una linea empieza por ':::' y rompe el empaquetado")
            salida.append(linea)
    salida.append(":::END")
    return salida


def carga_util():
    lineas = []
    for rel, modo in ARCHIVOS:
        lineas += bloque(rel, modo)
    return lineas


def extraer(contenido):
    """Misma logica que el extractor de PowerShell del .bat (para comprobar)."""
    lineas = contenido.decode("utf-8").replace("\r\n", "\n").split("\n")
    salida, i = {}, 0
    while i < len(lineas):
        if lineas[i].startswith(":::BEGIN "):
            rel, modo = lineas[i][9:].strip().split("|")[:2]
            j, buf = i + 1, []
            while j < len(lineas) and not lineas[j].startswith(":::END"):
                buf.append(lineas[j])
                j += 1
            if modo == "b64":
                salida[rel] = base64.b64decode("".join(buf))
            else:
                salida[rel] = ("\r\n".join(buf) + "\r\n").encode("utf-8")
            i = j
        i += 1
    return salida


def nombre_png(nombre):
    """El nombre del programa en letras grandes (las de crear_banner.py) como PNG en base64, para la cabecera de la ventana."""
    import io
    from PIL import Image, ImageDraw, ImageFont
    sys.path.insert(0, os.path.join(RAIZ, "herramientas"))
    import crear_banner
    lineas = crear_banner.grande(nombre)
    fuente = ImageFont.truetype(r"C:\Windows\Fonts\consola.ttf", 15)       # Consolas dibuja los caracteres de caja sin huecos
    ascenso, descenso = fuente.getmetrics()
    alto_linea = ascenso + descenso
    ancho = int(max(fuente.getlength(l) for l in lineas)) + 2
    imagen = Image.new("RGBA", (ancho, alto_linea * len(lineas)), (0, 0, 0, 0))
    dibujo = ImageDraw.Draw(imagen)
    for i, linea in enumerate(lineas):
        dibujo.text((0, i * alto_linea), linea, font=fuente, fill=(46, 196, 182, 255))
    if imagen.width > 520:      # los nombres largos se reducen para que quepan junto al cuervo
        imagen = imagen.resize((520, round(imagen.height * 520 / imagen.width)), Image.LANCZOS)
    salida = io.BytesIO()
    imagen.save(salida, "PNG", optimize=True)
    return base64.b64encode(salida.getvalue()).decode("ascii")


def carpeta_ico(rel_png):
    """carpeta.ico: el icono de la app con una carpeta amarilla pequena abajo a la derecha (en base64)."""
    import io
    from PIL import Image, ImageDraw
    origen = Image.open(os.path.join(RAIZ, *rel_png.split("/")))
    if rel_png.lower().endswith(".ico"):
        origen.size = max(origen.info["sizes"])      # el tamano mas grande del .ico
    base = origen.convert("RGBA").resize((1024, 1024), Image.LANCZOS)
    d, k = ImageDraw.Draw(base), 4              # medidas sobre 256 px, como el resto de carpetas de proyecto
    d.rounded_rectangle([125 * k, 128 * k, 182 * k, 160 * k], 8 * k, fill=(226, 165, 28, 255))     # pestana
    d.rounded_rectangle([125 * k, 146 * k, 248 * k, 200 * k], 8 * k, fill=(236, 178, 36, 255))     # fondo
    d.rounded_rectangle([125 * k, 165 * k, 248 * k, 240 * k], 10 * k, fill=(251, 205, 70, 255))    # frente
    salida = io.BytesIO()
    base.resize((256, 256), Image.LANCZOS).save(salida, "ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    return base64.b64encode(salida.getvalue()).decode("ascii")


def construir_exe(contenido_bat, version, destino):
    """El instalador como .exe: un lanzador en C# (compilado con el csc.exe de Windows) que lleva el .bat comprimido dentro,
    con el icono de la app y sin consola. Devuelve False si no hay compilador."""
    import glob
    import gzip
    import subprocess
    import tempfile
    candidatos = glob.glob(r"C:\Windows\Microsoft.NET\Framework64\v4*\csc.exe") + glob.glob(r"C:\Windows\Microsoft.NET\Framework\v4*\csc.exe")
    if not candidatos:
        print("AVISO  no hay csc.exe (.NET Framework 4): no se genera el .exe")
        return False
    with open(os.path.join(PLANTILLAS, "instalador_stub.cs.txt"), encoding="utf-8") as f:
        fuente = f.read()
    numerica = ".".join((re.findall(r"\d+", version) + ["0", "0", "0", "0"])[:4])
    for clave, valor in (("NOMBRE", ASISTENTE["NOMBRE"]), ("VERSION", version), ("VERSION_NUM", numerica), ("PREFIJO", ASISTENTE["NOMBRE"].lower())):
        fuente = fuente.replace("@@" + clave + "@@", valor)
    with tempfile.TemporaryDirectory() as tmp:
        cs, gz = os.path.join(tmp, "instalador.cs"), os.path.join(tmp, "paquete.gz")
        with open(cs, "w", encoding="utf-8-sig") as f:
            f.write(fuente)
        with open(gz, "wb") as f:
            f.write(gzip.compress(contenido_bat, 9, mtime=0))
        ico = os.path.join(RAIZ, *ASISTENTE["ICONO"].split("\\"))
        r = subprocess.run([candidatos[0], "/nologo", "/target:winexe", "/optimize+", f"/out:{destino}", f"/win32icon:{ico}",
                            f"/resource:{gz},paquete.gz", "/r:System.dll", "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", cs], capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit("Fallo compilando el .exe:\n" + r.stdout + r.stderr)
    return True


def cuervo_png(altura=180):
    """El cuervo del banner (plantillas/cuervo.txt; la § es el ojo, dorado) como PNG en base64, redimensionado a esta altura."""
    import io
    from PIL import Image, ImageDraw, ImageFont
    with open(os.path.join(PLANTILLAS, "cuervo.txt"), encoding="utf-8") as f:
        lineas = f.read().rstrip("\n").split("\n")
    fuente = ImageFont.truetype(r"C:\Windows\Fonts\consolab.ttf", 16)
    ascenso, descenso = fuente.getmetrics()
    alto_linea, ancho_car = ascenso + descenso, fuente.getlength("#")
    ancho = int(max(len(l) for l in lineas) * ancho_car) + 4
    capas = {}                      # una mascara por color: cuerpo e ojo
    for nombre in ("cuerpo", "ojo"):
        capas[nombre] = Image.new("L", (ancho, alto_linea * len(lineas)), 0)
    for i, linea in enumerate(lineas):
        izq, ojo, der = linea.partition("§")
        d = ImageDraw.Draw(capas["cuerpo"])
        d.text((0, i * alto_linea), izq, font=fuente, fill=255)
        d.text(((len(izq) + 1) * ancho_car, i * alto_linea), der, font=fuente, fill=255)
        if ojo:
            ImageDraw.Draw(capas["ojo"]).text((len(izq) * ancho_car, i * alto_linea), "O", font=fuente, fill=255)
    ancho_final = round(ancho * altura / (alto_linea * len(lineas)))
    imagen = Image.new("RGB", (ancho_final, altura), (11, 15, 20))
    for nombre, color in (("cuerpo", (46, 196, 182)), ("ojo", (224, 165, 38))):
        # al reducir, los trazos finos se apagan: se les sube el brillo para que el cuervo se vea
        mascara = capas[nombre].resize((ancho_final, altura), Image.LANCZOS).point(lambda v: min(255, int(v * 2.6)))
        imagen.paste(color, (0, 0), mascara)
    salida = io.BytesIO()
    imagen.save(salida, "PNG", optimize=True)
    return base64.b64encode(salida.getvalue()).decode("ascii")


# lo que no se indica en ASISTENTE (cada app puede cambiarlo)
DEFECTOS = {"VERSION_RE": "", "PY_MIN": "3.10", "PY_IMPORT": "", "PIP_POST": "", "PRIMERA_VEZ": "", "PRIMERA_SENAL": "",
            "PIP_EXTRA": "", "EXTRA_IMPORT": "", "IMPORTS": "", "REQS": "", "CARPETAS": [], "DATOS": "",
            "PORTAL_URL": "https://kuerb0.github.io/portal/webs.json",
            "TIPO": "python", "ELECTRON_VERSION": "", "ELECTRON_ANTIGUO": "", "SIN_ARRANQUE": ""}


def asistente(version):
    """El script de PowerShell del asistente, con los datos de ASISTENTE y el titulo grande."""
    with open(os.path.join(PLANTILLAS, "instalador.ps1.txt"), encoding="utf-8") as f:
        texto = f.read().replace("\r\n", "\n")
    lista = lambda v: ", ".join("'" + x + "'" for x in v)
    datos = dict({**DEFECTOS, **ASISTENTE}, VERSION=version, NOMBRE_PNG=nombre_png(ASISTENTE["NOMBRE"]), CUERVO_PNG=cuervo_png(), CARPETA_ICO=carpeta_ico(ASISTENTE["ICONO_PNG"]), CARPETAS=lista(ASISTENTE.get("CARPETAS", [])), PROGRAMA=lista(ASISTENTE["PROGRAMA"]))
    for clave, valor in datos.items():
        if clave not in ("CARPETAS", "PROGRAMA"):
            valor = valor.replace("'", "''")      # van dentro de comillas simples de PowerShell
        texto = texto.replace("@@" + clave + "@@", valor)
    sobran = re.findall(r"@@[A-Z_]+@@", texto)
    assert not sobran, f"quedan marcas sin sustituir en instalador.ps1.txt: {sobran}"
    return texto.rstrip("\n").split("\n")


def main():
    version = version_del_programa()
    os.makedirs(SALIDA, exist_ok=True)
    carga = carga_util()

    def leer_plantilla(nombre):
        with open(os.path.join(PLANTILLAS, nombre), encoding="utf-8") as f:
            return f.read().rstrip("\n").split("\n")

    for plantilla, nombre, titulo_txt in PLANTILLAS_BAT:
        # PowerShell imprime el banner (aguamarina) y el titulo (blanco) desde estos bloques;
        # los crea herramientas/crear_banner.py
        banner = ([":::BANNERSTART"] + leer_plantilla("banner.txt") + [":::BANNEREND"]
                  + [":::TITULOSTART"]
                  + [l.replace("@@VERSION@@", version) for l in leer_plantilla(titulo_txt)]
                  + [":::TITULOEND"])
        with open(os.path.join(PLANTILLAS, plantilla), encoding="utf-8") as f:
            texto = f.read().replace("\r\n", "\n")
        assert "@@PAYLOAD@@" in texto and "@@BANNER@@" in texto, plantilla
        lineas = texto.replace("@@VERSION@@", version).replace("@@NOMBRE@@", ASISTENTE["NOMBRE"]).replace("@@PREFIJO@@", ASISTENTE["NOMBRE"].lower()).split("\n")
        completo = []
        for linea in lineas:
            if linea.strip() == "@@WIZARD@@":
                completo += asistente(version)
            elif linea.strip() == "@@PAYLOAD@@":
                completo += carga
            elif linea.strip() == "@@BANNER@@":
                completo += banner
            else:
                completo.append(linea)
        contenido = ("\r\n".join(completo).rstrip("\r\n") + "\r\n").encode("utf-8")

        # comprobacion: lo que sale al extraer == lo que hay en py/ y assets/
        sacado = extraer(contenido)
        for rel, modo in ARCHIVOS:
            esperado = leer_bytes(rel)
            if modo == "text":
                esperado = ("\r\n".join(lineas_de_texto(rel)) + "\r\n").encode("utf-8")
            if sacado.get(rel) != esperado:
                sys.exit(f"{nombre}: {rel} no sale igual al extraerlo")

        destino = os.path.join(SALIDA, nombre.format(v=version))
        with open(destino, "wb") as f:
            f.write(contenido)
        print(f"OK  {os.path.relpath(destino, RAIZ)}  ({len(contenido) // 1024} KB)")
        if plantilla == "instalador.bat.txt":      # el instalador tambien como .exe (el actualizador se queda en .bat)
            exe = destino[:-4] + ".exe"
            if construir_exe(contenido, version, exe):
                print(f"OK  {os.path.relpath(exe, RAIZ)}  ({os.path.getsize(exe) // 1024} KB)")


if __name__ == "__main__":
    main()
