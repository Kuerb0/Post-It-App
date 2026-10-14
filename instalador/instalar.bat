@echo off
rem Instala Post-its en este equipo. Ejecutar una vez por equipo.
rem Electron va en %LOCALAPPDATA%\PostIt (fuera de OneDrive, pesa ~300 MB).
rem La app se registra sola para iniciar con Windows la primera vez que arranca.
setlocal
for %%I in ("%~dp0..") do set "APP=%%~fI"
set "RT=%LOCALAPPDATA%\PostIt"

where npm >nul 2>&1
if errorlevel 1 (
  echo Falta Node.js. Instalalo desde https://nodejs.org y vuelve a ejecutar.
  pause & exit /b 1
)

if not exist "%RT%" mkdir "%RT%"
pushd "%RT%"
if not exist package.json call npm init -y >nul
call npm install electron
if errorlevel 1 (
  echo Error instalando Electron.
  popd & pause & exit /b 1
)
rem a veces npm no ejecuta el postinstall que descarga el binario
if not exist node_modules\electron\dist\electron.exe node node_modules\electron\install.js
popd

rem acceso directo en el escritorio (GetFolderPath respeta el escritorio redirigido a OneDrive)
powershell -NoProfile -Command "$q=[char]34; $s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Post-its.lnk'); $s.TargetPath=$env:RT+'\node_modules\electron\dist\electron.exe'; $s.Arguments=$q+$env:APP+$q; $s.WorkingDirectory=$env:APP; $s.IconLocation=$env:APP+'\assets\icon.ico'; $s.Description='Post-its'; $s.Save()"

start "" "%RT%\node_modules\electron\dist\electron.exe" "%APP%"
echo.
echo Listo: Post-its iniciado, con acceso directo en el escritorio y arranque con Windows.
pause
