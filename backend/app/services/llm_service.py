"""
llm_service.py

Sends a meeting transcript to an LLM and extracts a structured MOM
(Minutes of Meeting): summary, participants, discussion points,
decisions, action items, and pending issues.

Following the project's service-abstraction principle - an abstract
LLMService interface with two concrete implementations:
  - GeminiService: Google's Gemini API
  - GroqService: Groq's free, no-credit-card API (DEFAULT - see
    config.py LLM_PROVIDER and the Phase 6 addendum in
    Documentation.txt for why Groq is the default)
Adding another provider later (OpenAI, Claude, local Ollama) means
adding another class here and updating the one factory function at
the bottom - not rewriting every place that calls this service.

HALLUCINATION CONTROL (master prompt Section 9):
The prompt sent to the LLM explicitly forbids inventing decisions,
deadlines, participant names, or tasks that are not clearly present
in the transcript. If the response fails JSON parsing or schema
validation, we retry ONCE with a correction prompt before giving up
with a clear, honest error - we never silently accept a malformed or
partially-invented response.
"""

import json
from abc import ABC, abstractmethod
from typing import Callable, Optional
from pydantic import ValidationError

from app.core.config import (
    GEMINI_API_KEY,
    GEMINI_MODEL_NAME,
    GROQ_API_KEY,
    GROQ_MODEL_NAME,
    LLM_PROVIDER,
)
from app.schemas.mom import MOMResult


class LLMExtractionError(Exception):
    """Raised when the LLM fails to produce a valid, trustworthy MOM."""


# This is the core hallucination-control instruction set. Changing
# these rules changes what the LLM is and isn't allowed to do, so
# treat edits here carefully and re-test with a transcript containing
# tentative/ambiguous language (not just clear decisions) afterward.
#
# Phase 14 update: rule 6 now explicitly tells the LLM to leverage
# "Speaker N:" labels when the transcript was diarized, so speaker-
# attributed decisions and action items are extracted correctly.
SYSTEM_INSTRUCTIONS = """You are an assistant that extracts structured Minutes of Meeting (MOM) from a raw meeting transcript.

STRICT RULES - follow these exactly:
1. Only use information explicitly present in the transcript. NEVER invent decisions, deadlines, participant names, or tasks that are not clearly stated.
2. If something is discussed but NOT clearly decided (e.g. "we might launch Friday", "maybe X should do it"), do NOT list it as a decision or action item - put it under discussion_points or pending_issues instead.
3. If no clear action items exist in the transcript, return an empty array for action_items. Do not invent placeholder tasks to fill the list.
4. If no clear decisions were made, return an empty array for decisions. Do not lower your bar for what counts as a decision just to avoid an empty array.
5. If a deadline, assignee, status, or priority is not explicitly mentioned for a task, use null for that field - do not guess or infer one.
6. participants should only include names/roles that are explicitly identifiable in the transcript. If the transcript contains "Speaker N:" labels (added by speaker diarization), use those labels as participant names (e.g. "Speaker 1", "Speaker 2") - they represent real people and are acceptable participant identifiers when no real name is spoken. Do not invent participant names beyond what the transcript contains.
7. status must be exactly one of: pending, in_progress, done, blocked. Use null only when the transcript gives no signal about a task's state.
8. priority must be exactly one of: low, medium, high. Only set it when the transcript makes the priority explicit - never infer priority from vague enthusiasm or tone.

Respond with ONLY valid JSON matching this exact schema. No markdown code fences, no commentary before or after, just the JSON object:

{
  "meeting_title": string or null,
  "meeting_date": string or null,
  "summary": string,
  "participants": array of strings,
  "discussion_points": array of strings,
  "decisions": array of strings,
  "action_items": array of objects, each: {"task": string, "assignee": string or null, "deadline": string or null, "status": string or null, "priority": string or null},
  "pending_issues": array of strings
}
"""


def _parse_and_validate_mom(raw_text: str) -> MOMResult:
    """
    Parse an LLM's raw text response as JSON and validate it against
    the MOMResult schema. Shared by every provider so all of them
    get identical, strict validation - a provider can't accidentally
    skip this step.

    Raises json.JSONDecodeError or pydantic.ValidationError on failure
    (both are caught by _extract_with_retry, which decides what to do).
    """
    cleaned = raw_text.strip()

    # Defensive cleanup: strip markdown code fences if the model
    # added them despite being told not to - LLMs don't always
    # follow formatting instructions perfectly.
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()

    data = json.loads(cleaned)  # raises json.JSONDecodeError if invalid
    return MOMResult.model_validate(data)  # raises ValidationError if schema mismatch


