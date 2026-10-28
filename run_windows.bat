@echo off
setlocal
cd /d "%~dp0"
where g++ >nul 2>nul
if errorlevel 1 (
  echo C++ compiler g++ was not found.
  echo Install MinGW-w64 or MSYS2 with g++, then reopen this terminal.
  pause
  exit /b 1
)
echo Building the C++ dashboard server...
g++ -std=c++17 -O2 main.cpp -o deadlock_server.exe -lws2_32
if errorlevel 1 (
  echo Build failed. Review the compiler messages above.
  pause
  exit /b 1
)
echo.
echo Starting dashboard at http://127.0.0.1:8080
echo Keep this window open while using the dashboard.
start "Deadlock Dashboard" http://127.0.0.1:8080
deadlock_server.exe
pause
