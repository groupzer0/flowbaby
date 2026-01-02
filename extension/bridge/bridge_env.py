#!/usr/bin/env python3
"""
Flowbaby Bridge Environment Configuration - Plan 074 / Plan 086

This module provides the SINGLE source of truth for all environment variable
configuration required by Cognee and the Flowbaby bridge. All bridge entrypoints
(init.py, ingest.py, retrieve.py, daemon.py) MUST call apply_workspace_env()
BEFORE any import of the cognee module.

Architecture Requirements (Plan 074 / Architecture Findings 074):
- DRY: One shared function to prevent drift between entrypoints
- Import Order: Env vars MUST be set before any Cognee import (pydantic-settings reads at import time)
- Daemon Equivalence: Spawn-mode and daemon-mode must behave identically
- Deterministic Resolution: Ontology path must be workspace-local, not reliant on CWD

Environment Variables Set:
- SYSTEM_ROOT_DIRECTORY: Cognee system files (.flowbaby/system)
- DATA_ROOT_DIRECTORY: Cognee data files (.flowbaby/data)
- CACHE_ROOT_DIRECTORY: Cognee cache files (.flowbaby/cache)
- CACHING: Enable/disable caching (default: true)
- CACHE_BACKEND: Cache backend type (default: fs for filesystem)
- ONTOLOGY_FILE_PATH: Path to ontology.ttl (Plan 074)
- ONTOLOGY_RESOLVER: Ontology resolver type (Plan 074: rdflib)
- MATCHING_STRATEGY: Entity matching strategy (Plan 074: fuzzy)

Environment Variables Read (Plan 086 - Backend-Controlled Model Selection):
- LLM_PROVIDER: Provider for LLM operations (e.g., 'bedrock')
- LLM_MODEL: Backend-controlled LLM model ID
- EMBEDDING_PROVIDER: Provider for embedding operations (e.g., 'bedrock')
- EMBEDDING_MODEL: Backend-controlled embedding model ID
- EMBEDDING_DIMENSIONS: Embedding vector dimensions (backend-controlled)

These model configuration env vars are set by the extension from VendResponse
when using Flowbaby Cloud mode. The bridge reads them and includes them in the
config snapshot for observability.

@see agent-output/planning/074-activate-ontology-mapping.md
@see agent-output/planning/086-cloud-quota-concurrency-error-contract.md
@see agent-output/architecture/074-activate-ontology-mapping-architecture-findings.md
"""

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class BridgeEnvConfig:
    """
    Immutable snapshot of the bridge environment configuration.
    
    This config is returned by apply_workspace_env() and should be used
    for logging/observability. The values reflect what was actually set
    in os.environ at the time of the call.
    
    Plan 086: Added model configuration fields for backend-controlled model selection.
    """
    workspace_path: str
    system_root: str
    data_root: str
    cache_root: str
    caching: str
    cache_backend: str
    ontology_file_path: str
    ontology_resolver: str
    matching_strategy: str
    ontology_file_exists: bool
    # Plan 086: Backend-controlled model configuration
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    embedding_provider: Optional[str] = None
    embedding_model: Optional[str] = None
    embedding_dimensions: Optional[int] = None
    
    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            'workspace_path': self.workspace_path,
            'system_root': self.system_root,
            'data_root': self.data_root,
            'cache_root': self.cache_root,
            'caching': self.caching,
            'cache_backend': self.cache_backend,
            'ontology_file_path': self.ontology_file_path,
            'ontology_resolver': self.ontology_resolver,
            'matching_strategy': self.matching_strategy,
            'ontology_file_exists': self.ontology_file_exists,
            # Plan 086: Backend-controlled model configuration
            'llm_provider': self.llm_provider,
            'llm_model': self.llm_model,
            'embedding_provider': self.embedding_provider,
            'embedding_model': self.embedding_model,
            'embedding_dimensions': self.embedding_dimensions,
        }
    
    def to_log_string(self) -> str:
        """Format for log output."""
        model_info = ""
        if self.llm_model or self.embedding_model:
            model_info = f", llm={self.llm_model}, embedding={self.embedding_model}, dims={self.embedding_dimensions}"
        return (
            f"BridgeEnv: workspace={self.workspace_path}, "
            f"ontology={self.ontology_file_path} (exists={self.ontology_file_exists}), "
            f"resolver={self.ontology_resolver}, strategy={self.matching_strategy}, "
            f"cache={self.caching}/{self.cache_backend}{model_info}"
        )


class OntologyConfigError(Exception):
    """
    Raised when ontology configuration fails and should block operation.
    
    This is a fail-closed scenario indicating a packaging regression or
    invalid configuration. Low match rates do NOT raise this error.
    """
    pass


def get_bridge_assets_dir() -> Path:
    """
    Get the directory containing bridge assets (ontology.ttl, etc.).
    
    This returns the directory where this module is located, which should
    contain the packaged ontology.ttl file.
    
    Returns:
        Path to the bridge assets directory
    """
    return Path(__file__).parent


