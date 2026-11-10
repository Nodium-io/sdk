<?php

// routes/api.php
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;

Route::post('/webhooks/nodium', function (Request $request) {
    // The raw body, before any JSON parsing: the signature is computed on it.
    $rawBody = $request->getContent();

    $timestamp = null;
    $signatures = [];
    foreach (explode(',', (string) $request->header('X-Nodium-Signature')) as $part) {
        [$key, $value] = array_pad(explode('=', trim($part), 2), 2, '');
        if ($key === 't') $timestamp = (int) $value;
        if ($key === 'v1') $signatures[] = $value;
    }
    if (! $timestamp || abs(time() - $timestamp) > 300) {
        return response('', 400);
    }
    $expected = hash_hmac('sha256', $timestamp.'.'.$rawBody, config('services.nodium.webhook_secret'));
    $valid = collect($signatures)->contains(fn ($signature) => hash_equals($expected, $signature));
    if (! $valid) {
        return response('', 400);
    }

    $event = json_decode($rawBody, true);
    if ($event['event'] === 'message.received' && $event['data']['type'] === 'text') {
        Http::withToken(config('services.nodium.key'))
            ->post('https://nodium.io/api/v1/messages', [
                'channelId' => $event['data']['channel_id'],
                'to' => $event['data']['from'],
                'type' => 'text',
                'text' => 'You wrote: '.$event['data']['text'],
                'idempotencyKey' => 'reply-'.$event['id'],
            ]);
    }

    return response('', 200);
});

// ── config/services.php ──────────────────────────────────────────────
//
// 'nodium' => [
//     'key' => env('NODIUM_KEY'),
//     'webhook_secret' => env('NODIUM_WEBHOOK_SECRET'),
// ],
