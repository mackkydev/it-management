@echo off
REM ============================================================
REM  IT-SYSTEM - update this computer to the latest main
REM  Run from anywhere:  update-local.cmd
REM  Steps: check local changes -> git pull main -> backup DB
REM         -> rebuild containers -> prisma migrate deploy -> restart API
REM  Backups go OUTSIDE the repo: ..\it-system-backups (never committed)
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo [1/6] Checking for uncommitted changes...
git diff --quiet
if errorlevel 1 goto dirty
git diff --cached --quiet
if errorlevel 1 goto dirty

echo.
echo [2/6] Pulling latest main...
git checkout main
if errorlevel 1 goto fail
git pull origin main
if errorlevel 1 goto fail
git log --oneline -1

echo.
echo [3/6] Backing up database it_system...
set "BACKUP_DIR=%~dp0..\it-system-backups"
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "TS=%%i"
set "BACKUP_FILE=%BACKUP_DIR%\it_system-%TS%.sql"
docker exec it_mysql sh -c "mysqldump -uroot -p\"$MYSQL_ROOT_PASSWORD\" --single-transaction --routines --default-character-set=utf8mb4 it_system 2>/dev/null" > "%BACKUP_FILE%"
if errorlevel 1 goto backupfail
for %%A in ("%BACKUP_FILE%") do if %%~zA LSS 1000 goto backupfail
echo     Saved: %BACKUP_FILE%

echo.
echo [4/6] Rebuilding containers (express + frontend)...
docker compose --profile web up -d --build
if errorlevel 1 goto fail

echo.
echo [5/6] Applying database migrations...
docker compose exec express npx prisma migrate deploy
if errorlevel 1 goto fail

echo.
echo [6/6] Restarting API...
docker compose restart express
if errorlevel 1 goto fail
docker compose ps

echo.
echo ===== DONE - open http://localhost:3000 =====
exit /b 0

:dirty
echo.
echo STOP: there are uncommitted changes in this folder:
git status --short
echo Commit them, or set them aside with:  git stash
echo Then run update-local.cmd again.
exit /b 1

:backupfail
echo.
echo STOP: database backup failed or is empty - nothing was changed.
echo Check that container it_mysql is running:  docker compose ps
exit /b 1

:fail
echo.
echo STOP: the step above failed - read the message above, fix it, then run again.
exit /b 1
