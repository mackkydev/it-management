<?php

return [
    // อายุ API token (นาที) ค่าเริ่มต้น 12 ชั่วโมง
    'token_ttl_minutes' => env('EAM_TOKEN_TTL_MINUTES', 60 * 12),

    // origin ของ Next.js ที่อนุญาตให้เรียก API จาก browser (คั่นด้วย ,)
    'frontend_urls' => array_filter(explode(',', (string) env('FRONTEND_URLS', 'http://localhost:3000'))),
];
