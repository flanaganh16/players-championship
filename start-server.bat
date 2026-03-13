@echo off
setlocal
cd /d "%~dp0"

if not exist ".env" (
  if exist ".env.example" (
    echo No .env file found.
    echo Copying .env.example to .env so you can add your SportsDataIO key.
    copy /Y ".env.example" ".env" >nul
    echo.
    echo Edit .env and set SPORTSDATAIO_API_KEY before using live sync.
    echo.
  ) else (
    echo No .env file found and no .env.example is available.
    echo.
  )
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not on PATH.
  echo Install Node.js, then run this file again.
  echo.
  pause
  exit /b 1
)

set PORT=
for %%P in (3000 3001 3002 3003 3004 3005) do (
  netstat -ano | findstr /R /C:":%%P .*LISTENING" >nul
  if errorlevel 1 (
    set PORT=%%P
    goto start_server
  )
)

echo Could not find an open port between 3000 and 3005.
echo Close one of the running local servers and try again.
echo.
pause
exit /b 1

:start_server
echo Starting Players Championship Fantasy Draft server on port %PORT%...
echo Open http://localhost:%PORT% in your browser.
echo.
set PORT=%PORT%
node server.js

if errorlevel 1 (
  echo.
  echo Server failed to start.
  echo If you already have the app running, open the URL shown above in your browser.
)

echo.
echo Server stopped.
pause
