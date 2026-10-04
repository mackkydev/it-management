<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// แจ้งเตือนสัญญา/บัญชีใกล้หมดอายุ ทุกวัน 08:00 (ต้องมี service scheduler รัน `php artisan schedule:work`)
Schedule::command('it:notify-expiring')->dailyAt('08:00')->withoutOverlapping()->onOneServer();
