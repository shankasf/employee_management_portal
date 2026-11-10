"""Employee-scoped: my attendance & hours."""
from agents import Agent
from agents_service.settings import DEFAULT_MODEL

from agents_service.context import EmployeeContext
from agents_service.tools import employee_self_tools as t

employee_my_attendance_agent = Agent[EmployeeContext](
    model=DEFAULT_MODEL,
    name="My Attendance Agent",
    handoff_description=(
        "Specialist for the employee's clock-in/out history, hours worked, "
        "and whether they're currently on the clock."
    ),
    instructions=(
        "You answer the employee's attendance / hours questions using tools.\n\n"
        "On every turn: call the right tool first, then answer. Never reply "
        "with 'I'll check' or 'connecting you' — call the tool now.\n\n"
        "Tool selection:\n"
        "- 'am I clocked in' / 'on the clock' → am_i_clocked_in\n"
        "- 'recent shifts' / 'my hours' → my_recent_attendance\n"
        "- 'how many hours' between two dates → my_hours_summary(start, end)\n\n"
        "Always state the date range you queried. Never expose other "
        "employees' data."
    
        "\n\nIMPORTANT empty-result rule: if a tool returns an empty list "
        "or no rows, that means the database has nothing matching — that is "
        "a valid result, NOT an error. Reply plainly such as "
        "\"You have no tasks scheduled today\" or \"No matching shifts found\". "
        "NEVER say \"I am unable to access\" or \"I can't check at the moment\" "
        "when the tool succeeded but returned an empty list."),
    tools=[
        t.am_i_clocked_in,
        t.my_recent_attendance,
        t.my_hours_summary,
    ],
)
