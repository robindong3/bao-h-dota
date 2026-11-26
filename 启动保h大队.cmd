@echo off
cd /d "%~dp0"
set DOTA_LOCAL_CODEX=1
where py >nul 2>nul
if errorlevel 1 (
  python server.py
) else (
  py -3 server.py
)
pause
