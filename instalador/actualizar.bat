@echo off
rem Actualiza el codigo de Post-its desde git y reinicia la app.
rem Tus notas (notes.json) no se tocan: estan fuera de git.
setlocal
for %%I in ("%~dp0..") do set "APP=%%~fI"
set "RT=%LOCALAPPDATA%\PostIt"
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $v='?'; try{ $v=(Get-Content -Raw -ErrorAction Stop -LiteralPath '%APP%\package.json' | ConvertFrom-Json).version }catch{}; $l=[IO.File]::ReadAllLines('%~f0',[Text.Encoding]::UTF8); $a=[Array]::IndexOf($l,':::BANNERSTART'); $b=[Array]::IndexOf($l,':::BANNEREND'); foreach($t in $l[($a+1)..($b-1)]){ $p=$t.Split([char]0xA7); Write-Host -NoNewline $p[0] -ForegroundColor DarkCyan; if($p.Length -gt 1){ Write-Host -NoNewline 'O' -ForegroundColor DarkYellow; Write-Host $p[1] -ForegroundColor DarkCyan } else { Write-Host '' } }; $a=[Array]::IndexOf($l,':::TITULOSTART'); $b=[Array]::IndexOf($l,':::TITULOEND'); $l[($a+1)..($b-1)] | ForEach-Object { Write-Host $_.Replace('@@VERSION@@',$v) -ForegroundColor White }"
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
exit /b 0

:::BANNERSTART
░▒▓█ ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════ █▓▒░
                                                              *#@@@@@@%#
                                                           *%%%%@@@@%%@%+#########
                                                         *#####%%%%+§+---+#%%@@@@@@@%#
                                                       *#####%%%@@#-+*+#%@@@@@@@@@@@@@%#
                                                      ##*##%##%%%@%*#%#*#%%%%%@@%####*
                                                     %##**#%%%%%%%%%%%*=*###%
                                                   #####**#%%%@@%%%%**#%%%%%
                                               *%@@%%###***##%%@%%%%%%%%%%#
                                            #@@@@@@@@@%%%%##**%#%%%%%%@@%%
                                         #%@@@@@@@@@@@@@@@%%%*##%%%%%%%%%%
                                      *%@@@@@@@@@@@###%%%%%%%##%%%@@%%%%%%#
                                    #@@@@%@%%@%%#*##%%%@%@@@@@%#%%@%%%#%%%
                                  #@@@@%%%#*****#%%@@@@@@@@@@@@##%%%#%#*%%
                                 %%@@%##***##%@@@@%@@@@@@@@@@@%%##%%##*#%
                              +#%%@%###%%%%@@@@@%@@%@@@@@@@@@##%%%%%%%##
                            *##**##%@%%@@@@@@@@@@@@@@@@%@@%%##%%%%%#####
                          ##**+#%@@%%%@@%%@%@@@@@%@%%%%@@@#*%%@%%#%%#%*
                        %###%@@@@%#%%%%%%%#%%#%%#%#*#%%%%*#%%%%@%%%%%
                     *%%%%@@@@%#*#######*##*****+++*#%%+*%%%@%%%#%##
                   *@@@@@@@@###@%@%%%%%%%#####*=*#%#%*+#%%#%%%%%##*
                  %@@@@@@%##%%@@@@@%%%%%%%%%%%#***++=#%%%#%%%###%+                                  ██╗  ██╗ ██╗   ██╗ ███████╗ ██████╗  ██████╗   ██████╗
                %%@@@@%###%@@@@@%#%%@@@@%%%%%#+--=+*#%@%%%%#**%%*                             #     ██║ ██╔╝ ██║   ██║ ██╔════╝ ██╔══██╗ ██╔══██╗ ██╔═████╗
               %@@@%#**%%%@@@%%##%#%@@%%%%#*==+*%%%%%%%%#*****#                             %@      █████╔╝  ██║   ██║ █████╗   ██████╔╝ ██████╔╝ ██║██╔██║
                ###*##%%@%%%%%%%#*#%%%%#+=-=+*#%####%%#+***+**                            #@@*      ██╔═██╗  ██║   ██║ ██╔══╝   ██╔══██╗ ██╔══██╗ ████╔╝██║
                #%%@@@@@@%@%%%#++=*++=====+==*******%**+++*#                             %@@%       ██║  ██╗ ╚██████╔╝ ███████╗ ██║  ██║ ██████╔╝ ╚██████╔╝
              #%%@@@@@@%%%%%*++***=-==++=++=*+=++***==+**#                              %@@#        ╚═╝  ╚═╝  ╚═════╝  ╚══════╝ ╚═╝  ╚═╝ ╚═════╝   ╚═════╝
            *@%@@@%@%%%%#++=**++==+==-=---=-===+=##**##                               #@@%
           %@@@@%%###*++*#+#*+*#+=*= *--====--=**%*                                 *%@@@           Without data, you’re just another person with an opinion
         %@@@@%#***+=*#%#*+**++*+     ***##**++#*                                 #@@@@@@%#%@@@@%
       %@@@%%##* **#%%@*+*+**+          *%%*   *%%*                          *#%@@@@@@@@@@@@####
     %@@@%%%*   #%%%@%*++**+              %%#    #%%#                  ##%@@@@@@@@@@##
   #@@@@%*     %%@%%#++*#*                 #@%     *%@@##  ##**+#@@@@@@@@@@@@@@@#
  #@@@#       %@@%%#+#%%*                   %@@####%%%%%%%%%%@%%@@@@@@@@@@@@@@@@
 %@%*        %@@#%#*%%%*                #%%%%#%@%@%@@@%%%%%@@@@%@@@####        #@%
