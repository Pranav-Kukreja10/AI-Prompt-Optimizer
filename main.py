import os
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dataclasses import dataclass
from pydantic_ai import Agent, RunContext
from pydantic_ai.models.ollama import OllamaModel
from pydantic_ai.providers.ollama import OllamaProvider

from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="AI Prompt Middleware", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Llama model via Ollama ────────────────────────────────────────────────────
# Requires Ollama running locally: https://ollama.com
# Pull the model first: `ollama pull llama3.2` or `ollama pull llama3.1:8b`
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
OLLAMA_MODEL    = os.getenv("OLLAMA_MODEL", "llama3.2")   # swap to "llama3.1:8b" if preferred

llama = OllamaModel(
    OLLAMA_MODEL,
    provider=OllamaProvider(base_url=OLLAMA_BASE_URL)
)

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
    "gemini-3.1-pro":    {
        "provider": "Gemini", "free": False, "paid": True,
        "strengths": ["multimodal", "advanced math", "coding", "image understanding", "vibe coding"],
        "weaknesses": ["slower than Flash"],
    },
    "gemini-3-flash":    {
        "provider": "Gemini", "free": True, "paid": True,
        "strengths": ["fast multimodal", "image and text", "speed", "cost efficient"],
        "weaknesses": ["less depth than Pro"],
    },
    "gemini-2.5-pro":    {
        "provider": "Gemini", "free": False, "paid": True,
        "strengths": ["2M token context", "massive document processing", "data analysis", "full codebase review"],
        "weaknesses": ["older generation"],
    },
    "gemini-2.5-flash":  {
        "provider": "Gemini", "free": True, "paid": True,
        "strengths": ["balanced", "large context", "reasoning", "high volume", "cost efficient"],
        "weaknesses": ["less capable than 2.5 Pro"],
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
    "Claude":   "Use XML tags: <role>, <context>, <task>, <format>, <constraints>. Claude responds best to structured XML.",
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
    format: str             = Field(description="The exact output format expected.")
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
    # Case-insensitive exact match
    for v in valid_ids:
        if v.lower() == candidate.lower():
            return v
    # Best partial token match
    best, best_score = valid_ids[0], 0
    for v in valid_ids:
        score = sum(1 for part in v.split("-") if part.lower() in candidate.lower())
        if score > best_score:
            best, best_score = v, score
    return best


# ── Refiner agent ─────────────────────────────────────────────────────────────
refiner_agent = Agent(
    llama,
    deps_type=RefineDeps,
    output_type=RefinedPromptOutput,
    system_prompt=(
        "You are a Master Prompt Engineer. "
        "Transform messy human input into a structured AI prompt. "
        "Extract role, task, format, constraints, and a formatted_prompt. "
        "Be precise — no filler text."
    ),
)


@refiner_agent.system_prompt
def inject_style_and_format(ctx: RunContext[RefineDeps]) -> str:
    fmt = FORMAT_INSTRUCTIONS.get(ctx.deps.target_provider, FORMAT_INSTRUCTIONS["ChatGPT"])
    return (
        f"\nSTYLE: Write all parameters in a {ctx.deps.style} tone.\n"
        f"FORMAT RULE: {fmt}"
    )


# ── Router agent (built per-request with the eligible model subset) ───────────
def build_router_agent(eligible_models: dict) -> Agent:
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
    return Agent(llama, deps_type=None, output_type=RouterOutput, system_prompt=system)


# ── API routes ────────────────────────────────────────────────────────────────
@app.post("/refine")
async def refine_prompt(request: PromptRequest):
    """Refine a raw user prompt into a structured, model-optimised prompt."""
    try:
        info     = MODEL_REGISTRY.get(request.target_model, {})
        provider = info.get("provider", "ChatGPT")
        deps     = RefineDeps(style=request.style, target_provider=provider)
        result   = await refiner_agent.run(request.user_input, deps=deps)
        data     = result.output.model_dump()
        data["target_model"] = request.target_model
        data["provider"]     = provider
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
        router    = build_router_agent(eligible)
        result    = await router.run(request.user_input)
        data      = result.output.model_dump()

        # Guard against hallucinated IDs
        data["recommended_model"] = snap_to_valid_id(data["recommended_model"], valid_ids)
        data["runner_up"]         = snap_to_valid_id(data["runner_up"], valid_ids)

        # Ensure recommended and runner-up are distinct
        if data["runner_up"] == data["recommended_model"] and len(valid_ids) > 1:
            data["runner_up"] = next(v for v in valid_ids if v != data["recommended_model"])

        rec_id = data["recommended_model"]
        data["recommended_provider"] = MODEL_REGISTRY.get(rec_id, {}).get(
            "provider", data.get("recommended_provider", "")
        )
        data["strengths"] = MODEL_REGISTRY.get(rec_id, {}).get("strengths", [])
        data["is_free"]   = MODEL_REGISTRY.get(rec_id, {}).get("free", False)
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
    """Quick liveness check — also shows which Llama model is active."""
    return {"status": "ok", "backend_model": OLLAMA_MODEL, "ollama_url": OLLAMA_BASE_URL}