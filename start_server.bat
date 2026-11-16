@echo off
cd /d "%~dp0"
echo Starting AqroVision Backend & Dashboard on http://127.0.0.1:8000 ...
python server.py
pause
