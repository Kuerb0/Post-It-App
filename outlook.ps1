# Lee el calendario del Outlook clásico que ya está abierto y lo escribe como JSON en la salida (lo llama eventos.js).
# Salida: {"ok":true,"categorias":{"Nombre":"#rrggbb"},"eventos":[{id,titulo,inicio,fin,todo_dia,color,categoria}]}
# Códigos de salida: 0 = leído · 3 = Outlook cerrado (no se abre solo) · 4 = Outlook no instalado / sin automatización · 5 = otro error
param([Parameter(Mandatory)][string]$Desde, [Parameter(Mandatory)][string]$Hasta)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

# enum OlCategoryColor (1..25), los mismos colores que usa el Calendario
$paleta = @{1='#e5533d';2='#f08c2e';3='#f4b183';4='#e0c341';5='#3fa34d';6='#2ec4a6';7='#8a9a3b';8='#3a86ff';9='#a06bff';10='#a04a5e';11='#8a8a90';12='#5a5a62';13='#9a9aa0';14='#6a6a70';15='#4a4a4e';16='#a83228';17='#c06a1e';18='#d09a6a';19='#b09a20';20='#2a7a34';21='#1e8a76';22='#6a7a2b';23='#2a5ecc';24='#7a4ac0';25='#7a3444'}

try { $ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') }
catch {
  if (-not (Test-Path 'Registry::HKEY_CLASSES_ROOT\Outlook.Application')) { exit 4 }
  exit 3
}
try {
  $ns = $ol.GetNamespace('MAPI')
  $d0 = [datetime]::ParseExact($Desde, 'yyyy-MM-dd', $null); $d1 = [datetime]::ParseExact($Hasta, 'yyyy-MM-dd', $null)
  $us = [Globalization.CultureInfo]::GetCultureInfo('en-US')
  $filtro = "[Start] < '" + $d1.ToString('MM/dd/yyyy hh:mm tt', $us) + "' AND [End] > '" + $d0.ToString('MM/dd/yyyy hh:mm tt', $us) + "'"
  $categorias = @{}; $eventos = New-Object Collections.Generic.List[object]; $vistos = @{}
  foreach ($st in $ns.Stores) {
    try { $cal = $st.GetDefaultFolder(9) } catch { continue }          # 9 = olFolderCalendar; hay almacenes sin calendario
    $col = @{}
    try { foreach ($c in $st.Categories) { $h = $paleta[[int]$c.Color]; if ($h) { $col[[string]$c.Name] = $h; $categorias[[string]$c.Name] = $h } } } catch { }
    $items = $cal.Items; $items.Sort('[Start]'); $items.IncludeRecurrences = $true
    foreach ($it in $items.Restrict($filtro)) {
      $ini = $it.Start; $fin = $it.End
      $id = ([string]$it.GlobalAppointmentID) + '@' + $ini.ToString('s')
      if ($vistos[$id]) { continue }; $vistos[$id] = 1
      $cat = ([string]$it.Categories -split '[;,]')[0].Trim(); $color = $null
      if ($cat -and $col[$cat]) { $color = $col[$cat] }
      $eventos.Add([ordered]@{ id = $id; titulo = [string]$it.Subject; inicio = $ini.ToString('s'); fin = $fin.ToString('s'); todo_dia = [bool]$it.AllDayEvent; color = $color; categoria = $cat })
    }
  }
  [ordered]@{ ok = $true; categorias = $categorias; eventos = $eventos } | ConvertTo-Json -Depth 5 -Compress
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 5 }