def _extract_with_retry(
    call_fn: Callable[..., str],
    transcript_text: str,
) -> MOMResult:
    """
    Shared retry-once-with-correction logic, per master prompt
    Section 8: "Attempt safe parsing. If necessary, retry once with a
    correction prompt. If still invalid, return a useful error."

    call_fn must accept (transcript_text, extra_instruction=None) and
    return the raw text response from the LLM. Every provider passes
    its own API-calling method here, so this retry logic is written
    exactly once instead of duplicated per provider.
    """
    raw_response = call_fn(transcript_text)

    try:
        return _parse_and_validate_mom(raw_response)
    except (json.JSONDecodeError, ValidationError) as first_error:
        correction = (
            f"Your previous response could not be parsed as valid JSON "
            f"matching the required schema. Error: {first_error}\n\n"
            f"Respond again with ONLY valid JSON matching the exact "
            f"schema described - no extra text, no markdown fences."
        )
        raw_retry = call_fn(transcript_text, extra_instruction=correction)

        try:
            return _parse_and_validate_mom(raw_retry)
        except (json.JSONDecodeError, ValidationError) as second_error:
            raise LLMExtractionError(
                "Unable to generate a valid MOM from this transcript "
                "after two attempts. This can happen with very short, "
                "unclear, or unusual transcripts. Please review the "
                "transcript and try again."
            ) from second_error


class LLMService(ABC):
    """Abstract interface every LLM provider must implement."""

    @abstractmethod
    def extract_mom(self, transcript_text: str) -> MOMResult:
        """
        Extract a structured, validated MOM from a transcript.

        Raises:
            LLMExtractionError if a valid, schema-conforming response
            cannot be obtained (even after one retry).
        """
        raise NotImplementedError


class GeminiService(LLMService):
    """MOM extraction using Google's Gemini API."""

    def __init__(self):
        if not GEMINI_API_KEY:
            raise LLMExtractionError(
                "GEMINI_API_KEY is not set. Copy backend/.env.example to "
                "backend/.env and add your API key before using MOM "
                "generation. Get a free key at https://aistudio.google.com/apikey"
            )

        # Imported here (not at module top) so simply importing this
        # file doesn't require the google-genai package to be
        # installed unless GeminiService is actually instantiated.
        from google import genai

        self._client = genai.Client(api_key=GEMINI_API_KEY)

    def extract_mom(self, transcript_text: str) -> MOMResult:
        return _extract_with_retry(self._call_gemini, transcript_text)

    def _call_gemini(self, transcript_text: str, extra_instruction: Optional[str] = None) -> str:
        prompt = SYSTEM_INSTRUCTIONS + "\n\nTRANSCRIPT:\n" + transcript_text
        if extra_instruction:
            prompt += "\n\n" + extra_instruction

        response = self._client.models.generate_content(
            model=GEMINI_MODEL_NAME,
            contents=prompt,
        )
        return response.text


class GroqService(LLMService):
    """
    MOM extraction using Groq's free API.

    Groq requires no credit card, ever, and runs open-weight models
    (e.g. Llama 3.3) on their custom LPU hardware. Groq exposes an
    OpenAI-compatible chat completions endpoint, so this uses the
    standard `openai` Python package pointed at Groq's base URL
    instead of a Groq-specific SDK - one less unique dependency to
    maintain, and it means switching to real OpenAI later (if ever
    desired) is a one-line base_url change, not a rewrite.
    """

    def __init__(self):
        if not GROQ_API_KEY:
            raise LLMExtractionError(
                "GROQ_API_KEY is not set. Get a free key (no credit card, "
                "ever) at https://console.groq.com/keys and add it to "
                "backend/.env."
            )

        # Imported here so simply importing this module doesn't
        # require the openai package unless GroqService is actually used.
        from openai import OpenAI

        self._client = OpenAI(
            api_key=GROQ_API_KEY,
            base_url="https://api.groq.com/openai/v1",
        )

    def extract_mom(self, transcript_text: str) -> MOMResult:
        return _extract_with_retry(self._call_groq, transcript_text)

    def _call_groq(self, transcript_text: str, extra_instruction: Optional[str] = None) -> str:
        prompt = SYSTEM_INSTRUCTIONS + "\n\nTRANSCRIPT:\n" + transcript_text
        if extra_instruction:
            prompt += "\n\n" + extra_instruction

        response = self._client.chat.completions.create(
            model=GROQ_MODEL_NAME,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.choices[0].message.content


def get_llm_service() -> LLMService:
    """
    Returns the currently active LLM provider, based on the
    LLM_PROVIDER setting in config.py (default: "groq" - free, no
    credit card required).

    Callers should always go through this function instead of
    instantiating a specific service class directly - switching
    providers is then just changing LLM_PROVIDER in backend/.env,
    not touching any code.
    """
    if LLM_PROVIDER == "gemini":
        return GeminiService()
    return GroqService()
