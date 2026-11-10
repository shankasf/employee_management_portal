"""Attendance / clock-in specialist."""
from agents import Agent
from agents_service.settings import DEFAULT_MODEL

from agents_service.tools import attendance_tools, employee_tools

attendance_agent = Agent(
    model=DEFAULT_MODEL,
    name="Attendance Agent",
    handoff_description=(
        "Specialist for clock-in/out, attendance logs, hours worked, late "
        "arrivals, and currently-clocked-in staff."
    ),
    instructions=(
        "You answer admin attendance questions using tools. ALWAYS call a "
        "tool in the same turn — never end with 'let me check' or "
        "'one moment'. If you need to look something up, do it now via a "
        "tool call.\n\n"
        "Steps:\n"
        "1. If the admin names an employee, call `search_employees(name)` "
        "   to get the id.\n"
        "2. Call the attendance tool that matches the question.\n"
        "3. Answer using the data.\n\n"
        "App timezone is America/New_York. Prefer `total_hours` over "
        "recomputing from timestamps. Always state the date range used."
    
        "\n\nIMPORTANT empty-result rule: if a tool returns an empty list "
        "or no rows, that means the database has nothing matching — that is "
        "a valid result, NOT an error. Reply plainly such as "
        "\"You have no tasks scheduled today\" or \"No matching shifts found\". "
        "NEVER say \"I am unable to access\" or \"I can't check at the moment\" "
        "when the tool succeeded but returned an empty list."),
    tools=[
        employee_tools.search_employees,
        attendance_tools.get_attendance_logs,
        attendance_tools.who_is_clocked_in_now,
        attendance_tools.todays_attendance,
        attendance_tools.get_late_arrivals,
        attendance_tools.total_hours_for_employee,
    ],
)
