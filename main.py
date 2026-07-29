import os
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dataclasses import dataclass
from pydantic_ai import Agent, RunContext

# ── Backend model imports ─────────────────────────────────────────────────────
# Local: Ollama (Llama etc.)          Cloud: Gemini (via Google AI Studio)
# Both are optional imports — missing SDKs degrade gracefully instead of
# crashing the app at startup.
try:
    from pydantic_ai.models.ollama import OllamaModel
    from pydantic_ai.providers.ollama import OllamaProvider
except ImportError:
    OllamaModel = None
    OllamaProvider = None

try:
    from pydantic_ai.models.google import GoogleModel
    from pydantic_ai.providers.google import GoogleProvider
except ImportError:
    GoogleModel = None
    GoogleProvider = None

from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="AI Prompt Middleware", version="3.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ══════════════════════════════════════════════════════════════════════════════
# BACKEND SWITCH
# This is the one knob that decides everything: local dev vs deployed portfolio.
#
#   CLOUD_MODE=true   -> Gemini API (no local server needed, good for a hosted demo)
#   CLOUD_MODE=false  -> your existing local Ollama server (default, unchanged)
#
# Set this in your .env file or your hosting platform's environment variables.
# ══════════════════════════════════════════════════════════════════════════════
CLOUD_MODE = os.getenv("CLOUD_MODE", "false").strip().lower() in ("1", "true", "yes")

# ── Local (Ollama) config ─────────────────────────────────────────────────────
# Requires Ollama running locally: https://ollama.com
# Pull the model first: `ollama pull llama3.2` or `ollama pull llama3.1:8b`
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
OLLAMA_MODEL    = os.getenv("OLLAMA_MODEL", "llama3.2")

# ── Cloud config ───────────────────────────────────────────────────────────────
# Free tier via Google AI Studio: https://aistudio.google.com/apikey
# Both Gemini and Gemma models are served from the SAME Gemini API endpoint and
# the SAME API key — Gemma 4 is Google's open-weight family, hosted for free
# (rate-limited) alongside Gemini itself.
#
# Real free-tier rate limits (confirmed via Google AI Studio, July 2026):
#   gemini-3.5-flash        5 RPM  / 250K TPM / 20 RPD   <- painfully low
#   gemini-3.5-flash-lite  15 RPM  / 250K TPM / 500 RPD
#   gemini-3.6-flash        5 RPM  / 250K TPM / 20 RPD
# Gemma models on the free tier have separate, much friendlier quotas, which is
# why they're the PRIMARY engines here — Gemini Flash models are only kept
# around as a safety net for when Gemma gets rate-limited.
#
# NOTE: model ID strings shift over time — if any of these 404, open Google AI
# Studio's model picker, copy the exact current ID, and set it as an env var
# (no code change needed).
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# Primary engines — Gemma 4, open-weight, hosted for free on the Gemini API.
# Heavier task (/refine: extracts role/task/format/constraints/formatted_prompt)
# gets the bigger dense model; lighter task (/suggest-model: picks one ID from
# a short list) gets the faster MoE model.
GEMMA_MODEL_REFINE = os.getenv("GEMMA_MODEL_REFINE", "gemma-4-31b-it")
GEMMA_MODEL_ROUTER = os.getenv("GEMMA_MODEL_ROUTER", "gemma-4-26b-a4b-it")

# Fallback chain — only used when the primary Gemma call hits a 429 / quota
# error. Tried in order, left to right. Comma-separated so you can reorder or
# extend it (e.g. add "gemini-3.6-flash") without touching code.
GEMINI_FALLBACK_MODELS = [
    m.strip() for m in os.getenv(
        "GEMINI_FALLBACK_MODELS", "gemini-3.5-flash,gemini-3.5-flash-lite"
    ).split(",") if m.strip()
]


def _build_ollama_model(model_name: str):
    if OllamaModel is None or OllamaProvider is None:
        return None
    return OllamaModel(model_name, provider=OllamaProvider(base_url=OLLAMA_BASE_URL))


def _build_gemini_model(model_name: str):
    """Builds a Gemini-API-backed model — works for both Gemini and Gemma model IDs,
    since Gemma is served through the same generativelanguage.googleapis.com endpoint."""
    if GoogleModel is None or GoogleProvider is None:
        return None
    if not GEMINI_API_KEY:
        return None
    return GoogleModel(model_name, provider=GoogleProvider(api_key=GEMINI_API_KEY))


