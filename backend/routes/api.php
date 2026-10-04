<?php

use App\Http\Controllers\Api\V1\AssetController;
use App\Http\Controllers\Api\V1\AssetMovementController;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\BranchController;
use App\Http\Controllers\Api\V1\ContractController;
use App\Http\Controllers\Api\V1\CredentialController;
use App\Http\Controllers\Api\V1\KpiController;
use App\Http\Controllers\Api\V1\NotificationController;
use App\Http\Controllers\Api\V1\SettingController;
use App\Http\Controllers\Api\V1\TicketController;
use App\Http\Controllers\Api\V1\LocationController;
use App\Http\Controllers\Api\V1\MovementController;
use App\Http\Controllers\Api\V1\ProfileController;
use App\Http\Controllers\Api\V1\UserController;
use Illuminate\Support\Facades\Route;

/*
| API เวอร์ชัน 1 — ใช้ร่วมกันระหว่าง Next.js และ Mobile App (Flutter / React Native)
| เพิ่ม v2 ในอนาคตได้โดยไม่กระทบ client เดิม
*/
Route::prefix('v1')->name('api.v1.')->group(function () {
    Route::post('auth/login', [AuthController::class, 'login'])
        ->middleware('throttle:login')
        ->name('auth.login');

    Route::middleware(['auth:sanctum', 'throttle:api'])->group(function () {
        Route::get('auth/me', [AuthController::class, 'me'])->name('auth.me');
        Route::post('auth/logout', [AuthController::class, 'logout'])->name('auth.logout');
        Route::patch('auth/me', [ProfileController::class, 'update'])->name('auth.me.update');
        Route::get('auth/me/signature', [ProfileController::class, 'signature'])->name('auth.me.signature');
        Route::post('auth/me/signature', [ProfileController::class, 'uploadSignature'])->name('auth.me.signature.store');
        Route::delete('auth/me/signature', [ProfileController::class, 'deleteSignature'])->name('auth.me.signature.destroy');
        Route::put('auth/password', [ProfileController::class, 'updatePassword'])
            ->middleware('throttle:login') // จำกัดการเดารหัสผ่านปัจจุบัน
            ->name('auth.password');

        Route::get('movements', [MovementController::class, 'index'])->name('movements.index');

        Route::apiResource('assets', AssetController::class);
        Route::get('assets/{asset}/movements', [AssetMovementController::class, 'index'])->name('assets.movements.index');
        Route::post('assets/{asset}/movements', [AssetMovementController::class, 'store'])->name('assets.movements.store');
        Route::apiResource('locations', LocationController::class);
        Route::apiResource('users', UserController::class);

        // ---------- IT-SYSTEM ----------
        Route::apiResource('branches', BranchController::class)->except('show');
        Route::get('settings', [SettingController::class, 'show'])->name('settings.show');
        Route::put('settings', [SettingController::class, 'update'])->name('settings.update');
        Route::get('ui-config', [SettingController::class, 'uiConfig'])->name('ui-config');

        Route::get('notifications', [NotificationController::class, 'index'])->name('notifications.index');
        Route::post('notifications/read-all', [NotificationController::class, 'readAll'])->name('notifications.read-all');
        Route::post('notifications/{id}/read', [NotificationController::class, 'read'])->name('notifications.read');

        Route::apiResource('credentials', CredentialController::class);
        Route::post('credentials/{credential}/reveal', [CredentialController::class, 'reveal'])
            ->middleware('throttle:30,1') // จำกัดการเปิดดูรหัสผ่านถี่ๆ
            ->name('credentials.reveal');
        Route::get('credentials/{credential}/logs', [CredentialController::class, 'logs'])->name('credentials.logs');
        Route::apiResource('contracts', ContractController::class);

        Route::apiResource('kpi', KpiController::class)->except('show');

        Route::get('it-staff', [TicketController::class, 'itStaff'])->name('it-staff');
        Route::get('tickets/form-options', [TicketController::class, 'formOptions'])->name('tickets.form-options');
        Route::get('tickets', [TicketController::class, 'index'])->name('tickets.index');
        Route::post('tickets', [TicketController::class, 'store'])->name('tickets.store');
        Route::get('tickets/{ticket}', [TicketController::class, 'show'])->name('tickets.show');
        Route::post('tickets/{ticket}/approve', [TicketController::class, 'approve'])->name('tickets.approve');
        Route::post('tickets/{ticket}/reject', [TicketController::class, 'reject'])->name('tickets.reject');
        Route::post('tickets/{ticket}/accept', [TicketController::class, 'accept'])->name('tickets.accept');
        Route::post('tickets/{ticket}/result', [TicketController::class, 'result'])->name('tickets.result');
        Route::post('tickets/{ticket}/close', [TicketController::class, 'close'])->name('tickets.close');
        Route::post('tickets/{ticket}/return', [TicketController::class, 'returnToStaff'])->name('tickets.return');
        Route::get('tickets/{ticket}/files/{kind}/{id?}', [TicketController::class, 'file'])
            ->whereNumber('id')
            ->name('tickets.files');
    });
});
