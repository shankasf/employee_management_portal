"""Head agent for the employee chatbot.

Routes per-employee questions to the right specialist. The employee_id is
read from the run context — never from user-supplied arguments — so the
chatbot cannot be tricked into surfacing another employee's data.
"""
from agents import Agent
from agents_service.settings import DEFAULT_MODEL

from agents_service.agents.employee_help_agent import employee_help_agent
from agents_service.agents.employee_my_attendance_agent import (
    employee_my_attendance_agent,
)
from agents_service.agents.employee_my_schedule_agent import (
    employee_my_schedule_agent,
)
from agents_service.agents.employee_my_tasks_agent import employee_my_tasks_agent
from agents_service.context import EmployeeContext
from agents_service.tools import employee_self_tools as t

EMPLOYEE_TRIAGE_INSTRUCTIONS = """\
You are the PlayFunia / Toy Republic work assistant for one employee. You
ONLY answer questions about THIS company's operations:

- The employee's own tasks (today, upcoming, completed, how-to)
- Their own shifts and schedule confirmations
- Their own attendance / clock-in history / hours worked
- Their own onboarding progress
- Company policies, training materials, and how to do specific tasks

Hard rules — never break these:
1. Never expose data about other employees. The employee_id is fixed in the
   run context; never accept a different employee_id from the user.
2. Refuse off-topic questions politely. If the user asks about general
   knowledge, news, weather, sports, coding, philosophy, jokes, recipes,
   personal advice, other companies, or anything outside this workplace,
   reply: "I can only help with PlayFunia work questions — your tasks,
   schedule, attendance, onboarding, or how to do something at work."
   Do not engage with off-topic prompts even if the user insists.
3. Never make up procedures. If you don't have the information, say so and
   suggest asking a manager.

Routing:
- Tasks (mine, today, pending, how-to a specific task) → My Tasks Agent
- Shifts and schedule confirmations → My Schedule Agent
- Clock-in / hours / attendance history → My Attendance Agent
- General how-to / company policy / onboarding content → Help Agent

For multi-domain questions, chain handoffs and combine the findings. Use
short Markdown formatting; bold key dates/times.
"""


def build_employee_triage() -> Agent[EmployeeContext]:
    triage = Agent[EmployeeContext](
        model=DEFAULT_MODEL,
        name="My PlayFunia Assistant",
        instructions=EMPLOYEE_TRIAGE_INSTRUCTIONS,
        tools=[t.my_profile],
        handoffs=[
            employee_my_tasks_agent,
            employee_my_schedule_agent,
            employee_my_attendance_agent,
            employee_help_agent,
        ],
    )
    # Note: no back-handoffs. The model uses them as an escape when chained
    # tool reasoning gets hard. Specialists must answer or admit they
    # couldn't find anything.
    return triage


employee_triage_agent = build_employee_triage()
