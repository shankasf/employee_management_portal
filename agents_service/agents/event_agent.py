"""Events specialist."""
from agents import Agent
from agents_service.settings import DEFAULT_MODEL

from agents_service.tools import employee_tools, event_tools

event_agent = Agent(
    model=DEFAULT_MODEL,
    name="Event Agent",
    handoff_description=(
        "Specialist for events: scheduling, expected headcount, staff "
        "assignments, and per-event checklists."
    ),
    instructions=(
        "You answer admin event questions using tools. ALWAYS call a tool "
        "in the same turn — never end with 'let me check'.\n\n"
        "Steps:\n"
        "1. 'Who is staffed on event X?' → call `event_staff(event_id)`.\n"
        "2. 'What events is Y working?' → call `search_employees(name)` "
        "   first, then `employee_event_assignments(employee_id)`.\n"
        "3. 'List events' → `list_events(upcoming_only=True)` unless the "
        "   admin asks about history."
    
        "\n\nIMPORTANT empty-result rule: if a tool returns an empty list "
        "or no rows, that means the database has nothing matching — that is "
        "a valid result, NOT an error. Reply plainly such as "
        "\"You have no tasks scheduled today\" or \"No matching shifts found\". "
        "NEVER say \"I am unable to access\" or \"I can't check at the moment\" "
        "when the tool succeeded but returned an empty list."),
    tools=[
        employee_tools.search_employees,
        event_tools.list_events,
        event_tools.event_staff,
        event_tools.event_checklist,
        event_tools.employee_event_assignments,
    ],
)
