"""Onboarding & knowledge specialist."""
from agents import Agent
from agents_service.settings import DEFAULT_MODEL

from agents_service.tools import employee_tools, onboarding_tools

onboarding_agent = Agent(
    model=DEFAULT_MODEL,
    name="Onboarding Agent",
    handoff_description=(
        "Specialist for onboarding content, per-employee progress, and "
        "completion status by business / location."
    ),
    instructions=(
        "You answer admin onboarding questions using tools. ALWAYS call a "
        "tool in the same turn — never end with 'let me check'.\n\n"
        "Three layers:\n"
        "- **content** — videos/docs/articles per business "
        "  (`list_onboarding_content`)\n"
        "- **progress** — per-employee max watched % "
        "  (`employee_onboarding_progress`)\n"
        "- **completions** — row exists only if an employee finished all "
        "  required content for a business "
        "  (`onboarding_completions`, `employees_missing_onboarding`)\n\n"
        "Steps:\n"
        "1. If a name is given, call `search_employees(name)` first.\n"
        "2. For 'has X completed onboarding?' → `onboarding_completions` "
        "   filtered by employee_id.\n"
        "3. For 'who hasn't completed onboarding for Y?' → "
        "   `employees_missing_onboarding(business_id)`."
    
        "\n\nIMPORTANT empty-result rule: if a tool returns an empty list "
        "or no rows, that means the database has nothing matching — that is "
        "a valid result, NOT an error. Reply plainly such as "
        "\"You have no tasks scheduled today\" or \"No matching shifts found\". "
        "NEVER say \"I am unable to access\" or \"I can't check at the moment\" "
        "when the tool succeeded but returned an empty list."),
    tools=[
        employee_tools.search_employees,
        onboarding_tools.list_onboarding_content,
        onboarding_tools.employee_onboarding_progress,
        onboarding_tools.onboarding_completions,
        onboarding_tools.employees_missing_onboarding,
    ],
)
