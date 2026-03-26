"""
Process Manager — spawns and monitors per-room worker subprocesses.

Used when ``BUS_ROLE=gateway`` and ``ROOM_ISOLATION=1`` to give every room
its own OS process.  Each subprocess runs ``room_process.py --room-id <id>``.

The gateway calls ``ensure_worker(room_id)`` before sending the first command
for a room.  A background monitor restarts any worker that crashes.
"""

import asyncio
import os
import subprocess
import sys
from typing import Dict


class ProcessManager:
    def __init__(self, redis_url: str):
        self.redis_url = redis_url
        self._processes: Dict[str, subprocess.Popen] = {}
        self._monitor_task: asyncio.Task | None = None
        self._backend_dir = os.path.dirname(os.path.abspath(__file__))

    # ── public API ──────────────────────────────────────────────────────

    async def ensure_worker(self, room_id: str) -> None:
        """Guarantee a worker process is running for *room_id*."""
        if room_id in self._processes:
            proc = self._processes[room_id]
            if proc.poll() is None:  # still alive
                return
            del self._processes[room_id]

        self._spawn(room_id)

    async def start_monitor(self) -> None:
        """Begin background health-check loop."""
        self._monitor_task = asyncio.create_task(self._monitor_loop())

    async def stop_all(self) -> None:
        """Terminate every managed subprocess."""
        if self._monitor_task:
            self._monitor_task.cancel()
        for room_id, proc in list(self._processes.items()):
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        self._processes.clear()

    # ── internals ───────────────────────────────────────────────────────

    def _spawn(self, room_id: str) -> None:
        env = {**os.environ, "REDIS_URL": self.redis_url}
        proc = subprocess.Popen(
            [
                sys.executable,
                "room_process.py",
                "--room-id",
                room_id,
                "--redis-url",
                self.redis_url,
            ],
            cwd=self._backend_dir,
            env=env,
        )
        self._processes[room_id] = proc
        print(f"[ProcessManager] Spawned worker for room {room_id!r} (pid={proc.pid})")

    async def _monitor_loop(self) -> None:
        """Restart crashed workers every 5 seconds."""
        try:
            while True:
                await asyncio.sleep(5)
                for room_id in list(self._processes):
                    proc = self._processes[room_id]
                    if proc.poll() is not None:
                        print(
                            f"[ProcessManager] Room {room_id!r} worker crashed "
                            f"(exit={proc.returncode}), restarting …"
                        )
                        del self._processes[room_id]
                        self._spawn(room_id)
        except asyncio.CancelledError:
            pass
