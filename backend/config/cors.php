<?php

/*
| Next.js ในโปรเจกต์นี้เรียก API จากฝั่ง server (Server Components / Server Actions)
| จึงไม่ต้องพึ่ง CORS; Mobile App ก็ไม่ใช้ CORS
| อนุญาตเฉพาะ origin ของ frontend ที่ระบุไว้ เผื่อมีการเรียกจาก browser โดยตรงในอนาคต
*/
return [
    'paths' => ['api/*'],
    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    'allowed_origins' => array_filter(explode(',', (string) env('FRONTEND_URLS', 'http://localhost:3000'))),
    'allowed_origins_patterns' => [],
    'allowed_headers' => ['Accept', 'Authorization', 'Content-Type', 'X-Requested-With'],
    'exposed_headers' => ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
    'max_age' => 3600,
    'supports_credentials' => false,
];
