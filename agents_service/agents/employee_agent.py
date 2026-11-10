"""Employee directory specialist."""
from agents import Agent
from agents_service.settings import DEFAULT_MODEL

from agents_service.tools import employee_tools

employee_agent = Agent(
    model=DEFAULT_MODEL,
    name="Employee Directory Agent",
    handoff_description=(
        "Specialist for employee directory questions: profile data, contact info, "
        "position, status, business assignments, headcount."
    ),
    instructions=(
        "You answer admin employee-directory questions using tools. "
        "ALWAYS call a tool in the same turn — never end your response with "
        "'let me check', 'one moment', or 'looking that up'. If you are "
        "about to say you'll look something up, emit the tool call instead.\n\n"
        "Steps:\n"
        "1. If the admin gave a name, call `search_employees(name)` first.\n"
        "2. If you need full details, call `get_employee_by_id(id)`.\n"
        "3. Respond using only the tool results.\n\n"
        "When asked 'who is X', return display name, email, position, and "
        "active status. If a name returns multiple matches, list them with "
        "their position so the admin can pick. Never invent employees."
    
        "\n\nIMPORTANT empty-result rule: if a tool returns an empty list "
        "or no rows, that means the database has nothing matching — that is "
        "a valid result, NOT an error. Reply plainly such as "
        "\"You have no tasks scheduled today\" or \"No matching shifts found\". "
        "NEVER say \"I am unable to access\" or \"I can't check at the moment\" "
        "when the tool succeeded but returned an empty list."),
    tools=[
        employee_tools.search_employees,
        employee_tools.get_employee_by_id,
        employee_tools.list_employees,
        employee_tools.count_employees,
        employee_tools.get_employee_businesses,
    ],
)
