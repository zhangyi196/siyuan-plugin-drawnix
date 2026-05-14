@echo off
setlocal
chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"
set "POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

"%POWERSHELL%" -Sta -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%build-plugin-ui.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Build failed. Press any key to exit.
  pause >nul
)

exit /b %EXIT_CODE%
