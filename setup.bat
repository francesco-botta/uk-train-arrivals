@echo off
echo ========================================
echo   UK Train Arrivals - Setup
echo ========================================
echo.

:: Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python is not installed!
    echo.
    echo Please install Python from https://www.python.org/downloads/
    echo Make sure to check "Add to PATH" during installation.
    echo.
    pause
    exit /b 1
)

echo Python found:
python --version
echo.

echo Installing dependencies...
python -m pip install -r requirements.txt

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo   Setup complete!
    echo   Run 'run.bat' to start the app
    echo ========================================
) else (
    echo.
    echo ERROR: Setup failed!
)

echo.
pause
