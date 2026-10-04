<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * เลือกภาษาของข้อความจาก API (validation, ชื่อสถานะ ฯลฯ) ตาม header Accept-Language
 * ใช้ได้ทั้ง Next.js และแอปมือถือ — รองรับ th / en, ค่าอื่นใช้ค่าเริ่มต้นใน config
 */
class SetLocale
{
    public const SUPPORTED = ['th', 'en'];

    public function handle(Request $request, Closure $next): Response
    {
        $locale = $request->getPreferredLanguage(self::SUPPORTED);
        if ($request->headers->has('Accept-Language') && $locale) {
            app()->setLocale($locale);
        }

        $response = $next($request);
        $response->headers->set('Content-Language', app()->getLocale());

        return $response;
    }
}
