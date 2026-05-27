@echo off
REM Test script for Moka Open Bill Sync
REM Usage: test-moka-sync.bat [outlet] [admin_password]

set OUTLET=%1
if "%OUTLET%"=="" set OUTLET=bypass

set SECRET=%2
if "%SECRET%"=="" set SECRET=YOUR_ADMIN_PASSWORD

set DOMAIN=https://your-domain.vercel.app

echo ==========================================
echo Moka Open Bill Sync Test Tool
echo ==========================================
echo.
echo Outlet: %OUTLET%
echo.

:menu
echo Pilih aksi:
echo 1. Test outlet status
echo 2. Update Tegal barber IDs
echo 3. Trigger manual sync
echo 4. Test semua outlet
echo 5. Keluar
echo.

set /p choice=Pilihan (1-5): 

if "%choice%"=="1" goto test_outlet
if "%choice%"=="2" goto update_tegal
if "%choice%"=="3" goto trigger_sync
if "%choice%"=="4" goto test_all
if "%choice%"=="5" goto exit
goto menu

:test_outlet
echo.
echo Testing outlet: %OUTLET%
curl -s "%DOMAIN%/api/moka/test-sync?outlet=%OUTLET%&secret=%SECRET%" | powershell -Command "ConvertFrom-Json | ConvertTo-Json -Depth 10"
pause
goto menu

:update_tegal
echo.
echo Updating Tegal barber IDs...
curl -s "%DOMAIN%/api/moka/update-barber-ids?secret=%SECRET%" | powershell -Command "ConvertFrom-Json | ConvertTo-Json -Depth 10"
pause
goto menu

:trigger_sync
echo.
echo Triggering manual sync...
curl -s "%DOMAIN%/api/moka/cron-sync?secret=%SECRET%"
echo.
echo Sync triggered!
pause
goto menu

:test_all
echo.
echo Testing all outlets...
for %%o in (bypass csb samadikun sumber tegal) do (
    echo.
    echo ==========================================
    echo Testing: %%o
    echo ==========================================
    curl -s "%DOMAIN%/api/moka/test-sync?outlet=%%o&secret=%SECRET%" | powershell -Command "ConvertFrom-Json | Select-Object outlet, moka_token, barbers | ConvertTo-Json -Depth 5"
)
pause
goto menu

:exit
echo.
echo Selesai!
pause
