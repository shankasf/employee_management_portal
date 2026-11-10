"""Event tools — events, staff assignments, and event checklists."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from agents import function_tool

from agents_service import db


def _ny_today_iso() -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=5)).date().isoformat()


@function_tool
async def list_events(
    start_date: str | None = None,
    end_date: str | None = None,
    upcoming_only: bool = False,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Events filtered by date."""
    limit = max(1, min(limit, 500))
    filters: dict[str, str] = {}
    if upcoming_only:
        today = _ny_today_iso()
        filters["start_time"] = f"gte.{today}T00:00:00Z"
    elif start_date and end_date:
        filters["and"] = f"(start_time.gte.{start_date}T00:00:00Z,start_time.lte.{end_date}T23:59:59Z)"
    elif start_date:
        filters["start_time"] = f"gte.{start_date}T00:00:00Z"
    elif end_date:
        filters["start_time"] = f"lte.{end_date}T23:59:59Z"
    return await db.select(
        "events",
        columns="id,title,start_time,end_time,room,expected_headcount,notes",
        filters=filters,
        order="start_time.asc",
        limit=limit,
    )


@function_tool
async def event_staff(event_id: str) -> list[dict[str, Any]]:
    """Who is assigned to an event."""
    return await db.select(
        "event_staff_assignments",
        columns="employee_id,role,employees(display_name,profiles(full_name,email))",
        filters={"event_id": f"eq.{event_id}"},
        limit=200,
    )


@function_tool
async def event_checklist(event_id: str) -> list[dict[str, Any]]:
    """Checklist items for one event with completion status."""
    return await db.select(
        "event_checklists",
        columns="id,task_title,status,completed_by,completed_at",
        filters={"event_id": f"eq.{event_id}"},
        order="created_at.asc",
        limit=200,
    )


@function_tool
async def employee_event_assignments(
    employee_id: str, upcoming_only: bool = True
) -> list[dict[str, Any]]:
    """Events one employee is staffed on."""
    rows = await db.select(
        "event_staff_assignments",
        columns="role,events(id,title,start_time,end_time,room)",
        filters={"employee_id": f"eq.{employee_id}"},
        limit=200,
    )
    if upcoming_only:
        today = _ny_today_iso()
        rows = [r for r in rows if (r.get("events") or {}).get("start_time", "") >= today]
    return rows