def _resolve_model_chain(primary_model_name: str) -> list[tuple[str, object]]:
    """Returns an ordered list of (model_name, model_instance) to try for a given
    task. Local mode has no fallback chain (just Ollama). Cloud mode tries the
    Gemma primary first, then each Gemini Flash fallback in order."""
    if not CLOUD_MODE:
        m = _build_ollama_model(OLLAMA_MODEL)
        return [(OLLAMA_MODEL, m)] if m else []

    chain: list[tuple[str, object]] = []
    primary = _build_gemini_model(primary_model_name)
    if primary is not None:
        chain.append((primary_model_name, primary))
    for fb_name in GEMINI_FALLBACK_MODELS:
        fb = _build_gemini_model(fb_name)
        if fb is not None:
            chain.append((fb_name, fb))
    return chain


def _is_rate_limited(exc: Exception) -> bool:
    """Detects 429 / quota-exhausted errors so we only fall back for THOSE,
    not for genuine bugs (bad input, auth failures, schema mismatches, etc.)."""
    status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
    if status == 429:
        return True
    msg = str(exc).lower()
    return any(
        token in msg
        for token in ("429", "resource_exhausted", "rate limit", "rate-limit", "quota", "too many requests")
    )


async def run_with_fallback(agents: list, prompt: str, **run_kwargs):
    """Runs prompt against agents in order. Moves to the next agent ONLY on a
    detected rate-limit error; any other exception is raised immediately.
    Returns (model_name_used, result)."""
    if not agents:
        raise RuntimeError(_backend_error_message())

    last_exc = None
    for i, (name, agent) in enumerate(agents):
        try:
            result = await agent.run(prompt, **run_kwargs)
            return name, result
        except Exception as e:
            last_exc = e
            if _is_rate_limited(e) and i < len(agents) - 1:
                print(f"[FALLBACK] {name} rate-limited (429) — trying next model in chain...")
                continue
            raise
    raise last_exc  # pragma: no cover — unreachable, agents is non-empty

