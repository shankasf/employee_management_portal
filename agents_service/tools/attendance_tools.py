"""Attendance / clock-in tools."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from agents import function_tool

from agents_service import db


def _ny_today_iso() -> str:
    # The app uses America/New_York. UTC-5 is "good enough" for date filtering at
    # the level of granularity admins ask about (today / yesterday / this week);
    # the database stores UTC timestamps, so we err on the inclusive side.
    return (datetime.now(timezone.utc) - timedelta(hours=5)).date().isoformat()


@function_tool
async def get_attendance_logs(
    employee_id: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    only_open: bool = False,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Return attendance rows joined with employee name.

    Args:
        employee_id: Limit to one employee.
        start_date / end_date: ISO `YYYY-MM-DD`. Filters `clock_in`.
        only_open: True to return rows where the employee hasn't clocked out yet.
        limit: Max rows. Default 100, cap 500.
    """
    limit = max(1, min(limit, 500))
    filters: dict[str, str] = {}
    if employee_id:
        filters["employee_id"] = f"eq.{employee_id}"
    # PostgREST can't repeat the same column key in a query string — use `and=`
    # for date ranges that need both sides.
    if start_date and end_date:
        filters["and"] = (
            f"(clock_in.gte.{start_date}T00:00:00Z,"
            f"clock_in.lte.{end_date}T23:59:59Z)"
        )
    elif start_date:
        filters["clock_in"] = f"gte.{start_date}T00:00:00Z"
    elif end_date:
        filters["clock_in"] = f"lte.{end_date}T23:59:59Z"
    if only_open:
        filters["clock_out"] = "is.null"

    return await db.select(
        "attendance_logs",
        columns="id,employee_id,clock_in,clock_out,total_hours,late_flag,early_checkout_flag,break_minutes,clock_in_location_name,clock_out_location_name,employees(display_name,profiles(full_name,email))",
        filters=filters,
        order="clock_in.desc",
        limit=limit,
    )


@function_tool
async def who_is_clocked_in_now() -> list[dict[str, Any]]:
    """Currently clocked-in employees (open attendance rows)."""
    return await db.select(
        "attendance_logs",
        columns="id,employee_id,clock_in,clock_in_location_name,employees(display_name,profiles(full_name,email))",
        filters={"clock_out": "is.null"},
        order="clock_in.desc",
        limit=200,
    )


@function_tool
async def todays_attendance() -> list[dict[str, Any]]:
    """Everyone who clocked in today (NY time)."""
    today = _ny_today_iso()
    return await db.select(
        "attendance_logs",
        columns="id,employee_id,clock_in,clock_out,total_hours,late_flag,employees(display_name,profiles(full_name,email))",
        filters={"clock_in": f"gte.{today}T00:00:00Z"},
        order="clock_in.desc",
        limit=300,
    )


@function_tool
async def get_late_arrivals(start_date: str, end_date: str) -> list[dict[str, Any]]:
    """Rows flagged `late_flag = true` in a date range."""
    return await db.select(
        "attendance_logs",
        columns="employee_id,clock_in,total_hours,employees(display_name,profiles(full_name,email))",
        filters={
            "late_flag": "eq.true",
            "and": f"(clock_in.gte.{start_date}T00:00:00Z,clock_in.lte.{end_date}T23:59:59Z)",
        },
        order="clock_in.desc",
        limit=500,
    )


@function_tool
async def total_hours_for_employee(
    employee_id: str, start_date: str, end_date: str
) -> dict[str, Any]:
    """Sum of `total_hours` (closed shifts only) for one employee in a range."""
    rows = await db.select(
        "attendance_logs",
        columns="total_hours,clock_in",
        filters={
            "employee_id": f"eq.{employee_id}",
            "and": f"(clock_in.gte.{start_date}T00:00:00Z,clock_in.lte.{end_date}T23:59:59Z)",
        },
        limit=1000,
    )
    total = sum((r.get("total_hours") or 0) for r in rows)
    return {
        "employee_id": employee_id,
        "start_date": start_date,
        "end_date": end_date,
        "shift_count": len(rows),
        "total_hours": round(total, 2),
    }
