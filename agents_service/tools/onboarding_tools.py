"""Onboarding & knowledge-base tools."""
from __future__ import annotations

from typing import Any

from agents import function_tool

from agents_service import db


@function_tool
async def list_onboarding_content(
    business_id: int | None = None,
    required_only: bool = False,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Onboarding content items (videos / documents / articles)."""
    limit = max(1, min(limit, 500))
    filters: dict[str, str] = {}
    if business_id is not None:
        filters["business_id"] = f"eq.{business_id}"
    if required_only:
        filters["is_required"] = "eq.true"
    return await db.select(
        "onboarding_content",
        columns="id,business_id,type,title,description,is_required,duration_seconds,sort_order,created_at,businesses(name)",
        filters=filters,
        order="business_id.asc,sort_order.asc",
        limit=limit,
    )


@function_tool
async def employee_onboarding_progress(employee_id: str) -> list[dict[str, Any]]:
    """Per-content progress rows for one employee."""
    return await db.select(
        "onboarding_progress",
        columns="content_id,max_watched_pct,completed_at,onboarding_content(title,type,is_required,business_id,businesses(name))",
        filters={"employee_id": f"eq.{employee_id}"},
        order="updated_at.desc",
        limit=500,
    )


@function_tool
async def onboarding_completions(
    business_id: int | None = None,
    acknowledged: bool | None = None,
    employee_id: str | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """Per-employee per-business completion records.

    Use this to answer "who has finished onboarding?" or "any unacknowledged
    completions I should review?".
    """
    limit = max(1, min(limit, 500))
    filters: dict[str, str] = {}
    if business_id is not None:
        filters["business_id"] = f"eq.{business_id}"
    if employee_id:
        filters["employee_id"] = f"eq.{employee_id}"
    if acknowledged is not None:
        filters["acknowledged_by_admin"] = f"eq.{'true' if acknowledged else 'false'}"
    return await db.select(
        "onboarding_completions",
        columns="id,employee_id,business_id,completed_at,acknowledged_by_admin,businesses(name),employees(display_name,profiles(full_name,email))",
        filters=filters,
        order="completed_at.desc",
        limit=limit,
    )


@function_tool
async def employees_missing_onboarding(business_id: int) -> dict[str, Any]:
    """Active employees assigned to `business_id` who haven't completed onboarding."""
    assigned = await db.select(
        "employee_businesses",
        columns="employee_id,employees(display_name,is_active,profiles(full_name,email))",
        filters={"business_id": f"eq.{business_id}"},
        limit=1000,
    )
    active_ids = {
        r["employee_id"]
        for r in assigned
        if (r.get("employees") or {}).get("is_active")
    }
    completed_rows = await db.select(
        "onboarding_completions",
        columns="employee_id",
        filters={"business_id": f"eq.{business_id}"},
        limit=1000,
    )
    completed_ids = {r["employee_id"] for r in completed_rows}
    missing = [r for r in assigned if r["employee_id"] in active_ids - completed_ids]
    return {
        "business_id": business_id,
        "assigned_active": len(active_ids),
        "completed": len(active_ids & completed_ids),
        "missing_count": len(missing),
        "missing": missing,
    }