##          @@%#%#*%%%                 **%%@@@%%%#@#%%@@%%####+**                #@%#
           @@%%#*#%%%                *%@@@@@@@@%%%@@%##                            #%%
         #@@%%**#%@#               #@@@@@@@@@@@%%%%@                                 #
        #@%%#*#%#%              *@@@@@@@@@@%#
       %@%%##%%%              *%@@@@@@@@%*
      %@%%%%%%               %@@@@@@@@@#
      @# ##                #@@@@@@@@@#
                         #@@@@@@@@@%
                        %@@@@@@@@@#
                       @@@@@@@@@@#
                      @@@@@@@@@@#
                     @@@@@@@@@@#
                    @@@@@@@@@@%
                   %@@@@@@@@@%
░▒▓█ ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════ █▓▒░
:::BANNEREND
:::TITULOSTART

                          █████╗   ██████╗ ████████╗ ██╗   ██╗  █████╗  ██╗      ██╗ ███████╗  █████╗  ██████╗   ██████╗  ██████╗
                         ██╔══██╗ ██╔════╝ ╚══██╔══╝ ██║   ██║ ██╔══██╗ ██║      ██║ ╚══███╔╝ ██╔══██╗ ██╔══██╗ ██╔═══██╗ ██╔══██╗
                         ███████║ ██║         ██║    ██║   ██║ ███████║ ██║      ██║   ███╔╝  ███████║ ██║  ██║ ██║   ██║ ██████╔╝
                         ██╔══██║ ██║         ██║    ██║   ██║ ██╔══██║ ██║      ██║  ███╔╝   ██╔══██║ ██║  ██║ ██║   ██║ ██╔══██╗
                         ██║  ██║ ╚██████╗    ██║    ╚██████╔╝ ██║  ██║ ███████╗ ██║ ███████╗ ██║  ██║ ██████╔╝ ╚██████╔╝ ██║  ██║
                         ╚═╝  ╚═╝  ╚═════╝    ╚═╝     ╚═════╝  ╚═╝  ╚═╝ ╚══════╝ ╚═╝ ╚══════╝ ╚═╝  ╚═╝ ╚═════╝   ╚═════╝  ╚═╝  ╚═╝

                                                ██████╗   ██████╗  ███████╗ ████████╗         ██╗ ████████╗
                                                ██╔══██╗ ██╔═══██╗ ██╔════╝ ╚══██╔══╝         ██║ ╚══██╔══╝
                                                ██████╔╝ ██║   ██║ ███████╗    ██║    █████╗  ██║    ██║
                                                ██╔═══╝  ██║   ██║ ╚════██║    ██║    ╚════╝  ██║    ██║
                                                ██║      ╚██████╔╝ ███████║    ██║            ██║    ██║
                                                ╚═╝       ╚═════╝  ╚══════╝    ╚═╝            ╚═╝    ╚═╝

                                                                    V E R S I Ó N   @@VERSION@@
:::TITULOEND
