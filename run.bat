@echo off
echo ========================================
echo   UK Train Arrivals App
echo ========================================
echo.

:: Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python is not installed!
    echo Please install Python from https://www.python.org/downloads/
    echo Make sure to check "Add to PATH" during installation.
    pause
    exit /b 1
)

:: Check if dependencies are installed
echo Checking dependencies...
python -m pip show flask >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing dependencies...
    python -m pip install -r requirements.txt
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install dependencies!
        pause
        exit /b 1
    )
)

echo.
echo Starting server...
echo.
echo ========================================
echo   Open http://127.0.0.1:5000 in your browser
echo   Press Ctrl+C to stop the server
echo ========================================
echo.

:: Run the Flask app
python app.py

pause
