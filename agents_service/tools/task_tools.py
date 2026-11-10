"""Task & task-instance tools."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from agents import function_tool

from agents_service import db


def _ny_today_iso() -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=5)).date().isoformat()


@function_tool
async def list_tasks(
    is_recurring: bool | None = None,
    search: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Task definitions (templates)."""
    limit = max(1, min(limit, 500))
    filters: dict[str, str] = {}
    if is_recurring is not None:
        filters["is_recurring"] = f"eq.{'true' if is_recurring else 'false'}"
    if search:
        filters["or"] = f"(title.ilike.%{search}%,description.ilike.%{search}%)"
    return await db.select(
        "tasks",
        columns="id,title,description,is_recurring,frequency,location,role_target,recurrence_days,assigned_employee_ids,requires_photo,requires_video,requires_notes,created_at",
        filters=filters,
        order="created_at.desc",
        limit=limit,
    )


@function_tool
async def get_task_instances(
    employee_id: str | None = None,
    status: str | None = None,
    scheduled_date: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Task instances (one row per assignment per day).

    Args:
        status: 'pending' | 'completed' | 'overdue'.
        scheduled_date: Single ISO date.
        start_date/end_date: Inclusive ISO date range; ignored if `scheduled_date` is set.
    """
    limit = max(1, min(limit, 500))
    filters: dict[str, str] = {}
    if employee_id:
        filters["employee_id"] = f"eq.{employee_id}"
    if status:
        filters["status"] = f"eq.{status}"
    if scheduled_date:
        filters["scheduled_date"] = f"eq.{scheduled_date}"
    elif start_date and end_date:
        filters["and"] = f"(scheduled_date.gte.{start_date},scheduled_date.lte.{end_date})"
    elif start_date:
        filters["scheduled_date"] = f"gte.{start_date}"
    elif end_date:
        filters["scheduled_date"] = f"lte.{end_date}"
    return await db.select(
        "task_instances",
        columns="id,task_id,employee_id,scheduled_date,status,completed_at,notes,tasks(title,location),employees(display_name,profiles(full_name,email))",
        filters=filters,
        order="scheduled_date.desc",
        limit=limit,
    )


@function_tool
async def todays_pending_tasks() -> list[dict[str, Any]]:
    """All pending task instances scheduled for today."""
    today = _ny_today_iso()
    return await db.select(
        "task_instances",
        columns="id,task_id,employee_id,scheduled_date,status,tasks(title,location),employees(display_name,profiles(full_name,email))",
        filters={"scheduled_date": f"eq.{today}", "status": "eq.pending"},
        limit=500,
    )


@function_tool
async def task_completion_for_employee(
    employee_id: str, start_date: str, end_date: str
) -> dict[str, Any]:
    """Completion summary for one employee over a date range."""
    rows = await db.select(
        "task_instances",
        columns="status,scheduled_date",
        filters={
            "employee_id": f"eq.{employee_id}",
            "and": f"(scheduled_date.gte.{start_date},scheduled_date.lte.{end_date})",
        },
        limit=2000,
    )
    counts = {"pending": 0, "completed": 0, "overdue": 0}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    total = sum(counts.values())
    pct = round(100 * counts["completed"] / total, 1) if total else 0.0
    return {
        "employee_id": employee_id,
        "start_date": start_date,
        "end_date": end_date,
        "total": total,
        "completion_pct": pct,
        **counts,
    }


@function_tool
async def find_overdue_tasks(limit: int = 100) -> list[dict[str, Any]]:
    """Task instances with status = overdue."""
    return await db.select(
        "task_instances",
        columns="id,scheduled_date,employee_id,tasks(title),employees(display_name,profiles(full_name,email))",
        filters={"status": "eq.overdue"},
        order="scheduled_date.asc",
        limit=max(1, min(limit, 500)),
    )
