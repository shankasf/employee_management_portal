"""Thin async Supabase REST (PostgREST) client used by every agent tool.

We bypass RLS with the service-role key because the assistant is admin-only and
admin auth is enforced upstream by the Next.js proxy.
"""
from __future__ import annotations

import os
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

_HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Prefer": "count=exact",
}

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=f"{SUPABASE_URL}/rest/v1",
            headers=_HEADERS,
            timeout=20.0,
        )
    return _client


async def select(
    table: str,
    *,
    columns: str = "*",
    filters: dict[str, str] | None = None,
    order: str | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    """Select rows. `filters` values use PostgREST operator syntax,
    e.g. {"role": "eq.admin", "created_at": "gte.2026-01-01"}.
    """
    params: dict[str, str] = {"select": columns}
    if filters:
        params.update(filters)
    if order:
        params["order"] = order
    if limit is not None:
        params["limit"] = str(limit)

    r = await _get_client().get(f"/{table}", params=params)
    r.raise_for_status()
    return r.json()


async def rpc(fn: str, payload: dict[str, Any] | None = None) -> Any:
    r = await _get_client().post(f"/rpc/{fn}", json=payload or {})
    r.raise_for_status()
    return r.json()
