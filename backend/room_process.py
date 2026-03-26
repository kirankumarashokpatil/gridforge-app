"""
Standalone room worker process — one process per room for fault isolation.

Usage
-----
    python room_process.py --room-id ROOM_ID [--redis-url URL]

The process connects to Redis + PostgreSQL, creates a ``RoomWorker``, and
processes commands for the specified room via BLPOP on a per-room Redis queue.
Broadcasts are published to Redis; the gateway relays them to WS clients.

Environment variables
    REDIS_URL     – Redis connection URL (default ``redis://localhost:6379/0``)
    DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME – PostgreSQL credentials
"""

import argparse
import asyncio
import json
import os
import signal
import sys


async def main(room_id: str, redis_url: str) -> None:
    import redis.asyncio as aioredis

    # These imports require cwd = backend/
    from db import db
    from room_worker import RoomWorker
    from bus import CommandResult

    await db.connect()

    worker = RoomWorker()
    redis_conn = aioredis.from_url(redis_url, decode_responses=True)

    CMD_KEY = f"gridforge:cmd:{room_id}"
    RESP_PREFIX = "gridforge:resp:"
    BROADCAST_PREFIX = "gridforge:broadcast:"

    print(f"[room_process] Worker for room {room_id} started — listening on {CMD_KEY}")

    stopping = False

    def _handle_signal(*_):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    try:
        while not stopping:
            raw = await redis_conn.blpop(CMD_KEY, timeout=2)
            if raw is None:
                continue

            payload = json.loads(raw[1])
            request_id = payload["request_id"]
            command = payload["command"]
            data = payload.get("data")

            cr = await worker.execute(room_id, command, data)

            # Publish broadcasts to Redis for gateway relay
            for broadcast in cr.broadcasts:
                await redis_conn.publish(
                    f"{BROADCAST_PREFIX}{room_id}",
                    json.dumps(broadcast),
                )

            # Push response so the gateway can unblock
            resp_key = f"{RESP_PREFIX}{request_id}"
            await redis_conn.rpush(resp_key, json.dumps(cr.to_dict()))
            await redis_conn.expire(resp_key, 60)
    except asyncio.CancelledError:
        pass
    finally:
        print(f"[room_process] Room {room_id} shutting down")
        await redis_conn.aclose()
        await db.disconnect()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="GridForge isolated room worker")
    parser.add_argument("--room-id", required=True, help="Room ID this process handles")
    parser.add_argument(
        "--redis-url",
        default=os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
    )
    args = parser.parse_args()
    asyncio.run(main(args.room_id, args.redis_url))
