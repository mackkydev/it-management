<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Gate;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        // ตรวจจับ N+1 query และ attribute ที่ไม่มีอยู่จริงระหว่างพัฒนา
        Model::shouldBeStrict(! $this->app->isProduction());

        // สิทธิ์ระดับระบบ: admin = จัดการสาขา/ตั้งค่า, it-data = ข้อมูลแผนก IT (คลังรหัส/สัญญา/งาน IT ทั้งหมด)
        Gate::define('admin', fn (User $user) => $user->isAdmin());
        Gate::define('it-data', fn (User $user) => $user->canAccessItData());

        // จำกัดจำนวน request ต่อผู้ใช้ (หรือต่อ IP ถ้ายังไม่ login)
        RateLimiter::for('api', fn (Request $request) => Limit::perMinute(120)
            ->by($request->user()?->id ?: $request->ip()));

        // ป้องกัน brute-force: 5 ครั้ง/นาที ต่อ อีเมล+IP และ 20 ครั้ง/นาที ต่อ IP
        RateLimiter::for('login', fn (Request $request) => [
            Limit::perMinute(5)->by(strtolower((string) $request->input('email')).'|'.$request->ip()),
            Limit::perMinute(20)->by($request->ip()),
        ]);
    }
}