# ── Model registry ────────────────────────────────────────────────────────────
MODEL_REGISTRY: dict[str, dict] = {
    "claude-opus-4-6":   {
        "provider": "Claude", "free": False, "paid": True,
        "strengths": ["deep reasoning", "1M context", "complex agents", "long documents", "nuanced writing"],
        "weaknesses": ["expensive", "slow"],
    },
    "claude-sonnet-4-6": {
        "provider": "Claude", "free": False, "paid": True,
        "strengths": ["coding", "everyday tasks", "UI generation", "balanced speed"],
        "weaknesses": ["not as deep as Opus"],
    },
    "claude-haiku-4-5":  {
        "provider": "Claude", "free": False, "paid": True,
        "strengths": ["very fast", "lightweight tasks", "cost efficient", "summarisation"],
        "weaknesses": ["weak on hard reasoning"],
    },
    "gpt-5.2":           {
        "provider": "ChatGPT", "free": True, "paid": True,
        "strengths": ["general purpose", "reasoning", "agentic", "professional writing", "multimodal"],
        "weaknesses": ["expensive at scale"],
    },
    "gpt-5.2-mini":      {
        "provider": "ChatGPT", "free": True, "paid": True,
        "strengths": ["speed", "cost efficiency", "everyday tasks", "rapid prototyping"],
        "weaknesses": ["less capable for complex work"],
    },
    "o3-pro":            {
        "provider": "ChatGPT", "free": False, "paid": True,
        "strengths": ["advanced mathematics", "competitive programming", "scientific research", "mission-critical reasoning"],
        "weaknesses": ["very slow", "very expensive"],
    },
    "o3":                {
        "provider": "ChatGPT", "free": False, "paid": True,
        "strengths": ["logic", "coding", "step-by-step reasoning", "technical problems"],
        "weaknesses": ["slower than gpt-5.2", "cost"],
    },
    "gpt-5.3-codex":     {
        "provider": "ChatGPT", "free": False, "paid": True,
        "strengths": ["agentic coding", "long-horizon code tasks", "codebase navigation", "automated software engineering"],
        "weaknesses": ["code only, not general"],
    },
    "gemini-3.6-flash":  {
        "provider": "Gemini", "free": True, "paid": True,
        "strengths": ["fast multimodal", "large 1M context", "agentic tasks", "cost efficient", "high RPM/TPM on free tier"],
        "weaknesses": ["not as deep as Pro-tier reasoning"],
        "rate_limits_free": {"rpm": 15, "tpm": 1_000_000, "rpd": 1500},
    },
    "gemini-3.5-flash-lite": {
        "provider": "Gemini", "free": True, "paid": True,
        "strengths": ["very fast", "highest free-tier RPM", "lightweight structured output", "cost efficient", "classification/routing"],
        "weaknesses": ["less depth than full Flash or Pro"],
        "rate_limits_free": {"rpm": 30, "tpm": 1_000_000, "rpd": 1500},
    },
    "gemini-3.1-pro":    {
        "provider": "Gemini", "free": False, "paid": True,
        "strengths": ["multimodal", "advanced math", "coding", "image understanding", "2M context"],
        "weaknesses": ["paid tier only", "very low free-tier RPM if enabled (~2)"],
    },
    "gemini-2.5-flash":  {
        "provider": "Gemini", "free": True, "paid": True,
        "strengths": ["balanced", "large context", "reasoning", "high volume", "cost efficient"],
        "weaknesses": ["superseded by 3.x Flash"],
    },
    "deepseek-v3.2":     {
        "provider": "DeepSeek", "free": True, "paid": True,
        "strengths": ["open source", "coding", "math", "self-hostable", "cost efficient"],
        "weaknesses": ["smaller ecosystem"],
    },
    "deepseek-v3.1":     {
        "provider": "DeepSeek", "free": True, "paid": True,
        "strengths": ["coding", "math", "reasoning", "hybrid thinking"],
        "weaknesses": ["slightly older than V3.2"],
    },
    "deepseek-r1":       {
        "provider": "DeepSeek", "free": True, "paid": True,
        "strengths": ["chain-of-thought reasoning", "math proofs", "logic", "open source"],
        "weaknesses": ["slow", "not ideal for creative tasks"],
    },
    "grok-3":            {
        "provider": "Grok", "free": False, "paid": True,
        "strengths": ["real-time web", "current events", "X/Twitter data", "live research"],
        "weaknesses": ["limited outside real-time"],
    },
    "grok-3-mini":       {
        "provider": "Grok", "free": True, "paid": True,
        "strengths": ["speed", "coding", "fast reasoning", "free tier"],
        "weaknesses": ["less powerful than Grok 3"],
    },
    "copilot-web":       {
        "provider": "Copilot", "free": True, "paid": True,
        "strengths": ["real-time web search", "Microsoft 365 integration", "free access", "image generation", "general productivity"],
        "weaknesses": ["less control", "not for API use"],
    },
    "copilot-pro":       {
        "provider": "Copilot", "free": False, "paid": True,
        "strengths": ["priority GPT-5 access", "Word Excel PowerPoint Teams integration", "faster responses", "M365 grounding"],
        "weaknesses": ["requires M365 subscription"],
    },
}

# ── Prompt format templates ───────────────────────────────────────────────────
FORMAT_INSTRUCTIONS: dict[str, str] = {
    "Claude": (
    "Use flat, sibling-level XML tags — NOT nested inside one another: "
    "<role>...</role> <context>...</context> <task>...</task> "
    "<format>...</format> <constraints>...</constraints>. "
    "Every tag you open MUST have a matching closing tag. "
    "Claude responds best to structured XML."
),
    "ChatGPT":  "Start with 'You are [role].' then numbered sections: 1. Context 2. Task 3. Output format 4. Rules. GPT responds best to numbered imperative sections.",
    "Gemini":   "Use ## markdown headings: ## Role, ## Background, ## Task, ## Output Format, ## Constraints. Gemini responds best to clear markdown hierarchy.",
    "DeepSeek": "Use terse spec format: ROLE: / OBJECTIVE: / OUTPUT: / RULES: 1. 2. DeepSeek responds best to concise technical specs.",
    "Grok":     "Use direct conversational format: 'You are [role]. Task: [task]. Reply in [format]. Remember: [constraints].' Grok works with direct prompts.",
    "Copilot":  "Use plain English: 'You are helping me with: [task]. Act as [role]. Format as [format]. Rules: [constraints].' Copilot works best with plain language.",
}

# ── Pydantic schemas ──────────────────────────────────────────────────────────
@dataclass
class RefineDeps:
    style: str
    target_provider: str


class RefinedPromptOutput(BaseModel):
    role: str               = Field(description="The persona the AI should adopt.")
    task: str               = Field(description="The specific action or objective.")
    format: str              = Field(description="The exact output format expected.")
    constraints: list[str]  = Field(description="3-5 strict rules.")
    formatted_prompt: str   = Field(description="Full ready-to-paste prompt formatted for the target model.")


