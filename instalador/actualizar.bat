@echo off
rem Actualiza el codigo de Post-its desde git y reinicia la app.
rem Tus notas (notes.json) no se tocan: estan fuera de git.
setlocal
for %%I in ("%~dp0..") do set "APP=%%~fI"
set "RT=%LOCALAPPDATA%\PostIt"
cd /d "%APP%"

git remote | findstr . >nul
if errorlevel 1 (
  echo No hay remoto git configurado. Anadelo con:
  echo    git remote add origin ^<url^>
  echo    git push -u origin master
  pause & exit /b 1
)

if not exist "%RT%\node_modules\electron\dist\electron.exe" (
  echo Post-its no esta instalado en este equipo. Ejecuta antes instalar.bat
  pause & exit /b 1
)

rem cierra solo NUESTRO electron, no otras apps hechas con Electron
powershell -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | Where-Object Path -like '*\PostIt\*' | Stop-Process -Force"

git pull --ff-only
if errorlevel 1 (
  echo Error al hacer git pull ^(cambios locales sin guardar o ramas divergentes^).
  start "" "%RT%\node_modules\electron\dist\electron.exe" "%APP%"
  pause & exit /b 1
)

start "" "%RT%\node_modules\electron\dist\electron.exe" "%APP%"
echo.
echo Actualizado y reiniciado.
pause
