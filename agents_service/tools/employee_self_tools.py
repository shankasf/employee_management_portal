"""Employee-scoped tools.

Every tool reads `employee_id` from the run context (`RunContextWrapper`) —
NOT from a tool argument — so an employee cannot ask the agent to look up
someone else's data. The tools return only rows the employee owns.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from agents import RunContextWrapper, function_tool

from agents_service import db
from agents_service.context import EmployeeContext


def _ny_today_iso() -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=5)).date().isoformat()


# ───────────────────────── Profile / general ─────────────────────────
@function_tool
async def my_profile(ctx: RunContextWrapper[EmployeeContext]) -> dict[str, Any] | None:
    """Your own employee profile — name, position, shift, business assignments."""
    rows = await db.select(
        "employees",
        columns="id,display_name,position,shift_type,shift_start,shift_end,phone_number,profiles(full_name,email),employee_businesses(business_id,businesses(id,name))",
        filters={"id": f"eq.{ctx.context.employee_id}"},
        limit=1,
    )
    return rows[0] if rows else None


# ───────────────────────── Tasks ─────────────────────────
@function_tool
async def my_tasks_today(
    ctx: RunContextWrapper[EmployeeContext],
) -> list[dict[str, Any]]:
    """Tasks scheduled for you today (all statuses)."""
    return await db.select(
        "task_instances",
        columns="id,task_id,scheduled_date,status,completed_at,notes,tasks(title,description,location,role_target,requires_photo,requires_video,requires_notes,reference_images,reference_videos)",
        filters={
            "employee_id": f"eq.{ctx.context.employee_id}",
            "scheduled_date": f"eq.{_ny_today_iso()}",
        },
        order="status.asc",
        limit=100,
    )


@function_tool
async def my_pending_tasks(
    ctx: RunContextWrapper[EmployeeContext],
) -> list[dict[str, Any]]:
    """Your task instances with status = pending or overdue (any date)."""
    return await db.select(
        "task_instances",
        columns="id,scheduled_date,status,tasks(title,description,location)",
        filters={
            "employee_id": f"eq.{ctx.context.employee_id}",
            "status": "in.(pending,overdue)",
        },
        order="scheduled_date.asc",
        limit=100,
    )


@function_tool
async def my_completed_tasks(
    ctx: RunContextWrapper[EmployeeContext],
    days_back: int = 7,
) -> list[dict[str, Any]]:
    """Tasks you completed in the last N days (default 7)."""
    days_back = max(1, min(days_back, 60))
    today = _ny_today_iso()
    start = (datetime.fromisoformat(today) - timedelta(days=days_back)).date().isoformat()
    return await db.select(
        "task_instances",
        columns="id,scheduled_date,completed_at,tasks(title,location)",
        filters={
            "employee_id": f"eq.{ctx.context.employee_id}",
            "status": "eq.completed",
            "and": f"(scheduled_date.gte.{start},scheduled_date.lte.{today})",
        },
        order="completed_at.desc",
        limit=200,
    )


@function_tool
async def task_details(
    ctx: RunContextWrapper[EmployeeContext],
    task_title_query: str,
) -> list[dict[str, Any]]:
    """How-to details for a task assigned to you. Returns the task description,
    location, role target, requirements (photo/video/notes), and reference
    image/video URLs an employee can review.

    Use this for "how do I do X?" — you only see tasks the employee is
    actually assigned to (today, upcoming, or recently completed)."""
    if not task_title_query.strip():
        return []
    q = f"%{task_title_query.strip()}%"
    today = _ny_today_iso()
    start = (datetime.fromisoformat(today) - timedelta(days=14)).date().isoformat()
    end = (datetime.fromisoformat(today) + timedelta(days=14)).date().isoformat()
    return await db.select(
        "task_instances",
        columns="scheduled_date,status,tasks(id,title,description,location,role_target,requires_photo,requires_video,requires_notes,reference_images,reference_videos)",
        filters={
            "employee_id": f"eq.{ctx.context.employee_id}",
            "and": f"(scheduled_date.gte.{start},scheduled_date.lte.{end})",
            "tasks.title": f"ilike.{q}",
        },
        order="scheduled_date.desc",
        limit=10,
    )


# ───────────────────────── Schedule ─────────────────────────
@function_tool
async def my_upcoming_schedule(
    ctx: RunContextWrapper[EmployeeContext],
    days_ahead: int = 14,
) -> list[dict[str, Any]]:
    """Your upcoming shifts in the next N days (default 14)."""
    days_ahead = max(1, min(days_ahead, 60))
    today = _ny_today_iso()
    end = (datetime.fromisoformat(today) + timedelta(days=days_ahead)).date().isoformat()
    return await db.select(
        "schedules",
        columns="id,schedule_date,start_time,end_time,title,location,status",
        filters={
            "employee_id": f"eq.{ctx.context.employee_id}",
            "and": f"(schedule_date.gte.{today},schedule_date.lte.{end})",
        },
        order="schedule_date.asc",
        limit=100,
    )


@function_tool
async def my_pending_confirmations(
    ctx: RunContextWrapper[EmployeeContext],
) -> list[dict[str, Any]]:
    """Shifts assigned to you that you haven't confirmed yet."""
    return await db.select(
        "schedules",
        columns="id,schedule_date,start_time,end_time,title,location",
        filters={
            "employee_id": f"eq.{ctx.context.employee_id}",
            "status": "eq.pending",
            "schedule_date": f"gte.{_ny_today_iso()}",
        },
        order="schedule_date.asc",
        limit=50,
    )