class RouterOutput(BaseModel):
    recommended_model:    str = Field(description="Exact model ID from the valid list.")
    recommended_provider: str = Field(description="Provider name for the recommended model.")
    reason:               str = Field(description="One sentence: why this model is best for this task.")
    runner_up:            str = Field(description="Second best exact model ID from the valid list.")
    runner_up_reason:     str = Field(description="One sentence: why runner-up is second best.")


class PromptRequest(BaseModel):
    user_input:   str
    style:        str
    target_model: str


class SuggestRequest(BaseModel):
    user_input:     str
    budget:         str
    allowed_models: list[str]


# ── Helpers ───────────────────────────────────────────────────────────────────
def snap_to_valid_id(candidate: str, valid_ids: list[str]) -> str:
    """Snap a hallucinated / mis-cased model ID to the nearest real one."""
    if candidate in valid_ids:
        return candidate
    for v in valid_ids:
        if v.lower() == candidate.lower():
            return v
    best, best_score = valid_ids[0], 0
    for v in valid_ids:
        score = sum(1 for part in v.split("-") if part.lower() in candidate.lower())
        if score > best_score:
            best, best_score = v, score
    return best


def _backend_error_message() -> str:
    if CLOUD_MODE:
        if GoogleModel is None or GoogleProvider is None:
            return (
                "CLOUD_MODE is enabled but the Gemini provider isn't installed. "
                "Run: pip install 'pydantic-ai[google]' (or the current Google extra for your pydantic-ai version)."
            )
        if not GEMINI_API_KEY:
            return (
                "CLOUD_MODE is enabled but GEMINI_API_KEY is not set. "
                "Get a free key at https://aistudio.google.com/apikey and set it as an env var."
            )
        return "Gemini/Gemma backend failed to initialize — check GEMMA_MODEL_REFINE / GEMMA_MODEL_ROUTER / GEMINI_FALLBACK_MODELS are valid model IDs."
    return (
        "CLOUD_MODE is disabled but no local Ollama backend is available. "
        "Start Ollama (https://ollama.com) or install a supported pydantic-ai provider."
    )


# ── Model chains (primary + fallback), resolved once at startup ──────────────
refiner_chain = _resolve_model_chain(GEMMA_MODEL_REFINE)   # e.g. [("gemma-4-31b-it", m), ("gemini-3.5-flash", m), ("gemini-3.5-flash-lite", m)]
router_chain  = _resolve_model_chain(GEMMA_MODEL_ROUTER)   # e.g. [("gemma-4-26b-a4b-it", m), ("gemini-3.5-flash", m), ("gemini-3.5-flash-lite", m)]

REFINER_SYSTEM_PROMPT = (
    "You are a Master Prompt Engineer. "
    "Transform messy human input into a structured AI prompt. "
    "Extract role, task, format, constraints, and a formatted_prompt. "
    "Be precise — no filler text."
)


def _make_refiner_agent(model) -> Agent:
    """Builds one refiner Agent bound to a specific model, with the dynamic
    style/format system-prompt injector attached."""
    agent = Agent(
        model,
        deps_type=RefineDeps,
        output_type=RefinedPromptOutput,
        system_prompt=REFINER_SYSTEM_PROMPT,
    )

    @agent.system_prompt
    def inject_style_and_format(ctx: RunContext[RefineDeps]) -> str:
        fmt = FORMAT_INSTRUCTIONS.get(ctx.deps.target_provider, FORMAT_INSTRUCTIONS["ChatGPT"])
        return (
            f"\nSTYLE: Write all parameters in a {ctx.deps.style} tone.\n"
            f"FORMAT RULE: {fmt}"
        )

    return agent


# One agent per model in the chain, e.g. [("gemma-4-31b-it", Agent(...)), ("gemini-3.5-flash", Agent(...)), ...]
refiner_agents = [(name, _make_refiner_agent(model)) for name, model in refiner_chain]


