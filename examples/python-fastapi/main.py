# main.py — pip install fastapi uvicorn httpx
import hashlib, hmac, json, os, time

import httpx
from fastapi import FastAPI, Request, Response

app = FastAPI()
API = "https://nodium.io/api/v1"


def verify_nodium(raw_body: bytes, header: str, secret: str) -> bool:
    parts = header.split(",")
    t = next((p[2:] for p in parts if p.startswith("t=")), None)
    signatures = [p[3:] for p in parts if p.startswith("v1=")]
    if not t or abs(time.time() - int(t)) > 300:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(sig, expected) for sig in signatures)


@app.post("/webhooks/nodium")
async def nodium_webhook(request: Request):
    raw_body = await request.body()  # the raw bytes, before any JSON parsing
    header = request.headers.get("x-nodium-signature", "")
    if not verify_nodium(raw_body, header, os.environ["NODIUM_WEBHOOK_SECRET"]):
        return Response(status_code=400)

    event = json.loads(raw_body)
    if event["event"] == "message.received" and event["data"]["type"] == "text":
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{API}/messages",
                headers={"Authorization": f"Bearer {os.environ['NODIUM_KEY']}"},
                json={
                    "channelId": event["data"]["channel_id"],
                    "to": event["data"]["from"],
                    "type": "text",
                    "text": f"You wrote: {event['data']['text']}",
                    "idempotencyKey": f"reply-{event['id']}",
                },
            )
    return Response(status_code=200)
