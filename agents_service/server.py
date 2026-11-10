"""FastAPI front-door for the multi-agent system.

Two endpoints:
- /chat         — admin-scoped (full DB access via service-role key)
- /employee/chat — employee-scoped, requires X-Employee-Id header (set by the
                   Next.js proxy after Supabase auth). Tools read the
                   employee_id from the run context, so the chatbot can only
                   surface that employee's own data.

Auth (admin role / employee identity) happens upstream in the Next.js
proxies; this service trusts the shared `X-Proxy-Secret` header.
"""
from __future__ import annotations

import os
from typing import Any

import io
import logging
import sys
import time
import uuid

from agents import Runner
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from openai import AsyncOpenAI
from pydantic import BaseModel

from agents_service.agents.employee_triage_agent import employee_triage_agent
from agents_service.agents.triage_agent import triage_agent
from agents_service.context import EmployeeContext
from agents_service.run_hooks import (
    LoggingRunHooks,
    RunMeta,
    request_failed,
    request_finished,
    request_started,
)

load_dotenv()

# Configure root logging so RunHooks output flows to stdout (and PM2 captures it).
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
    force=True,
)
log = logging.getLogger("agents.server")

PROXY_SECRET = os.environ.get("AGENT_PROXY_SECRET", "")

# OpenAI's latest speech models (March 2025).
STT_MODEL = os.environ.get("OPENAI_STT_MODEL", "gpt-4o-mini-transcribe")
TTS_MODEL = os.environ.get("OPENAI_TTS_MODEL", "gpt-4o-mini-tts")
TTS_VOICE = os.environ.get("OPENAI_TTS_VOICE", "alloy")

app = FastAPI(title="PlayFunia Multi-Agent Service")
_openai_client: AsyncOpenAI | None = None


def _openai() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = AsyncOpenAI()
    return _openai_client


class ChatTurn(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatTurn] = []


class ChatResponse(BaseModel):
    reply: str
    agent: str
    handoffs: list[str] = []


def _build_input(req: ChatRequest) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for t in req.history:
        if t.role not in ("user", "assistant"):
            continue
        items.append({"role": t.role, "content": t.content})
    items.append({"role": "user", "content": req.message})
    return items


def _check_secret(value: str) -> None:
    if not PROXY_SECRET or value != PROXY_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _summarise_handoffs(result: Any) -> list[str]:
    handoffs: list[str] = []
    try:
        for item in result.new_items:
            if getattr(item, "type", "") == "handoff_call_item":
                target = getattr(item, "target_agent", None)
                handoffs.append(getattr(target, "name", str(target)))
    except Exception:
        pass
    return handoffs


# ─────────────────────────── Admin endpoint ───────────────────────────
@app.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    x_proxy_secret: str = Header(default=""),
) -> ChatResponse:
    _check_secret(x_proxy_secret)
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Empty message")

    meta = RunMeta(request_id=uuid.uuid4().hex[:8], mode="admin")
    request_started(meta, req.message)
    try:
        result = await Runner.run(
            triage_agent, _build_input(req), hooks=LoggingRunHooks(meta)
        )
    except Exception as e:
        request_failed(meta, e)
        raise HTTPException(status_code=500, detail=f"Agent failed: {e}")

    final_agent = getattr(result, "last_agent", triage_agent)
    request_finished(meta, result.final_output or "", getattr(final_agent, "name", "?"))
    return ChatResponse(
        reply=result.final_output or "",
        agent=getattr(final_agent, "name", "Triage"),
        handoffs=_summarise_handoffs(result),
    )


# ─────────────────────────── Employee endpoint ───────────────────────────
@app.post("/employee/chat", response_model=ChatResponse)
async def employee_chat(
    req: ChatRequest,
    x_proxy_secret: str = Header(default=""),
    x_employee_id: str = Header(default=""),
    x_employee_name: str = Header(default=""),
) -> ChatResponse:
    _check_secret(x_proxy_secret)
    if not x_employee_id.strip():
        # Auth must be enforced upstream; missing header means a misconfigured
        # proxy, not a user error.
        raise HTTPException(status_code=400, detail="Missing X-Employee-Id")
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Empty message")

    context = EmployeeContext(
        employee_id=x_employee_id.strip(),
        full_name=x_employee_name.strip() or None,
    )
    meta = RunMeta(
        request_id=uuid.uuid4().hex[:8],
        mode="employee",
        employee_id=context.employee_id,
    )
    request_started(meta, req.message)
    try:
        result = await Runner.run(
            employee_triage_agent,
            _build_input(req),
            context=context,
            hooks=LoggingRunHooks(meta),
        )
    except Exception as e:
        request_failed(meta, e)
        raise HTTPException(status_code=500, detail=f"Agent failed: {e}")

    final_agent = getattr(result, "last_agent", employee_triage_agent)
    request_finished(meta, result.final_output or "", getattr(final_agent, "name", "?"))
    return ChatResponse(
        reply=result.final_output or "",
        agent=getattr(final_agent, "name", "Triage"),
        handoffs=_summarise_handoffs(result),
    )


# ─────────────────────────── Voice (OpenAI STT/TTS) ───────────────────────────
@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    x_proxy_secret: str = Header(default=""),
) -> dict[str, str]:
    """Speech → text via OpenAI's latest transcription model."""
    _check_secret(x_proxy_secret)
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty audio")
    # The OpenAI SDK wants a file-like object with a name.
    buf = io.BytesIO(data)
    buf.name = audio.filename or "audio.webm"
    try:
        result = await _openai().audio.transcriptions.create(
            model=STT_MODEL,
            file=buf,
            response_format="text",
        )
    except Exception as e:
        # gpt-4o-mini-transcribe rejects some browser containers; fall back to
        # whisper-1 which is permissive about formats.
        try:
            buf.seek(0)
            result = await _openai().audio.transcriptions.create(
                model="whisper-1",
                file=buf,
                response_format="text",
            )
        except Exception:
            raise HTTPException(status_code=502, detail=f"transcription failed: {e}")
    text = result if isinstance(result, str) else getattr(result, "text", "")
    return {"text": (text or "").strip()}


class TtsRequest(BaseModel):
    text: str
    voice: str | None = None


@app.post("/tts")
async def tts(
    req: TtsRequest, x_proxy_secret: str = Header(default="")
) -> Response:
    """Text → speech (mp3) via OpenAI's latest TTS model."""
    _check_secret(x_proxy_secret)
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Empty text")
    voice = (req.voice or TTS_VOICE).strip() or "alloy"
    # Strip Markdown noise so the read-back is natural.
    clean = (
        req.text.replace("**", "")
        .replace("*", "")
        .replace("`", "")
        .replace("__", "")
    )
    try:
        # AsyncOpenAI returns a streaming response object; collect to bytes.
        async with _openai().audio.speech.with_streaming_response.create(
            model=TTS_MODEL,
            voice=voice,
            input=clean[:4000],
            response_format="mp3",
        ) as stream:
            chunks: list[bytes] = []
            async for chunk in stream.iter_bytes():
                chunks.append(chunk)
            audio_bytes = b"".join(chunks)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"tts failed: {e}")
    return Response(
        content=audio_bytes,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "admin_agents": [triage_agent.name, *(a.name for a in triage_agent.handoffs)],
        "employee_agents": [
            employee_triage_agent.name,
            *(a.name for a in employee_triage_agent.handoffs),
        ],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "agents_service.server:app",
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8088")),
        reload=False,
    )
