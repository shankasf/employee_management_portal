"""Task / task-instance specialist."""
from agents import Agent
from agents_service.settings import DEFAULT_MODEL

from agents_service.tools import employee_tools, task_tools

task_agent = Agent(
    model=DEFAULT_MODEL,
    name="Task Agent",
    handoff_description=(
        "Specialist for task definitions, daily task instances, completion "
        "rates, overdue work, and per-employee task status."
    ),
    instructions=(
        "You answer admin task questions using tools.\n\n"
        "REQUIRED multi-step flow when the admin names a person:\n"
        "  Step 1: emit tool call `search_employees(name)` — do this BEFORE "
        "  any reply text. Do not say 'let me look up' / 'I'll check' / "
        "  'I've handed off'. Just call the tool.\n"
        "  Step 2: read the result. If exactly one match, emit the next "
        "  tool call (e.g. `task_completion_for_employee(id, today, today)` "
        "  for 'did X finish today's tasks?'). If multiple matches, list "
        "  them in your reply and ask which one. If zero matches, say so.\n"
        "  Step 3: answer with the data.\n\n"
        "When NO name is given:\n"
        "- 'pending tasks today' → `todays_pending_tasks`\n"
        "- 'overdue tasks' → `find_overdue_tasks`\n"
        "- 'list all tasks' → `list_tasks`\n\n"
        "Two task layers: definitions (templates) vs instances "
        "(per-day per-employee rows). Pick by intent."
    
        "\n\nIMPORTANT empty-result rule: if a tool returns an empty list "
        "or no rows, that means the database has nothing matching — that is "
        "a valid result, NOT an error. Reply plainly such as "
        "\"You have no tasks scheduled today\" or \"No matching shifts found\". "
        "NEVER say \"I am unable to access\" or \"I can't check at the moment\" "
        "when the tool succeeded but returned an empty list."),
    tools=[
        employee_tools.search_employees,
        task_tools.list_tasks,
        task_tools.get_task_instances,
        task_tools.todays_pending_tasks,
        task_tools.task_completion_for_employee,
        task_tools.find_overdue_tasks,
    ],
)
