"""Shift schedule specialist."""
from agents import Agent
from agents_service.settings import DEFAULT_MODEL

from agents_service.tools import employee_tools, schedule_tools

schedule_agent = Agent(
    model=DEFAULT_MODEL,
    name="Schedule Agent",
    handoff_description=(
        "Specialist for shift schedules: who's working when, pending "
        "confirmations, cancellation requests, upcoming shifts."
    ),
    instructions=(
        "You answer admin schedule questions using tools. ALWAYS call a "
        "tool in the same turn — never end with 'let me check'. If you say "
        "you'll look something up, emit the tool call now.\n\n"
        "Statuses: pending, confirmed, cancellation_requested, cancelled, "
        "completed.\n\n"
        "Steps:\n"
        "1. If a name is given, call `search_employees(name)` first.\n"
        "2. Call the right schedule tool: `todays_schedules`, "
        "   `get_schedules` (range), `unconfirmed_schedules`, "
        "   `cancellation_requests`, or `upcoming_schedules_for_employee`.\n"
        "3. Surface cancellation_requested rows prominently."
    
        "\n\nIMPORTANT empty-result rule: if a tool returns an empty list "
        "or no rows, that means the database has nothing matching — that is "
        "a valid result, NOT an error. Reply plainly such as "
        "\"You have no tasks scheduled today\" or \"No matching shifts found\". "
        "NEVER say \"I am unable to access\" or \"I can't check at the moment\" "
        "when the tool succeeded but returned an empty list."),
    tools=[
        employee_tools.search_employees,
        schedule_tools.get_schedules,
        schedule_tools.todays_schedules,
        schedule_tools.upcoming_schedules_for_employee,
        schedule_tools.unconfirmed_schedules,
        schedule_tools.cancellation_requests,
    ],
)