def get_ontology_path() -> Path:
    """
    Get the absolute path to the packaged ontology.ttl file.
    
    Architecture Requirement: Ontology path resolution MUST be deterministic
    and based on the packaged bridge assets, not CWD or user home directories.
    
    Returns:
        Absolute Path to ontology.ttl
    """
    return get_bridge_assets_dir() / 'ontology.ttl'


def apply_workspace_env(
    workspace_path: str,
    *,
    logger: Optional[logging.Logger] = None,
    fail_on_missing_ontology: bool = True,
) -> BridgeEnvConfig:
    """
    Apply all required environment variables for Cognee and Flowbaby.
    
    CRITICAL: This function MUST be called BEFORE any import of the cognee module.
    Cognee uses pydantic-settings which reads environment variables at import time.
    
    This function:
    1. Sets workspace-local storage directories (SYSTEM_ROOT_DIRECTORY, DATA_ROOT_DIRECTORY, CACHE_ROOT_DIRECTORY)
    2. Configures caching (CACHING, CACHE_BACKEND) - respects existing values
    3. Activates ontology loading (ONTOLOGY_FILE_PATH, ONTOLOGY_RESOLVER, MATCHING_STRATEGY)
    4. Creates required directories if they don't exist
    5. Returns a config snapshot for logging/observability
    
    Args:
        workspace_path: Absolute path to the workspace root directory
        logger: Optional logger for debug output
        fail_on_missing_ontology: If True (default), raise OntologyConfigError when
            ontology.ttl is missing. Set to False only for recovery/diagnostic scenarios.
    
    Returns:
        BridgeEnvConfig snapshot of the applied configuration
    
    Raises:
        OntologyConfigError: If ontology.ttl is missing and fail_on_missing_ontology is True
        ValueError: If workspace_path is invalid
    
    Example:
        # At the TOP of your script, before any other imports:
        import sys
        import os
        sys.path.append(os.path.dirname(os.path.abspath(__file__)))
        from bridge_env import apply_workspace_env
        
        config = apply_workspace_env('/path/to/workspace')
        
        # NOW it's safe to import cognee
        import cognee
    """
    if not workspace_path:
        raise ValueError("workspace_path is required")
    
    workspace_dir = Path(workspace_path)
    
    # Validate workspace path
    if not workspace_dir.is_absolute():
        raise ValueError(f"workspace_path must be absolute, got: {workspace_path}")
    
    # --- Storage Directories ---
    system_root = str(workspace_dir / '.flowbaby' / 'system')
    data_root = str(workspace_dir / '.flowbaby' / 'data')
    cache_root = str(workspace_dir / '.flowbaby' / 'cache')
    
    os.environ['SYSTEM_ROOT_DIRECTORY'] = system_root
    os.environ['DATA_ROOT_DIRECTORY'] = data_root
    os.environ['CACHE_ROOT_DIRECTORY'] = cache_root
    
    # Create directories
    Path(system_root).mkdir(parents=True, exist_ok=True)
    Path(data_root).mkdir(parents=True, exist_ok=True)
    Path(cache_root).mkdir(parents=True, exist_ok=True)
    
    if logger:
        logger.debug(f"Set storage directories: system={system_root}, data={data_root}, cache={cache_root}")
    
    # --- Caching Configuration (Plan 059) ---
    # Respect existing values (precedence rule: explicit env var > managed default)
    if os.environ.get('CACHING') is None:
        os.environ['CACHING'] = 'true'
        if logger:
            logger.debug("Set CACHING=true (managed default)")
    
    if os.environ.get('CACHE_BACKEND') is None:
        os.environ['CACHE_BACKEND'] = 'fs'
        if logger:
            logger.debug("Set CACHE_BACKEND=fs (managed default - filesystem session cache)")
    
    caching = os.environ.get('CACHING', 'false')
    cache_backend = os.environ.get('CACHE_BACKEND', 'none')
    
    # --- Ontology Configuration (Plan 074) ---
    ontology_path = get_ontology_path()
    ontology_file_exists = ontology_path.exists() and ontology_path.is_file()
    
    if not ontology_file_exists:
        error_msg = (
            f"Ontology file not found at {ontology_path}. "
            f"This indicates a packaging regression. "
            f"Expected location: extension/bridge/ontology.ttl"
        )
        if fail_on_missing_ontology:
            raise OntologyConfigError(error_msg)
        elif logger:
            logger.warning(f"ONTOLOGY MISSING (continuing in degraded mode): {error_msg}")
    
    # Set ontology environment variables
    # These MUST be set before importing cognee for pydantic-settings to pick them up
    os.environ['ONTOLOGY_FILE_PATH'] = str(ontology_path)
    os.environ['ONTOLOGY_RESOLVER'] = 'rdflib'
    os.environ['MATCHING_STRATEGY'] = 'fuzzy'
    
    if logger:
        logger.debug(f"Set ontology config: path={ontology_path}, resolver=rdflib, strategy=fuzzy")
    
    # --- Model Configuration (Plan 086) ---
    # Read backend-controlled model configuration from environment.
    # These are set by the extension from VendResponse when using Cloud mode.
    # If not present, the bridge will fail loudly when model operations are attempted.
    llm_provider = os.environ.get('LLM_PROVIDER')
    llm_model = os.environ.get('LLM_MODEL')
    embedding_provider = os.environ.get('EMBEDDING_PROVIDER')
    embedding_model = os.environ.get('EMBEDDING_MODEL')
    embedding_dimensions_str = os.environ.get('EMBEDDING_DIMENSIONS')
    embedding_dimensions = int(embedding_dimensions_str) if embedding_dimensions_str else None
    
    if logger:
        if llm_provider or embedding_provider:
            logger.debug(
                f"Model config from env: LLM_PROVIDER={llm_provider}, LLM_MODEL={llm_model}, "
                f"EMBEDDING_PROVIDER={embedding_provider}, EMBEDDING_MODEL={embedding_model}, "
                f"EMBEDDING_DIMENSIONS={embedding_dimensions}"
            )
        else:
            logger.debug("No model config in environment (legacy mode or missing Cloud credentials)")
    
    # --- Build Config Snapshot ---
    config = BridgeEnvConfig(
        workspace_path=str(workspace_dir),
        system_root=system_root,
        data_root=data_root,
        cache_root=cache_root,
        caching=caching,
        cache_backend=cache_backend,
        ontology_file_path=str(ontology_path),
        ontology_resolver='rdflib',
        matching_strategy='fuzzy',
        ontology_file_exists=ontology_file_exists,
        # Plan 086: Backend-controlled model configuration
        llm_provider=llm_provider,
        llm_model=llm_model,
        embedding_provider=embedding_provider,
        embedding_model=embedding_model,
        embedding_dimensions=embedding_dimensions,
    )
    
    if logger:
        logger.info(f"Bridge environment configured: {config.to_log_string()}")
    
    return config


