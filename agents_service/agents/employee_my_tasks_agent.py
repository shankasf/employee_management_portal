"""Employee-scoped: my tasks."""
from agents import Agent
from agents_service.settings import DEFAULT_MODEL

from agents_service.context import EmployeeContext
from agents_service.tools import employee_self_tools as t

employee_my_tasks_agent = Agent[EmployeeContext](
    model=DEFAULT_MODEL,
    name="My Tasks Agent",
    handoff_description=(
        "Specialist for the employee's own tasks: today's tasks, pending, "
        "overdue, completed, and how-to details on a specific assigned task."
    ),
    instructions=(
        "You answer the employee's task questions using tools.\n\n"
        "On every turn: pick the right tool, CALL IT, then answer using the "
        "result. Never reply with 'let me check' / 'I'll help you' / 'here is "
        "your assistant' — call the tool first.\n\n"
        "Tool selection:\n"
        "- 'today' / 'what do I have' → my_tasks_today\n"
        "- 'pending' / 'overdue' / 'still need to do' → my_pending_tasks\n"
        "- 'finished' / 'completed' / 'last week' → my_completed_tasks\n"
        "- 'how do I…' / 'what does X involve' → task_details(query)\n\n"
        "Format: bold the task title and location. If a tool returns nothing, "
        "say so plainly. Never expose other employees' data."
    
        "\n\nIMPORTANT empty-result rule: if a tool returns an empty list "
        "or no rows, that means the database has nothing matching — that is "
        "a valid result, NOT an error. Reply plainly such as "
        "\"You have no tasks scheduled today\" or \"No matching shifts found\". "
        "NEVER say \"I am unable to access\" or \"I can't check at the moment\" "
        "when the tool succeeded but returned an empty list."),
    tools=[
        t.my_tasks_today,
        t.my_pending_tasks,
        t.my_completed_tasks,
        t.task_details,
    ],
)
