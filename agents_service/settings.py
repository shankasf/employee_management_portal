"""Shared agent runtime settings."""
from __future__ import annotations

import os

# OpenAI model used by every agent. Override via env var if you want to swap
# models for the whole service. gpt-5.5 is the current frontier model with
# strong agentic tool-calling and long-context reasoning (GA April 2026).
DEFAULT_MODEL: str = os.environ.get("OPENAI_AGENTS_MODEL", "gpt-5.5")
