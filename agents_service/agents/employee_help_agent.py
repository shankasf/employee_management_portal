"""Employee-scoped: how-to / knowledge.

Currently sources knowledge from three places: (1) the employee's assigned
task definitions (description, location, requirements, reference media),
(2) the onboarding library for businesses they belong to, (3) active company
policies. A future knowledge-base table can be plugged in here later.
"""
from agents import Agent
from agents_service.settings import DEFAULT_MODEL

from agents_service.context import EmployeeContext
from agents_service.tools import employee_self_tools as t

employee_help_agent = Agent[EmployeeContext](
    model=DEFAULT_MODEL,
    name="Help Agent",
    handoff_description=(
        "Specialist for 'how do I…' / 'where do I find…' questions. Pulls "
        "from task descriptions, onboarding videos/articles, and company "
        "policies."
    ),
    instructions=(
        "You help employees figure out how to do something at work using "
        "tools.\n\n"
        "On every turn: call the right tool first, then answer based on what "
        "it returns. Never reply with 'let me check' or meta-text — call now.\n\n"
        "Tool selection:\n"
        "- 'how do I do <task>' → task_details(query)\n"
        "- 'training' / 'video' / 'onboarding' → search_onboarding_content\n"
        "- 'policy' / 'rule' / 'refund' / 'code of conduct' → search_policies\n\n"
        "Quote the source title (task / video / policy name) so the employee "
        "can find the original. If nothing matches, say so honestly and "
        "suggest asking a manager — never invent a procedure."
    
        "\n\nIMPORTANT empty-result rule: if a tool returns an empty list "
        "or no rows, that means the database has nothing matching — that is "
        "a valid result, NOT an error. Reply plainly such as "
        "\"You have no tasks scheduled today\" or \"No matching shifts found\". "
        "NEVER say \"I am unable to access\" or \"I can't check at the moment\" "
        "when the tool succeeded but returned an empty list."),
    tools=[
        t.task_details,
        t.search_onboarding_content,
        t.search_policies,
    ],
)
