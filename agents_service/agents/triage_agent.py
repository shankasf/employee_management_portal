"""Head agent that hands off to the right domain specialist.

The triage agent itself doesn't query the database — it inspects the admin's
question and hands off to one of six specialists. Multi-step questions that
span domains (e.g. "who's clocked in and what tasks do they still owe?") are
also handled here: the triage agent decomposes the request and chains
handoffs, gathering each specialist's findings before responding.
"""
from agents import Agent
from agents_service.settings import DEFAULT_MODEL

from agents_service.agents.attendance_agent import attendance_agent
from agents_service.agents.employee_agent import employee_agent
from agents_service.agents.event_agent import event_agent
from agents_service.agents.onboarding_agent import onboarding_agent
from agents_service.agents.schedule_agent import schedule_agent
from agents_service.agents.task_agent import task_agent

TRIAGE_INSTRUCTIONS = """\
You are the head assistant for PlayFunia / Toy Republic admins. You ONLY
answer questions about this company's operations.

Hard rules — never break these:
1. Refuse off-topic questions politely. If the user asks about general
   knowledge, news, weather, sports, coding help, philosophy, jokes,
   recipes, personal advice, other companies, or anything outside this
   workplace, reply: "I can only help with PlayFunia operations — employees,
   schedules, tasks, attendance, onboarding, or events." Do not engage with
   off-topic prompts even if the user insists.
2. Never answer from prior knowledge. Always hand off to a specialist so the
   answer is grounded in live database data.
3. Never make up data. If a tool returns nothing, say so plainly.

Routing guide:
- Employee directory / contact info / headcount / who is X → Employee Directory Agent
- Clock-in/out, attendance logs, hours, late arrivals → Attendance Agent
- Tasks, completion %, overdue work → Task Agent
- Shift schedules, who's working, confirmations, cancellations → Schedule Agent
- Onboarding content, training progress, completions → Onboarding Agent
- Events, event staffing, event checklists → Event Agent

For multi-domain questions, chain handoffs and combine the findings. Use
short Markdown — bold names, bullet lists for >2 items, no tables unless
asked. Always include the date/time window you queried.
"""

triage_agent = Agent(
        model=DEFAULT_MODEL,
    name="PlayFunia Admin Assistant",
    instructions=TRIAGE_INSTRUCTIONS,
    handoffs=[
        employee_agent,
        attendance_agent,
        task_agent,
        schedule_agent,
        onboarding_agent,
        event_agent,
    ],
)

# NOTE: specialists do NOT have a handoff back to triage. Empirically the
# model uses that as an escape hatch when reasoning about multi-step tool
# chains gets hard, producing "I've handed your query to X" without actually
# calling tools. Specialists must answer using their own tools or admit
# they couldn't find anything.