# ── Router agents (built per-request: model chain is fixed, but the system
#    prompt depends on which models are eligible for THIS request) ───────────
def build_router_agents(eligible_models: dict):
    if not router_chain:
        raise RuntimeError(_backend_error_message())

    valid_ids       = list(eligible_models.keys())
    id_list_json    = json.dumps(valid_ids)
    strengths_lines = "\n".join(
        f'  "{mid}": {", ".join(info["strengths"][:4])}'
        for mid, info in eligible_models.items()
    )
    system = (
        "You are a neutral AI Model Router. Match the user task to the best model.\n\n"
        f"VALID MODEL IDs — you MUST return one of these, copied character-for-character:\n{id_list_json}\n\n"
        f"Strengths per model:\n{strengths_lines}\n\n"
        "STRICT OUTPUT RULES:\n"
        "- recommended_model: copy one ID exactly from the list above\n"
        "- runner_up: copy a DIFFERENT ID exactly from the list above\n"
        "- recommended_provider: the provider name matching recommended_model\n"
        "- reason: one sentence why this model fits best\n"
        "- runner_up_reason: one sentence why runner_up is second\n"
        "- NEVER invent, abbreviate, or paraphrase model IDs\n"
        "- Pick by task fit only — no provider preference"
    )
    return [
        (name, Agent(model, deps_type=None, output_type=RouterOutput, system_prompt=system))
        for name, model in router_chain
    ]


# ── API routes ────────────────────────────────────────────────────────────────
@app.post("/refine")
async def refine_prompt(request: PromptRequest):
    """Refine a raw user prompt into a structured, model-optimised prompt."""
    try:
        info     = MODEL_REGISTRY.get(request.target_model, {})
        provider = info.get("provider", "ChatGPT")

        deps = RefineDeps(style=request.style, target_provider=provider)
        engine_used, result = await run_with_fallback(refiner_agents, request.user_input, deps=deps)
        data     = result.output.model_dump()
        data["target_model"] = request.target_model
        data["provider"]     = provider
        data["backend"]      = "cloud" if CLOUD_MODE else "ollama"
        data["engine_used"]  = engine_used
        return data
    except Exception as e:
        print(f"[REFINE ERROR] {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/suggest-model")
async def suggest_model(request: SuggestRequest):
    """Given a task description and allowed model list, recommend the best model."""
    try:
        eligible = {
            mid: info
            for mid, info in MODEL_REGISTRY.items()
            if mid in request.allowed_models
        }
        if not eligible:
            raise HTTPException(status_code=400, detail="No eligible models in allowed_models.")

        valid_ids = list(eligible.keys())
        agents    = build_router_agents(eligible)
        engine_used, result = await run_with_fallback(agents, request.user_input)
        data      = result.output.model_dump()

        # Guard against hallucinated IDs
        data["recommended_model"] = snap_to_valid_id(data["recommended_model"], valid_ids)
        data["runner_up"]         = snap_to_valid_id(data["runner_up"], valid_ids)

        if data["runner_up"] == data["recommended_model"] and len(valid_ids) > 1:
            data["runner_up"] = next(v for v in valid_ids if v != data["recommended_model"])

        rec_id = data["recommended_model"]
        data["recommended_provider"] = MODEL_REGISTRY.get(rec_id, {}).get(
            "provider", data.get("recommended_provider", "")
        )
        data["strengths"] = MODEL_REGISTRY.get(rec_id, {}).get("strengths", [])
        data["is_free"]   = MODEL_REGISTRY.get(rec_id, {}).get("free", False)
        data["backend"]     = "cloud" if CLOUD_MODE else "ollama"
        data["engine_used"] = engine_used
        return data

    except HTTPException:
        raise
    except Exception as e:
        print(f"[ROUTER ERROR] {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/models")
def get_models():
    """Return the full model registry."""
    return MODEL_REGISTRY


@app.get("/health")
def health():
    """Quick liveness check — shows which backend is active and the full
    primary -> fallback chain configured for each task."""
    if CLOUD_MODE:
        return {
            "status": "ok" if refiner_chain and router_chain else "degraded",
            "backend": "cloud",
            "refine_chain": [name for name, _ in refiner_chain],
            "router_chain": [name for name, _ in router_chain],
            "gemini_key_set": bool(GEMINI_API_KEY),
        }
    return {
        "status": "ok" if refiner_chain else "degraded",
        "backend": "ollama",
        "model": OLLAMA_MODEL,
        "ollama_url": OLLAMA_BASE_URL,
    }


# ── Optional static files serving for monolithic deployment ──────────────────
try:
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse

    if os.path.exists("landing"):
        app.mount("/landing", StaticFiles(directory="landing"), name="landing")
    if os.path.exists("tool"):
        app.mount("/tool", StaticFiles(directory="tool"), name="tool")
    if os.path.exists("shared"):
        app.mount("/shared", StaticFiles(directory="shared"), name="shared")

    @app.get("/")
    def read_root():
        if os.path.exists("index.html"):
            return FileResponse("index.html")
        return {"message": "AI Prompt Middleware Backend is running!"}
except Exception as e:
    print(f"[STATIC MOUNT WARNING] Could not mount static files: {e}")