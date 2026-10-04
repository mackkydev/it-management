<?php

namespace App\Services;

use App\Models\ItTicket;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * จัดเก็บไฟล์ของใบแจ้งงานใน private disk (ไม่เข้าถึงผ่าน URL ตรง — ต้องผ่าน API ที่ตรวจสิทธิ์)
 */
class TicketFiles
{
    private const DISK = 'local';

    /** รูปภาพ: ตั้งชื่อสุ่ม ไม่ใช้ชื่อไฟล์จากผู้ใช้เป็น path */
    public function storePhoto(ItTicket $ticket, UploadedFile $file, string $folder): array
    {
        $ext = strtolower($file->guessExtension() ?: 'jpg');
        $path = $file->storeAs("tickets/{$ticket->uuid}/{$folder}", Str::random(32).'.'.$ext, self::DISK);

        return [
            'path' => $path,
            'original_name' => mb_substr($file->getClientOriginalName(), 0, 200),
            'mime' => $file->getMimeType(),
            'size' => $file->getSize(),
        ];
    }

    /**
     * ลายเซ็นจาก canvas (data URL PNG) → ไฟล์ PNG
     * ตรวจรูปแบบ, ขนาดไม่เกิน 300KB และ header เป็น PNG จริง
     */
    public function storeSignature(ItTicket $ticket, string $dataUrl, string $who, string $field = 'signature'): string
    {
        if (! preg_match('#^data:image/png;base64,([A-Za-z0-9+/=]+)$#', $dataUrl, $m)) {
            throw ValidationException::withMessages([$field => __('eam.ticket.signature_invalid')]);
        }
        $binary = base64_decode($m[1], true);
        if ($binary === false || strlen($binary) > 300 * 1024 || ! str_starts_with($binary, "\x89PNG\r\n\x1a\n")) {
            throw ValidationException::withMessages([$field => __('eam.ticket.signature_invalid')]);
        }

        $path = "tickets/{$ticket->uuid}/signatures/{$who}-".Str::random(16).'.png';
        Storage::disk(self::DISK)->put($path, $binary);

        return $path;
    }

    /** ลายเซ็นในโปรไฟล์ผู้ใช้ (users/{id}/signature-xxx.ext) — ชื่อสุ่มใหม่ทุกครั้งที่อัปโหลด */
    public function storeUserSignature(int $userId, UploadedFile $file): string
    {
        $ext = strtolower($file->guessExtension() ?: 'png');

        return $file->storeAs("users/{$userId}", 'signature-'.Str::random(16).'.'.$ext, self::DISK);
    }

    /** คัดลอกลายเซ็นในโปรไฟล์ ณ ตอนแจ้งงาน มาเก็บกับใบงาน (เปลี่ยนลายเซ็นภายหลัง เอกสารเดิมไม่เปลี่ยน) */
    public function snapshotSignature(ItTicket $ticket, string $source, string $who): ?string
    {
        if (! Storage::disk(self::DISK)->exists($source)) {
            return null;
        }
        $ext = strtolower(pathinfo($source, PATHINFO_EXTENSION) ?: 'png');
        $path = "tickets/{$ticket->uuid}/signatures/{$who}-".Str::random(16).'.'.$ext;
        Storage::disk(self::DISK)->copy($source, $path);

        return $path;
    }

    public function delete(?string $path): void
    {
        if ($path) {
            Storage::disk(self::DISK)->delete($path);
        }
    }

    public function response(string $path)
    {
        abort_unless(Storage::disk(self::DISK)->exists($path), 404);

        return Storage::disk(self::DISK)->response($path, null, [
            'Cache-Control' => 'private, max-age=3600',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