def validate_ontology_env() -> dict:
    """
    Validate that ontology environment variables are correctly set.
    
    This is a diagnostic function for verify_environment.py to check
    that ontology configuration is in place.
    
    Returns:
        Dictionary with validation results:
        - ontology_env_configured: bool - Are the env vars set?
        - ontology_file_path: str - The configured path
        - ontology_file_exists: bool - Does the file exist?
        - ontology_resolver: str - The configured resolver
        - matching_strategy: str - The configured strategy
        - valid: bool - Is the configuration valid?
        - message: str - Human-readable status message
    """
    ontology_path = os.environ.get('ONTOLOGY_FILE_PATH', '')
    ontology_resolver = os.environ.get('ONTOLOGY_RESOLVER', '')
    matching_strategy = os.environ.get('MATCHING_STRATEGY', '')
    
    # Check if env vars are set
    env_configured = bool(ontology_path and ontology_resolver and matching_strategy)
    
    # Check if file exists
    file_exists = bool(ontology_path and Path(ontology_path).exists())
    
    # Determine overall validity
    valid = env_configured and file_exists
    
    # Build message
    if not env_configured:
        message = "Ontology environment variables not configured"
    elif not file_exists:
        message = f"Ontology file not found at: {ontology_path}"
    else:
        message = f"Ontology configured: {ontology_path} (resolver={ontology_resolver}, strategy={matching_strategy})"
    
    return {
        'ontology_env_configured': env_configured,
        'ontology_file_path': ontology_path,
        'ontology_file_exists': file_exists,
        'ontology_resolver': ontology_resolver,
        'matching_strategy': matching_strategy,
        'valid': valid,
        'message': message,
    }


def get_env_config_snapshot() -> dict:
    """
    Get a snapshot of all bridge-related environment variables.
    
    This is useful for diagnostics and observability logging.
    Plan 086: Now includes model configuration variables.
    
    Returns:
        Dictionary with all bridge environment variable values
    """
    return {
        'SYSTEM_ROOT_DIRECTORY': os.environ.get('SYSTEM_ROOT_DIRECTORY', ''),
        'DATA_ROOT_DIRECTORY': os.environ.get('DATA_ROOT_DIRECTORY', ''),
        'CACHE_ROOT_DIRECTORY': os.environ.get('CACHE_ROOT_DIRECTORY', ''),
        'CACHING': os.environ.get('CACHING', ''),
        'CACHE_BACKEND': os.environ.get('CACHE_BACKEND', ''),
        'ONTOLOGY_FILE_PATH': os.environ.get('ONTOLOGY_FILE_PATH', ''),
        'ONTOLOGY_RESOLVER': os.environ.get('ONTOLOGY_RESOLVER', ''),
        'MATCHING_STRATEGY': os.environ.get('MATCHING_STRATEGY', ''),
        # Plan 086: Backend-controlled model configuration
        'LLM_PROVIDER': os.environ.get('LLM_PROVIDER', ''),
        'LLM_MODEL': os.environ.get('LLM_MODEL', ''),
        'EMBEDDING_PROVIDER': os.environ.get('EMBEDDING_PROVIDER', ''),
        'EMBEDDING_MODEL': os.environ.get('EMBEDDING_MODEL', ''),
        'EMBEDDING_DIMENSIONS': os.environ.get('EMBEDDING_DIMENSIONS', ''),
    }
