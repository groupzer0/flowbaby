#!/usr/bin/env python3
"""
Bedrock Health Check Module - Plan 088

Provides a deterministic Bedrock connectivity probe using the configuration
proven stable in Analysis 088:
- TextOut Pydantic model (not response_model=str)
- Strict JSON instruction prompt
- System-first message ordering
- max_completion_tokens=2048

This module is the authoritative source for Bedrock health validation.
The extension should use this instead of relying on Cognee's internal probe.
"""

import os
from pydantic import BaseModel


# =============================================================================
# Constants - Proven Stable Configuration from Analysis 088
# =============================================================================

# Model to use for health probe - read from environment (set by VendResponse),
# with fallback to nova-lite for cross-region inference compatibility
BEDROCK_PROBE_MODEL = os.getenv("LLM_MODEL", "amazon.nova-lite-v1:0")

# Max tokens cap - proven stable in Analysis 088 (Bedrock rejects 16384 default)
BEDROCK_PROBE_MAX_TOKENS = 2048

# Strict JSON instruction - proven 20/20 clean in batch testing
BEDROCK_PROBE_SYSTEM_PROMPT = (
    "You are a JSON emitter. Return exactly one JSON object with a single field 'content' "
    "whose value is the string test. Do not include any other fields, quotes around the object, "
    "code fences, explanations, or reasoning. Example: {\"content\": \"test\"}. Output only that object."
)

# Simple test input
BEDROCK_PROBE_TEXT_INPUT = "test"

# Plan 088 Section 5.1: Embedding health decision
# DEFERRED = embedding validation happens at first use with clear error
# REPLACED = we have a replacement embedding pre-flight check
EMBEDDING_HEALTH_DECISION = "DEFERRED"

# Error message shown when embedding fails at first use (only used if DEFERRED)
EMBEDDING_DEFERRED_ERROR_MESSAGE = (
    "Embedding service unavailable. This may indicate AWS credentials have expired "
    "or the embedding model is not accessible in your region. "
    "Run 'Flowbaby Cloud: Login' to refresh credentials."
)


# =============================================================================
# Response Model - Concrete Pydantic model (not str)
# =============================================================================

class TextOut(BaseModel):
    """
    Pydantic response model for Bedrock health probe.
    
    Analysis 088 proved that using a concrete model like TextOut with strict
    JSON prompting achieves 20/20 clean responses, while response_model=str
    is persistently unstable (0-7/20 clean).
    """
    content: str


# =============================================================================
# Health Check Function
# =============================================================================

async def check_bedrock_health(model: str = None) -> dict:
    """
    Perform a Bedrock connectivity health check.
    
    Uses the proven stable configuration from Analysis 088:
    - TextOut response model
    - Strict JSON instruction
    - System-first message ordering
    - max_completion_tokens=2048
    
    Args:
        model: Optional model override (defaults to BEDROCK_PROBE_MODEL)
    
    Returns:
        dict with keys:
            - success: bool
            - error: str or None
            - error_code: str or None (e.g., 'BEDROCK_AUTH_ERROR')
            - remediation: str or None (actionable user guidance)
            - raw_content: str or None (the actual response content)
    """
    try:
        # Import here to avoid circular imports and allow testing
        from cognee.infrastructure.llm.structured_output_framework.litellm_instructor.llm.bedrock.adapter import (
            BedrockAdapter,
        )
        
        probe_model = model or BEDROCK_PROBE_MODEL
        
        # Create adapter with proven configuration
        adapter = BedrockAdapter(model=probe_model)
        adapter.max_completion_tokens = BEDROCK_PROBE_MAX_TOKENS
        
        # Build request
        request = adapter._create_bedrock_request(
            text_input=BEDROCK_PROBE_TEXT_INPUT,
            system_prompt=BEDROCK_PROBE_SYSTEM_PROMPT,
            response_model=TextOut,
        )
        
        # Force system-first ordering (proven more stable in Analysis 088)
        request["messages"] = [
            {"role": "system", "content": BEDROCK_PROBE_SYSTEM_PROMPT},
            {"role": "user", "content": BEDROCK_PROBE_TEXT_INPUT},
        ]
        
        # Execute probe
        result = await adapter.aclient.chat.completions.create(**request)
        
        # Validate response
        if hasattr(result, 'content'):
            content = result.content
        else:
            content = str(result)
        
        return {
            "success": True,
            "error": None,
            "error_code": None,
            "remediation": None,
            "raw_content": content,
        }
        
    except ImportError as e:
        return {
            "success": False,
            "error": f"Missing Bedrock dependencies: {e}",
            "error_code": "BEDROCK_MISSING_DEPS",
            "remediation": "Run 'Flowbaby: Refresh Bridge Dependencies' to install required packages.",
            "raw_content": None,
        }
        
    except Exception as e:
        error_str = str(e)
        
        # Categorize error for actionable guidance
        if "ExpiredToken" in error_str or "expired" in error_str.lower():
            return {
                "success": False,
                "error": f"AWS credentials expired: {error_str}",
                "error_code": "BEDROCK_AUTH_ERROR",
                "remediation": "Run 'Flowbaby Cloud: Login' to refresh your credentials.",
                "raw_content": None,
            }
        elif "AccessDenied" in error_str or "not authorized" in error_str.lower():
            return {
                "success": False,
                "error": f"AWS access denied: {error_str}",
                "error_code": "BEDROCK_AUTH_ERROR",
                "remediation": "Verify your Flowbaby Cloud subscription includes Bedrock access.",
                "raw_content": None,
            }
        elif "UnrecognizedClient" in error_str or "security token" in error_str.lower():
            return {
                "success": False,
                "error": f"Invalid AWS credentials: {error_str}",
                "error_code": "BEDROCK_AUTH_ERROR",
                "remediation": "Run 'Flowbaby Cloud: Login' to obtain valid credentials.",
                "raw_content": None,
            }
        elif "ResourceNotFoundException" in error_str or "model" in error_str.lower() and "not found" in error_str.lower():
            return {
                "success": False,
                "error": f"Bedrock model not available: {error_str}",
                "error_code": "BEDROCK_MODEL_ERROR",
                "remediation": "The configured model may not be available in your AWS region.",
                "raw_content": None,
            }
        elif "ValidationException" in error_str or "maximum tokens" in error_str.lower():
            return {
                "success": False,
                "error": f"Bedrock request validation failed: {error_str}",
                "error_code": "BEDROCK_VALIDATION_ERROR",
                "remediation": "This may be a configuration issue. Please report this error.",
                "raw_content": None,
            }
        else:
            return {
                "success": False,
                "error": f"Bedrock probe failed: {error_str}",
                "error_code": "BEDROCK_PROBE_FAILED",
                "remediation": "Check your network connection and AWS credentials. Run 'Flowbaby Cloud: Login' to refresh.",
                "raw_content": None,
            }


# =============================================================================
# CLI Entry Point (for manual testing)
# =============================================================================

if __name__ == "__main__":
    import asyncio
    import json
    
    async def main():
        result = await check_bedrock_health()
        print(json.dumps(result, indent=2))
    
    asyncio.run(main())
