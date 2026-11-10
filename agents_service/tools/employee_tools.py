"""Employee directory tools.

Tools join `employees` with `profiles` so the agent always sees the email and
display name together — that's the lookup admins ask for in plain English
("what's Maria's email?", "is John still active?").
"""
from __future__ import annotations

from typing import Any

from agents import function_tool

from agents_service import db


@function_tool
async def search_employees(query: str, limit: int = 25) -> list[dict[str, Any]]:
    """Search employees by name, email, position, or phone.

    Args:
        query: Free text. Matches `display_name`, `position`, `phone_number`,
            or the joined profile's `full_name`/`email` (case-insensitive).
        limit: Max rows. Default 25, hard cap 100.
    """
    limit = max(1, min(limit, 100))
    if not query.strip():
        return []
    q = f"%{query.strip()}%"
    rows = await db.select(
        "employees",
        columns="id,display_name,position,phone_number,is_active,shift_type,shift_start,shift_end,profiles(full_name,email,role,status)",
        filters={
            "or": (
                f"(display_name.ilike.{q},"
                f"position.ilike.{q},"
                f"phone_number.ilike.{q})"
            ),
        },
        limit=limit,
    )
    # Fall back to a profile-side search if the employees-side `or` produced nothing
    if not rows:
        rows = await db.select(
            "profiles",
            columns="id,full_name,email,role,status,employees(display_name,position,phone_number,is_active,shift_start,shift_end)",
            filters={
                "or": f"(full_name.ilike.{q},email.ilike.{q})",
            },
            limit=limit,
        )
    return rows


@function_tool
async def get_employee_by_id(employee_id: str) -> dict[str, Any] | None:
    """Full record for one employee, including HR fields and profile."""
    rows = await db.select(
        "employees",
        columns="*,profiles(full_name,email,role,status,created_at)",
        filters={"id": f"eq.{employee_id}"},
        limit=1,
    )
    return rows[0] if rows else None


@function_tool
async def list_employees(
    active_only: bool = True,
    position: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """List employees, optionally filtered to active staff or a single position."""
    limit = max(1, min(limit, 500))
    filters: dict[str, str] = {}
    if active_only:
        filters["is_active"] = "eq.true"
    if position:
        filters["position"] = f"ilike.%{position}%"
    return await db.select(
        "employees",
        columns="id,display_name,position,is_active,shift_type,shift_start,shift_end,phone_number,profiles(full_name,email)",
        filters=filters,
        order="display_name.asc",
        limit=limit,
    )


@function_tool
async def count_employees(active_only: bool = True) -> dict[str, Any]:
    """Quick headcount."""
    filters = {"is_active": "eq.true"} if active_only else {}
    rows = await db.select(
        "employees", columns="id", filters=filters, limit=10000
    )
    return {"count": len(rows), "active_only": active_only}


@function_tool
async def get_employee_businesses(employee_id: str) -> list[dict[str, Any]]:
    """Which businesses (locations) an employee is assigned to."""
    return await db.select(
        "employee_businesses",
        columns="business_id,businesses(id,name,address)",
        filters={"employee_id": f"eq.{employee_id}"},
    )
