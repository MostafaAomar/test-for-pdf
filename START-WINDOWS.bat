@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo لم يتم العثور على Node.js.
  echo ثبّت إصدار Node.js LTS من https://nodejs.org/ ثم شغّل هذا الملف مجددًا.
  pause
  exit /b 1
)
node server.mjs --open
pause
endlocal
