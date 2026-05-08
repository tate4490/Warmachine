@echo off
echo Warmachine JSON Decryptor
echo.

python -c "print('ok')" >nul 2>&1
if errorlevel 1 (
    echo Python not found. Please install Python from https://www.python.org
    echo Make sure to check "Add Python to PATH" during installation.
    pause
    exit /b 1
)

python -c "import Crypto" >nul 2>&1
if errorlevel 1 (
    echo Installing required library...
    python -m pip install pycryptodome
)

python "%~dp0wm_decrypt.py"
