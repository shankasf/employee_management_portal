"""Employee-scoped: my schedule."""
from agents import Agent
from agents_service.settings import DEFAULT_MODEL

from agents_service.context import EmployeeContext
from agents_service.tools import employee_self_tools as t

employee_my_schedule_agent = Agent[EmployeeContext](
    model=DEFAULT_MODEL,
    name="My Schedule Agent",
    handoff_description=(
        "Specialist for the employee's own shift schedule: upcoming shifts "
        "and pending confirmations they still owe."
    ),
    instructions=(
        "You answer the employee's schedule questions using tools.\n\n"
        "On every turn: call the right tool first, then answer with the data. "
        "Never say 'let me look' or 'I'll connect you' — call the tool now.\n\n"
        "Tool selection:\n"
        "- 'next shift' / 'when do I work' / 'this week' → my_upcoming_schedule\n"
        "- 'need to confirm' / 'unconfirmed' → my_pending_confirmations\n\n"
        "Format dates as 'Mon, May 5' and times as 'h:MM AM/PM'. Never expose "
        "other employees' schedules."
    
        "\n\nIMPORTANT empty-result rule: if a tool returns an empty list "
        "or no rows, that means the database has nothing matching — that is "
        "a valid result, NOT an error. Reply plainly such as "
        "\"You have no tasks scheduled today\" or \"No matching shifts found\". "
        "NEVER say \"I am unable to access\" or \"I can't check at the moment\" "
        "when the tool succeeded but returned an empty list."),
    tools=[
        t.my_upcoming_schedule,
        t.my_pending_confirmations,
    ],
)
