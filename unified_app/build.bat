@echo off
chcp 65001 >nul
echo ========================================
echo   CameraApp Build Script
echo ========================================
echo.

REM Activate virtual environment if exists
if exist "env\Scripts\activate.bat" (
    echo [0/3] Activating virtual environment...
    call env\Scripts\activate.bat
    echo.
) else (
    echo [WARNING] No virtual environment found at env\Scripts\activate.bat
    echo Using system Python instead...
    echo.
)

REM Check if go2rtc.exe exists
if not exist "go2rtc.exe" (
    echo [ERROR] go2rtc.exe not found!
    echo Please download go2rtc.exe and place it in unified_app folder
    echo Download from: https://github.com/AlexxIT/go2rtc/releases
    echo.
    pause
    exit /b 1
)

REM Check if models folder exists
if not exist "models" (
    echo [ERROR] models folder not found!
    echo Please ensure models/ folder exists with AI models
    echo.
    pause
    exit /b 1
)

echo [1/3] Cleaning old build...
if exist "build" rmdir /s /q build
if exist "dist" rmdir /s /q dist
if exist "CameraApp.spec" del /q CameraApp.spec

echo [2/3] Building CameraApp.exe...
echo This may take 5-10 minutes...
echo.

python -m PyInstaller --name="CameraApp" ^
  --windowed ^
  --onedir ^
  --add-data "models;models" ^
  --add-binary "go2rtc.exe;." ^
  --add-data "config.yaml;." ^
  --add-data "go2rtc.yaml;." ^
  --hidden-import "supervision" ^
  --hidden-import "ultralytics" ^
  --hidden-import "cv2" ^
  --hidden-import "onnxruntime" ^
  app.py

if errorlevel 1 (
    echo.
    echo [ERROR] Build failed!
    echo Check the error messages above
    pause
    exit /b 1
)

echo.
echo [3/3] Build complete!
echo.
echo ========================================
echo   Output: dist\CameraApp\
echo ========================================
echo.
echo Portable app is ready at:
echo   dist\CameraApp\CameraApp.exe
echo.
echo You can now:
echo   1. Test: cd dist\CameraApp ^&^& CameraApp.exe
echo   2. Copy entire dist\CameraApp\ folder to another PC
echo   3. Zip and distribute
echo.
pause