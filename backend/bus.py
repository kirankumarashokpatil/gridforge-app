"""
Message bus abstraction for gateway ↔ room-worker communication.

LocalBus  – in-process asyncio calls (default, no extra deps).
RedisBus  – Redis-backed transport for horizontal scaling.
"""

from __future__ import annotations

import abc
import asyncio
import json
import os
from dataclasses import dataclass, field
from typing import Optional, List, Callable, Awaitable, TYPE_CHECKING
from uuid import uuid4

if TYPE_CHECKING:
    from room_worker import RoomWorker


@dataclass
class CommandResult:
    """Structured result returned by every room-worker command."""
    result: dict = field(default_factory=dict)
    broadcasts: List[dict] = field(default_factory=list)
    error: Optional[str] = None
    status_code: int = 200

    def to_dict(self) -> dict:
        return {
            "result": self.result,
            "broadcasts": self.broadcasts,
            "error": self.error,
            "status_code": self.status_code,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "CommandResult":
        return cls(
            result=d.get("result", {}),
            broadcasts=d.get("broadcasts", []),
            error=d.get("error"),
            status_code=d.get("status_code", 200),
        )


class MessageBus(abc.ABC):
    """Abstract message bus between gateway (HTTP/WS) and room workers."""

    @abc.abstractmethod
    async def send_command(
        self, room_id: str, command: str, data: dict | None = None
    ) -> CommandResult:
        """Send a command to the room worker and await the result."""

    @abc.abstractmethod
    async def start(self) -> None:
        """Initialise the bus (connect to Redis, start workers, etc.)."""

    @abc.abstractmethod
    async def stop(self) -> None:
        """Shut down the bus cleanly."""


class LocalBus(MessageBus):
    """In-process bus — direct async call to the worker.

    Zero serialisation overhead.  Used when gateway and room workers share
    the same Python process (single-server deployment).
    """

    def __init__(self, worker: "RoomWorker"):
        self.worker = worker

    async def send_command(
        self, room_id: str, command: str, data: dict | None = None
    ) -> CommandResult:
        return await self.worker.execute(room_id, command, data)

    async def start(self) -> None:
        pass

    async def stop(self) -> None:
        pass


# ── Redis-backed bus ────────────────────────────────────────────────────────


class RedisBus(MessageBus):
    """Redis-backed bus for multi-process / multi-host deployment.

    Roles
    -----
    combined  (default) — Same process runs both gateway + worker.  Commands
              are handled locally; broadcasts are additionally published to
              Redis for any other gateway instances.
    gateway   — Only sends commands (via Redis list) and subscribes to
              broadcast channels.  Does NOT process game logic.
    worker    — Only listens on the command queue, processes via its local
              ``RoomWorker``, and publishes results + broadcasts.

    Transport
    ---------
    Commands  : RPUSH → ``gridforge:cmd`` (shared queue) or
                        ``gridforge:cmd:{room_id}`` (isolated mode)
    Responses : RPUSH → ``gridforge:resp:{request_id}``  (gateway BRPOP)
    Broadcasts: PUBLISH → ``gridforge:broadcast:{room_id}``

    Room Isolation
    --------------
    When ``isolated=True`` the gateway sends commands to per-room queues
    (``gridforge:cmd:{room_id}``) and uses a ``ProcessManager`` to ensure
    each room has its own subprocess (``room_process.py``).

    Parameters
    ----------
    redis_url         : Redis connection URL
    worker            : Local RoomWorker (required for combined/worker roles)
    role              : "combined" | "gateway" | "worker"
    broadcast_callback: async(room_id, message) called on every received
                        broadcast (gateway/combined wires this to
                        ``manager.broadcast_to_room``).
    cmd_timeout       : Seconds to wait for a worker response (gateway mode).
    isolated          : Use per-room command queues + ProcessManager.
    """

    CMD_QUEUE = "gridforge:cmd"
    RESP_PREFIX = "gridforge:resp:"
    BROADCAST_PREFIX = "gridforge:broadcast:"

    def __init__(
        self,
        redis_url: str,
        worker: "RoomWorker | None" = None,
        role: str = "combined",
        broadcast_callback: Callable[[str, dict], Awaitable[None]] | None = None,
        cmd_timeout: int = 120,
        isolated: bool = False,
    ):
        self.redis_url = redis_url
        self.worker = worker
        self.role = role
        self.broadcast_callback = broadcast_callback
        self.cmd_timeout = cmd_timeout
        self.isolated = isolated
        self._redis = None
        self._sub_redis = None  # dedicated connection for pub/sub
        self._worker_task: asyncio.Task | None = None
        self._subscriber_task: asyncio.Task | None = None
        self._subscribed_rooms: set[str] = set()
        self._stopping = False
        self._process_manager = None

    # ── lifecycle ───────────────────────────────────────────────────────

    async def start(self) -> None:
        import redis.asyncio as aioredis

        self._redis = aioredis.from_url(self.redis_url, decode_responses=True)
        await self._redis.ping()  # fail-fast if Redis is down

        if self.role in ("combined", "worker") and self.worker and not self.isolated:
            self._worker_task = asyncio.create_task(self._worker_loop())

        if self.role in ("combined", "gateway") and self.broadcast_callback:
            self._sub_redis = aioredis.from_url(self.redis_url, decode_responses=True)
            self._subscriber_task = asyncio.create_task(self._broadcast_subscriber())

        if self.isolated and self.role in ("combined", "gateway"):
            from process_manager import ProcessManager
            self._process_manager = ProcessManager(self.redis_url)
            await self._process_manager.start_monitor()

        print(f"[RedisBus] started (role={self.role}, isolated={self.isolated})")

    async def stop(self) -> None:
        self._stopping = True
        if self._process_manager:
            await self._process_manager.stop_all()
        if self._worker_task:
            self._worker_task.cancel()
        if self._subscriber_task:
            self._subscriber_task.cancel()
        if self._sub_redis:
            await self._sub_redis.aclose()
        if self._redis:
            await self._redis.aclose()

    # ── send command (gateway / combined) ───────────────────────────────

    async def send_command(
        self, room_id: str, command: str, data: dict | None = None
    ) -> CommandResult:
        # Combined mode without isolation: short-circuit via local worker
        if self.role == "combined" and self.worker and not self.isolated:
            cr = await self.worker.execute(room_id, command, data)
            # Publish broadcasts to Redis for other gateway instances
            for broadcast in cr.broadcasts:
                await self._redis.publish(
                    f"{self.BROADCAST_PREFIX}{room_id}",
                    json.dumps(broadcast),
                )
            return cr

        # Isolated or gateway mode: push command to Redis queue
        # Ensure a worker process exists when using room isolation
        if self.isolated and self._process_manager:
            await self._process_manager.ensure_worker(room_id)

        request_id = uuid4().hex
        payload = json.dumps(
            {
                "request_id": request_id,
                "room_id": room_id,
                "command": command,
                "data": data,
            }
        )

        # Per-room queue when isolated, shared queue otherwise
        queue_key = (
            f"{self.CMD_QUEUE}:{room_id}" if self.isolated
            else self.CMD_QUEUE
        )
        await self._redis.rpush(queue_key, payload)

        resp_key = f"{self.RESP_PREFIX}{request_id}"
        resp_raw = await self._redis.brpop(resp_key, timeout=self.cmd_timeout)
        if resp_raw is None:
            # Clean up stale response key to prevent Redis key accumulation
            await self._redis.delete(resp_key)
            return CommandResult(error="Worker timeout", status_code=504)

        return CommandResult.from_dict(json.loads(resp_raw[1]))

    # ── room broadcast subscription (gateway / combined) ────────────────

    async def subscribe_room(self, room_id: str) -> None:
        """Subscribe to broadcast channel for a room (call when first WS client connects)."""
        self._subscribed_rooms.add(room_id)

    async def unsubscribe_room(self, room_id: str) -> None:
        """Unsubscribe from broadcast channel (call when last WS client leaves)."""
        self._subscribed_rooms.discard(room_id)

    async def _broadcast_subscriber(self) -> None:
        """Background task: listen on all broadcast channels and relay to WS."""
        import redis.asyncio as aioredis

        pubsub = self._sub_redis.pubsub()
        try:
            # Subscribe to a wildcard pattern for all room broadcasts
            await pubsub.psubscribe(f"{self.BROADCAST_PREFIX}*")
            async for raw_msg in pubsub.listen():
                if self._stopping:
                    break
                if raw_msg["type"] != "pmessage":
                    continue
                channel: str = raw_msg["channel"]
                room_id = channel[len(self.BROADCAST_PREFIX) :]
                if room_id not in self._subscribed_rooms:
                    continue
                try:
                    message = json.loads(raw_msg["data"])
                    await self.broadcast_callback(room_id, message)
                except Exception as exc:
                    print(f"[RedisBus] broadcast relay error: {exc}")
        except asyncio.CancelledError:
            pass
        finally:
            await pubsub.punsubscribe()
            await pubsub.aclose()

    # ── worker loop (worker / combined) ─────────────────────────────────

    async def _worker_loop(self) -> None:
        """Background task: BLPOP commands from Redis queue, process, respond."""
        try:
            while not self._stopping:
                raw = await self._redis.blpop(self.CMD_QUEUE, timeout=1)
                if raw is None:
                    continue
                payload = json.loads(raw[1])
                request_id = payload["request_id"]
                room_id = payload["room_id"]
                command = payload["command"]
                data = payload.get("data")

                cr = await self.worker.execute(room_id, command, data)

                # Publish broadcasts to Redis
                for broadcast in cr.broadcasts:
                    await self._redis.publish(
                        f"{self.BROADCAST_PREFIX}{room_id}",
                        json.dumps(broadcast),
                    )

                # Send response back to the gateway
                resp_key = f"{self.RESP_PREFIX}{request_id}"
                await self._redis.rpush(resp_key, json.dumps(cr.to_dict()))
                # Expire the response key after 300s to avoid leaks
                await self._redis.expire(resp_key, 300)
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            print(f"[RedisBus] worker loop error: {exc}")


def create_bus(worker: "RoomWorker | None" = None, broadcast_callback=None) -> MessageBus:
    """Factory: pick LocalBus or RedisBus based on environment variables.

    Env vars
    --------
    REDIS_URL       – If set, use RedisBus (otherwise LocalBus).
    BUS_ROLE        – "combined" (default) | "gateway" | "worker".
    ROOM_ISOLATION  – "1" to spawn per-room subprocesses.
    """
    redis_url = os.environ.get("REDIS_URL")
    if redis_url:
        role = os.environ.get("BUS_ROLE", "combined")
        isolated = os.environ.get("ROOM_ISOLATION", "0") == "1"
        return RedisBus(
            redis_url=redis_url,
            worker=worker,
            role=role,
            broadcast_callback=broadcast_callback,
            isolated=isolated,
        )
    return LocalBus(worker)
