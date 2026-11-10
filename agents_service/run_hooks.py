"""Run hooks that emit one structured JSON log line per agent event.

Every line is prefixed with `[AGENT]` and includes:
  - request_id (propagated through one Runner.run call)
  - mode (admin / employee)
  - employee_id (when present)
  - event (request_start | agent_start | handoff | tool_call | tool_result |
           agent_end | final | error)
  - elapsed_ms

This makes it easy to grep `pm2 logs playfunia-agents | grep '\\[AGENT\\]'` and
see the full life-cycle of a chat turn.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from agents import Agent, RunContextWrapper, RunHooks, Tool

log = logging.getLogger("agents")
log.setLevel(logging.INFO)


def _emit(payload: dict[str, Any]) -> None:
    try:
        log.info("[AGENT] " + json.dumps(payload, ensure_ascii=False, default=str))
    except Exception:  # pragma: no cover — logging must never break a request
        pass


def _truncate(value: Any, limit: int = 400) -> str:
    s = str(value)
    return s if len(s) <= limit else s[: limit - 1] + "…"


@dataclass
class RunMeta:
    request_id: str
    mode: str  # "admin" | "employee"
    employee_id: str | None = None
    started_at: float = field(default_factory=time.monotonic)
    tool_calls: int = 0
    handoffs: int = 0

    def elapsed_ms(self) -> int:
        return int((time.monotonic() - self.started_at) * 1000)


class LoggingRunHooks(RunHooks):
    """Logs every agent boundary, handoff, and tool call.

    `meta` is closure-captured by `with_meta(meta)` and shared across all hook
    callbacks for one Runner.run invocation.
    """

    def __init__(self, meta: RunMeta):
        super().__init__()
        self.meta = meta

    async def on_agent_start(
        self, context: RunContextWrapper[Any], agent: Agent[Any]
    ) -> None:
        _emit(
            {
                "event": "agent_start",
                "request_id": self.meta.request_id,
                "mode": self.meta.mode,
                "employee_id": self.meta.employee_id,
                "agent": agent.name,
                "elapsed_ms": self.meta.elapsed_ms(),
            }
        )

    async def on_agent_end(
        self,
        context: RunContextWrapper[Any],
        agent: Agent[Any],
        output: Any,
    ) -> None:
        _emit(
            {
                "event": "agent_end",
                "request_id": self.meta.request_id,
                "mode": self.meta.mode,
                "agent": agent.name,
                "preview": _truncate(output, 240),
                "elapsed_ms": self.meta.elapsed_ms(),
            }
        )

    async def on_handoff(
        self,
        context: RunContextWrapper[Any],
        from_agent: Agent[Any],
        to_agent: Agent[Any],
    ) -> None:
        self.meta.handoffs += 1
        _emit(
            {
                "event": "handoff",
                "request_id": self.meta.request_id,
                "mode": self.meta.mode,
                "from": from_agent.name,
                "to": to_agent.name,
                "elapsed_ms": self.meta.elapsed_ms(),
            }
        )

    async def on_tool_start(
        self,
        context: RunContextWrapper[Any],
        agent: Agent[Any],
        tool: Tool,
    ) -> None:
        self.meta.tool_calls += 1
        _emit(
            {
                "event": "tool_call",
                "request_id": self.meta.request_id,
                "mode": self.meta.mode,
                "agent": agent.name,
                "tool": getattr(tool, "name", str(tool)),
                "elapsed_ms": self.meta.elapsed_ms(),
            }
        )

    async def on_tool_end(
        self,
        context: RunContextWrapper[Any],
        agent: Agent[Any],
        tool: Tool,
        result: str,
    ) -> None:
        _emit(
            {
                "event": "tool_result",
                "request_id": self.meta.request_id,
                "mode": self.meta.mode,
                "agent": agent.name,
                "tool": getattr(tool, "name", str(tool)),
                "preview": _truncate(result, 240),
                "elapsed_ms": self.meta.elapsed_ms(),
            }
        )


def request_started(meta: RunMeta, message: str) -> None:
    _emit(
        {
            "event": "request_start",
            "request_id": meta.request_id,
            "mode": meta.mode,
            "employee_id": meta.employee_id,
            "message": _truncate(message, 200),
        }
    )


def request_finished(meta: RunMeta, reply: str, last_agent: str) -> None:
    _emit(
        {
            "event": "final",
            "request_id": meta.request_id,
            "mode": meta.mode,
            "last_agent": last_agent,
            "tool_calls": meta.tool_calls,
            "handoffs": meta.handoffs,
            "preview": _truncate(reply, 240),
            "elapsed_ms": meta.elapsed_ms(),
        }
    )


def request_failed(meta: RunMeta, exc: BaseException) -> None:
    _emit(
        {
            "event": "error",
            "request_id": meta.request_id,
            "mode": meta.mode,
            "exception": type(exc).__name__,
            "message": _truncate(str(exc), 400),
            "elapsed_ms": meta.elapsed_ms(),
        }
    )
