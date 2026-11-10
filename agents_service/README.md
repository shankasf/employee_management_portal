# PlayFunia Admin Agents

Multi-agent assistant powered by the OpenAI Agents SDK
(<https://openai.github.io/openai-agents-python/>). Admin-only — auth is
enforced by the Next.js proxy at `/api/admin/assistant`; this service trusts
the proxy via a shared `X-Proxy-Secret` header.

## Layout

```
agents_service/
├── server.py              # FastAPI entry — POST /chat, GET /health
├── db.py                  # Async Supabase REST client (service role)
├── agents/
│   ├── triage_agent.py    # Head agent — routes via handoffs
│   ├── employee_agent.py  # Employee directory specialist
│   ├── attendance_agent.py
│   ├── task_agent.py
│   ├── schedule_agent.py
│   ├── onboarding_agent.py
│   └── event_agent.py
└── tools/                 # @function_tool wrappers (one file per domain)
    ├── employee_tools.py
    ├── attendance_tools.py
    ├── task_tools.py
    ├── schedule_tools.py
    ├── onboarding_tools.py
    └── event_tools.py
```

The triage agent inspects each admin question and hands off to the right
specialist. Specialists can bounce back to triage if the question turns out
to belong to a different domain. Each specialist gets only the tools it
needs — clear separation of responsibilities, easy to extend.

## Setup

```bash
cd agents_service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in OPENAI_API_KEY + AGENT_PROXY_SECRET
```

The Supabase URL / service-role key in `.env.example` already match the main
app; only `OPENAI_API_KEY` and `AGENT_PROXY_SECRET` need to be set.

## Run

From the repo root (one directory above `agents_service`):

```bash
python -m agents_service.server
```

Defaults to `127.0.0.1:8088`. Add the same `AGENT_PROXY_SECRET` value to the
Next.js `.env.local` so the proxy can reach the service.
