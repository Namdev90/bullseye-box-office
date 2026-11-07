@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
    py -3 app.py --android-emulator
) else (
    where python >nul 2>nul
    if %errorlevel%==0 (
        python app.py --android-emulator
    ) else (
        echo Python 3.10 or newer was not found on PATH.
        echo Open your existing Python terminal and run: python app.py --android-emulator
        pause
    )
)
endlocal
