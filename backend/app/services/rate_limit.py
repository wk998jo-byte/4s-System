"""Simple in-process rate limiter for sensitive auth endpoints.

Not a substitute for edge/WAF rate limiting in multi-instance production.
Documented deployment requirement: use a shared limiter (Redis) or reverse-proxy
limits when running more than one worker.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


class SlidingWindowLimiter:
    def __init__(self, max_events: int, window_seconds: float) -> None:
        self.max_events = max(1, int(max_events))
        self.window_seconds = float(window_seconds)
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            bucket = self._events[key]
            cutoff = now - self.window_seconds
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= self.max_events:
                raise HTTPException(
                    status_code=429,
                    detail="Too many attempts. Please wait and try again.",
                )
            bucket.append(now)


_auth_limiter: SlidingWindowLimiter | None = None
_limiter_lock = threading.Lock()


def auth_limiter(max_per_minute: int) -> SlidingWindowLimiter:
    global _auth_limiter
    with _limiter_lock:
        if _auth_limiter is None or _auth_limiter.max_events != max_per_minute:
            _auth_limiter = SlidingWindowLimiter(max_per_minute, 60.0)
        return _auth_limiter


def client_key(request: Request, *parts: str) -> str:
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    host = forwarded or (request.client.host if request.client else "unknown")
    return "|".join([host, *[p.strip().lower() for p in parts if p]])
