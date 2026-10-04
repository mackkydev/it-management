# สร้าง Laravel skeleton แล้วรวมกับโค้ดของโปรเจกต์ใน backend\
# รันจากโฟลเดอร์ราก:  E:\Claude_Jobs\it-management
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup-backend.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tmp = Join-Path $root '_laravel_skeleton'
$backend = Join-Path $root 'backend'

if (Test-Path (Join-Path $backend 'artisan')) {
    Write-Host 'backend\ ถูกติดตั้งแล้ว (พบไฟล์ artisan) — ข้ามขั้นตอนนี้'
    exit 0
}

Set-Location $root
if (-not (Test-Path $tmp)) {
    composer create-project laravel/laravel _laravel_skeleton --prefer-dist
    if ($LASTEXITCODE -ne 0) { throw 'composer create-project failed' }
}

Set-Location $tmp
# ติดตั้ง Sanctum + routes/api.php + migration personal_access_tokens
php artisan install:api --without-migration-prompt
if ($LASTEXITCODE -ne 0) { throw 'php artisan install:api failed' }

Remove-Item -Force -ErrorAction SilentlyContinue .env, .env.example, database\database.sqlite

# คัดลอกไฟล์ skeleton ไปยัง backend\ เฉพาะไฟล์ที่ยังไม่มี (ไฟล์ของโปรเจกต์จะไม่ถูกเขียนทับ)
robocopy $tmp $backend /E /XC /XN /XO /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }

Set-Location $backend
Copy-Item .env.example .env -Force
php artisan key:generate

Set-Location $root
Remove-Item -Recurse -Force $tmp
Write-Host 'เสร็จแล้ว: แก้ค่า DB_* ใน backend\.env แล้วรัน  php artisan migrate --seed'
