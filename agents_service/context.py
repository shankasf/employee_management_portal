"""Per-request context objects passed to tools via RunContextWrapper.

The Next.js proxy authenticates the user and injects a verified employee_id
into the request header. The FastAPI handler builds an `EmployeeContext` and
passes it to `Runner.run`. Tools then read `ctx.context.employee_id` instead
of accepting it as a parameter — that way an employee-scoped agent cannot be
tricked into querying someone else's data via prompt injection.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class EmployeeContext:
    employee_id: str
    full_name: str | None = None
