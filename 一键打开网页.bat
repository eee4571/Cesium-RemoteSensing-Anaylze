@echo off
setlocal

set "ROOT=%~dp0"
set "FRONTEND_URL=http://127.0.0.1:5173"

if not exist "%ROOT%backend\app\main.py" (
  echo Backend entry not found: %ROOT%backend\app\main.py
  pause
  exit /b 1
)

if not exist "%ROOT%frontend\package.json" (
  echo Frontend package not found: %ROOT%frontend\package.json
  pause
  exit /b 1
)

echo Starting backend on http://127.0.0.1:8000 ...
start "Remote Sensing Backend" /D "%ROOT%backend" cmd /k "python -m uvicorn app.main:app --reload --port 8000"

echo Starting frontend on %FRONTEND_URL% ...
start "Remote Sensing Frontend" /D "%ROOT%frontend" cmd /k "npm run dev"

echo Opening browser ...
timeout /t 3 /nobreak >nul
start "" "%FRONTEND_URL%"

echo.
echo Started. Keep the backend and frontend command windows open while using the webpage.
pause
