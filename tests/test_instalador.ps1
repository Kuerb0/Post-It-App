# powershell -NoProfile -ExecutionPolicy Bypass -File tests\test_instalador.ps1   ·   debe terminar en «TEST OK»
# Recorre los caminos del asistente que ya fallaron: instalar, ACTUALIZAR encima (las opciones no se pierden), carpeta en la raiz de una unidad,
# acceso roto de una version anterior y las dos erratas de PowerShell (Create(... -replace ...) y $o/$O). Todo en carpetas temporales: no toca tu instalacion.
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $raiz 'package.json') -Raw | ConvertFrom-Json).version
$bat = Join-Path $raiz "instaladores\Post-It $version - Instalador.bat"
if (-not (Test-Path $bat)) { throw "Falta ${bat}: ejecuta antes herramientas\generar_instaladores.py" }
function Comprobar($ok, $texto) { if (-not $ok) { throw "FALLA: $texto" }; "  ok  $texto" }

# --- 1. erratas de PowerShell en la plantilla
$plantilla = Get-Content (Join-Path $raiz 'herramientas\plantillas\instalador.ps1.txt') -Raw -Encoding UTF8
Comprobar ($plantilla -notmatch 'Create\(\$\w+ -replace') 'ningun Create($x -replace ...) sin parentesis (se lee como dos argumentos)'
Comprobar ($plantilla -cnotmatch '\$o\s*=|foreach\s*\(\$o\s') 'ninguna variable $o en minuscula ($o y $O son la misma: pisaba las opciones)'

# --- 2. instalar y actualizar encima, en silencio, con APPDATA aparte
$t = Join-Path $env:TEMP ('postit-test-instalador-' + [guid]::NewGuid().ToString().Substring(0, 6)); New-Item -ItemType Directory "$t\appdata" -Force | Out-Null
$real = $env:APPDATA; $env:APPDATA = "$t\appdata"
try {
    foreach ($vez in 1, 2) {
        Remove-Item "$t\appdata\post-it" -Recurse -Force -ErrorAction SilentlyContinue
        $sal = (& cmd /c "`"$bat`" -Silencioso -Destino `"$t\prog`" -SyncDir `"$t\Carpeta de Sincronizaci$([char]243)n`" -Ics https://ejemplo.invalid/c.ics -SinAccesos" 2>&1) -join "`n"
        $cfg = Get-Content "$t\appdata\post-it\sync.json" -Raw -Encoding UTF8 | ConvertFrom-Json
        $que = if ($vez -eq 1) { 'instalacion nueva' } else { 'ACTUALIZACION sobre la anterior' }
        Comprobar ($vez -eq 1 -or (Test-Path "$t\prog\anteriores")) "$que`: la copia de la version anterior existe"
        Comprobar ($cfg.sync -like '*Sincronizaci*n') "$que`: la carpeta de sincronizacion llega (con tilde y espacios)"
        Comprobar ($cfg.ics -eq 'https://ejemplo.invalid/c.ics') "$que`: el enlace ICS llega"
    }
    Comprobar (Test-Path "$t\prog\main.js") 'el programa esta en la carpeta de instalacion'

    # --- 3. la raiz de una unidad se convierte en subcarpeta (se prueba la funcion, no se instala en D:\)
    $ps1 = Join-Path $t 'asistente.ps1'
    $gen = Join-Path $raiz 'herramientas'
    & python -c "import sys; sys.path.insert(0, r'$gen'); import generar_instaladores as g; open(r'$ps1','w',encoding='utf-8-sig').write('\n'.join(g.asistente('$version')))"
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($ps1, [ref]$null, [ref]$null)
    $App = @{ Nombre = 'Post-It' }
    $fn = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Normalizar-Destino' }, $true)[0]
    . ([scriptblock]::Create($fn.Extent.Text))
    Comprobar ((Normalizar-Destino 'D:\') -eq 'D:\Post-It') 'D:\ -> D:\Post-It'
    Comprobar ((Normalizar-Destino '\\servidor\recurso') -eq '\\servidor\recurso\Post-It') 'un recurso de red -> subcarpeta'
    Comprobar ((Normalizar-Destino 'D:\Programas\PostIt') -eq 'D:\Programas\PostIt') 'una subcarpeta se respeta'
} finally { $env:APPDATA = $real }
"TEST OK"
