<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * บังคับให้ทุก request ใต้ /api ได้ JSON กลับเสมอ (รวมถึง error 401/404/422/500)
 * ไม่ต้องพึ่งให้ client ส่ง Accept header เอง
 */
class ForceJsonResponse
{
    public function handle(Request $request, Closure $next): Response
    {
        $request->headers->set('Accept', 'application/json');

        return $next($request);
    }
}
