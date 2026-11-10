"""Shift schedule tools."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from agents import function_tool

from agents_service import db


def _ny_today_iso() -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=5)).date().isoformat()


@function_tool
async def get_schedules(
    employee_id: str | None = None,
    status: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """Schedule rows in a date range, optionally filtered.

    Status values: pending, confirmed, cancellation_requested, cancelled, completed.
    """
    limit = max(1, min(limit, 500))
    filters: dict[str, str] = {}
    if employee_id:
        filters["employee_id"] = f"eq.{employee_id}"
    if status:
        filters["status"] = f"eq.{status}"
    if start_date and end_date:
        filters["and"] = f"(schedule_date.gte.{start_date},schedule_date.lte.{end_date})"
    elif start_date:
        filters["schedule_date"] = f"gte.{start_date}"
    elif end_date:
        filters["schedule_date"] = f"lte.{end_date}"
    return await db.select(
        "schedules",
        columns="id,employee_id,schedule_date,start_time,end_time,title,location,status,confirmed_at,employees(display_name,profiles(full_name,email))",
        filters=filters,
        order="schedule_date.asc",
        limit=limit,
    )


@function_tool
async def todays_schedules() -> list[dict[str, Any]]:
    today = _ny_today_iso()
    return await db.select(
        "schedules",
        columns="id,employee_id,start_time,end_time,title,status,employees(display_name,profiles(full_name,email))",
        filters={"schedule_date": f"eq.{today}"},
        order="start_time.asc",
        limit=300,
    )


@function_tool
async def upcoming_schedules_for_employee(
    employee_id: str, days_ahead: int = 14
) -> list[dict[str, Any]]:
    today = _ny_today_iso()
    end = (datetime.fromisoformat(today) + timedelta(days=days_ahead)).date().isoformat()
    return await db.select(
        "schedules",
        columns="id,schedule_date,start_time,end_time,title,location,status",
        filters={
            "employee_id": f"eq.{employee_id}",
            "and": f"(schedule_date.gte.{today},schedule_date.lte.{end})",
        },
        order="schedule_date.asc",
        limit=200,
    )


@function_tool
async def unconfirmed_schedules() -> list[dict[str, Any]]:
    """Schedules still pending employee confirmation."""
    today = _ny_today_iso()
    return await db.select(
        "schedules",
        columns="id,employee_id,schedule_date,start_time,end_time,status,employees(display_name,profiles(full_name,email))",
        filters={
            "status": "eq.pending",
            "schedule_date": f"gte.{today}",
        },
        order="schedule_date.asc",
        limit=300,
    )


@function_tool
async def cancellation_requests() -> list[dict[str, Any]]:
    """Schedules where the employee asked to cancel and admin hasn't acted yet."""
    return await db.select(
        "schedules",
        columns="id,employee_id,schedule_date,start_time,end_time,cancellation_reason,cancellation_requested_at,employees(display_name,profiles(full_name,email))",
        filters={"status": "eq.cancellation_requested"},
        order="cancellation_requested_at.asc",
        limit=200,
    )