# ───────────────────────── Attendance ─────────────────────────
@function_tool
async def my_recent_attendance(
    ctx: RunContextWrapper[EmployeeContext],
    days_back: int = 14,
) -> list[dict[str, Any]]:
    """Your attendance logs from the last N days (default 14)."""
    days_back = max(1, min(days_back, 90))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days_back)).isoformat()
    return await db.select(
        "attendance_logs",
        columns="id,clock_in,clock_out,total_hours,late_flag,break_minutes,clock_in_location_name",
        filters={
            "employee_id": f"eq.{ctx.context.employee_id}",
            "clock_in": f"gte.{cutoff}",
        },
        order="clock_in.desc",
        limit=100,
    )


@function_tool
async def my_hours_summary(
    ctx: RunContextWrapper[EmployeeContext],
    start_date: str,
    end_date: str,
) -> dict[str, Any]:
    """Total hours you worked between two ISO dates (closed shifts only)."""
    rows = await db.select(
        "attendance_logs",
        columns="total_hours,clock_in",
        filters={
            "employee_id": f"eq.{ctx.context.employee_id}",
            "and": f"(clock_in.gte.{start_date}T00:00:00Z,clock_in.lte.{end_date}T23:59:59Z)",
        },
        limit=500,
    )
    total = sum((r.get("total_hours") or 0) for r in rows)
    return {
        "start_date": start_date,
        "end_date": end_date,
        "shifts": len(rows),
        "total_hours": round(total, 2),
    }


@function_tool
async def am_i_clocked_in(ctx: RunContextWrapper[EmployeeContext]) -> dict[str, Any]:
    """True iff you have an open attendance row (no clock_out)."""
    rows = await db.select(
        "attendance_logs",
        columns="id,clock_in,clock_in_location_name",
        filters={
            "employee_id": f"eq.{ctx.context.employee_id}",
            "clock_out": "is.null",
        },
        order="clock_in.desc",
        limit=1,
    )
    if rows:
        return {"clocked_in": True, "since": rows[0]["clock_in"], "location": rows[0].get("clock_in_location_name")}
    return {"clocked_in": False}


# ───────────────────────── Onboarding / knowledge ─────────────────────────
@function_tool
async def my_onboarding_progress(
    ctx: RunContextWrapper[EmployeeContext],
) -> list[dict[str, Any]]:
    """Your onboarding progress per content item."""
    return await db.select(
        "onboarding_progress",
        columns="content_id,max_watched_pct,completed_at,onboarding_content(title,type,is_required,businesses(name))",
        filters={"employee_id": f"eq.{ctx.context.employee_id}"},
        order="updated_at.desc",
        limit=200,
    )


@function_tool
async def search_onboarding_content(
    ctx: RunContextWrapper[EmployeeContext],
    query: str,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """Search onboarding videos / documents / articles by title or description.
    Restricted to the businesses the employee is assigned to."""
    if not query.strip():
        return []
    limit = max(1, min(limit, 25))
    # Resolve which businesses the employee belongs to.
    biz_rows = await db.select(
        "employee_businesses",
        columns="business_id",
        filters={"employee_id": f"eq.{ctx.context.employee_id}"},
        limit=20,
    )
    biz_ids = [str(r["business_id"]) for r in biz_rows]
    if not biz_ids:
        return []
    q = f"%{query.strip()}%"
    return await db.select(
        "onboarding_content",
        columns="id,business_id,type,title,description,is_required,duration_seconds,businesses(name)",
        filters={
            "business_id": f"in.({','.join(biz_ids)})",
            "or": f"(title.ilike.{q},description.ilike.{q},content_text.ilike.{q})",
        },
        order="business_id.asc,sort_order.asc",
        limit=limit,
    )


@function_tool
async def search_policies(query: str, limit: int = 10) -> list[dict[str, Any]]:
    """Search active company policies by title or content."""
    if not query.strip():
        return []
    limit = max(1, min(limit, 25))
    q = f"%{query.strip()}%"
    return await db.select(
        "policy_strips",
        columns="id,title,content,category,media_type",
        filters={
            "is_active": "eq.true",
            "or": f"(title.ilike.{q},content.ilike.{q},category.ilike.{q})",
        },
        order="created_at.desc",
        limit=limit,
    )
