@echo off
cd /d "%~dp0"
node control.mjs stop
docker compose -p qq-friend-windows stop
pause
