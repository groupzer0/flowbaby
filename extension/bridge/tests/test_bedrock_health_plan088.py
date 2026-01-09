"""Tests for Plan 088: Bedrock Structured Output Health Check Hardening.

TDD Phase: RED - These tests define the expected behavior before implementation.

Covers:
- boto3 verification in verify_environment.py
- bedrock_health.py probe with TextOut + strict JSON + system-first ordering
- Cognee probe bypass via _first_run_done gate
- Error handling and actionable diagnostics
"""

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


class TestVerifyEnvironmentBoto3:
    """Plan 088: verify_environment.py must detect missing boto3."""

    def test_boto3_included_in_required_modules(self):
        """boto3 should be in the required_modules check list."""
        from verify_environment import verify_environment
        
        # Mock boto3 as missing
        with patch.dict('sys.modules', {'boto3': None}):
            with patch('verify_environment.check_import') as mock_check:
                # Return False for boto3, True for others
                def check_import_side_effect(module_name):
                    if module_name == 'boto3':
                        return False
                    return True
                mock_check.side_effect = check_import_side_effect
                
                result = verify_environment('/tmp/test')
                
                # Should report error when boto3 is missing
                assert result['status'] == 'error'
                assert 'boto3' in result['missing']

    def test_boto3_present_returns_ok(self, tmp_path):
        """When boto3 is installed, verify_environment should not flag it."""
        from verify_environment import verify_environment
        
        # Create minimal workspace structure
        flowbaby_dir = tmp_path / '.flowbaby'
        flowbaby_dir.mkdir()
        
        # Create ontology file (required by verify_environment)
        ontology_path = Path(__file__).parent.parent / 'ontology.ttl'
        
        with patch('verify_environment.check_import', return_value=True):
            with patch('verify_environment.get_ontology_path', return_value=ontology_path):
                with patch('verify_environment.check_and_migrate_schema', return_value={
                    'schema_ready': True,
                    'schema_message': 'OK'
                }):
                    result = verify_environment(str(tmp_path))
                    
                    # boto3 should be marked as installed
                    assert result['details'].get('boto3') is True


class TestBedrockHealthProbe:
    """Plan 088: Bedrock health check with proven stable configuration."""

    def test_textout_model_has_content_field(self):
        """TextOut response model must have a content field."""
        from bedrock_health import TextOut
        
        instance = TextOut(content="test")
        assert instance.content == "test"

    def test_health_check_uses_correct_max_tokens(self):
        """Health check must use max_completion_tokens=2048 (proven stable)."""
        from bedrock_health import BEDROCK_PROBE_MAX_TOKENS
        
        assert BEDROCK_PROBE_MAX_TOKENS == 2048

    def test_health_check_uses_strict_json_prompt(self):
        """Health check must use strict JSON instruction in prompt."""
        from bedrock_health import BEDROCK_PROBE_SYSTEM_PROMPT
        
        # Must instruct JSON output explicitly
        assert 'JSON' in BEDROCK_PROBE_SYSTEM_PROMPT
        assert 'content' in BEDROCK_PROBE_SYSTEM_PROMPT.lower()

    @pytest.mark.asyncio
    async def test_health_check_returns_success_on_valid_response(self):
        """Health check should return success when Bedrock responds correctly."""
        from bedrock_health import check_bedrock_health, TextOut
        
        # Mock the BedrockAdapter to return a valid TextOut response
        mock_result = TextOut(content="test")
        
        mock_adapter = MagicMock()
        mock_adapter.max_completion_tokens = 2048
        mock_adapter._create_bedrock_request = MagicMock(return_value={
            'messages': [],
            'model': 'amazon.nova-micro-v1:0'
        })
        mock_adapter.aclient = MagicMock()
        mock_adapter.aclient.chat = MagicMock()
        mock_adapter.aclient.chat.completions = MagicMock()
        mock_adapter.aclient.chat.completions.create = AsyncMock(return_value=mock_result)
        
        # Create mock module with BedrockAdapter
        mock_adapter_module = MagicMock()
        mock_adapter_module.BedrockAdapter = MagicMock(return_value=mock_adapter)
        
        # Patch the import inside check_bedrock_health
        with patch.dict('sys.modules', {
            'cognee.infrastructure.llm.structured_output_framework.litellm_instructor.llm.bedrock.adapter': mock_adapter_module
        }):
            result = await check_bedrock_health()
        
            assert result['success'] is True
            assert result['error'] is None

    @pytest.mark.asyncio
    async def test_health_check_returns_actionable_error_on_auth_failure(self):
        """Health check should return actionable error when auth fails."""
        from bedrock_health import check_bedrock_health
        
        mock_adapter = MagicMock()
        mock_adapter.max_completion_tokens = 2048
        mock_adapter._create_bedrock_request = MagicMock(return_value={
            'messages': [],
            'model': 'amazon.nova-micro-v1:0'
        })
        mock_adapter.aclient = MagicMock()
        mock_adapter.aclient.chat = MagicMock()
        mock_adapter.aclient.chat.completions = MagicMock()
        # Simulate auth error
        mock_adapter.aclient.chat.completions.create = AsyncMock(
            side_effect=Exception("ExpiredTokenException: The security token included in the request is expired")
        )
        
        # Create mock module with BedrockAdapter
        mock_adapter_module = MagicMock()
        mock_adapter_module.BedrockAdapter = MagicMock(return_value=mock_adapter)
        
        # Patch the import inside check_bedrock_health
        with patch.dict('sys.modules', {
            'cognee.infrastructure.llm.structured_output_framework.litellm_instructor.llm.bedrock.adapter': mock_adapter_module
        }):
            result = await check_bedrock_health()
            
            assert result['success'] is False
            assert 'error' in result
            assert result['error_code'] == 'BEDROCK_AUTH_ERROR'
            # Should have actionable remediation
            assert 'remediation' in result

    @pytest.mark.asyncio  
    async def test_health_check_uses_system_first_ordering(self):
        """Health check must use system-first message ordering (proven stable)."""
        from bedrock_health import check_bedrock_health, TextOut
        
        captured_request = {}
        
        async def capture_request(**kwargs):
            captured_request.update(kwargs)
            return TextOut(content="test")
        
        mock_adapter = MagicMock()
        mock_adapter.max_completion_tokens = 2048
        mock_adapter._create_bedrock_request = MagicMock(return_value={
            'messages': [
                {'role': 'user', 'content': 'test'},
                {'role': 'system', 'content': 'prompt'}
            ],
            'model': 'amazon.nova-micro-v1:0'
        })
        mock_adapter.aclient = MagicMock()
        mock_adapter.aclient.chat = MagicMock()
        mock_adapter.aclient.chat.completions = MagicMock()
        mock_adapter.aclient.chat.completions.create = capture_request
        
        # Create mock module with BedrockAdapter
        mock_adapter_module = MagicMock()
        mock_adapter_module.BedrockAdapter = MagicMock(return_value=mock_adapter)
        
        # Patch the import inside check_bedrock_health
        with patch.dict('sys.modules', {
            'cognee.infrastructure.llm.structured_output_framework.litellm_instructor.llm.bedrock.adapter': mock_adapter_module
        }):
            await check_bedrock_health()
            
            # Messages should be reordered to system-first
            messages = captured_request.get('messages', [])
            if len(messages) >= 2:
                assert messages[0]['role'] == 'system', "First message must be system role"


class TestCogneeProbeBypass:
    """Plan 088: Cognee internal probe must be bypassed for add-only ingest."""

    def test_bypass_sets_first_run_done_flag(self):
        """Bypass function must set _first_run_done = True on setup module."""
        from cognee_probe_bypass import apply_cognee_probe_bypass, reset_bypass, is_bypass_active
        
        # Reset to known state before test
        reset_bypass()
        assert not is_bypass_active(), "Bypass should be inactive after reset"
        
        # Apply bypass
        result = apply_cognee_probe_bypass()
        
        # Verify bypass was applied
        assert result is True, "apply_cognee_probe_bypass should return True"
        assert is_bypass_active(), "Bypass should be active after apply"

    def test_bypass_prevents_test_llm_connection_call(self):
        """After bypass, setup_and_check_environment should not call test_llm_connection."""
        from cognee_probe_bypass import apply_cognee_probe_bypass, is_bypass_active
        
        # Apply bypass
        apply_cognee_probe_bypass()
        
        # Verify the flag is set in the actual Cognee module
        import cognee.modules.pipelines.layers.setup_and_check_environment as setup_mod
        assert setup_mod._first_run_done is True, "_first_run_done should be True"
        
        # The flag being True means test_llm_connection will be skipped
        # in the actual setup_and_check_environment() function

    def test_bypass_is_idempotent(self):
        """Calling bypass multiple times should be safe."""
        from cognee_probe_bypass import apply_cognee_probe_bypass, is_bypass_active
        
        # Call multiple times
        result1 = apply_cognee_probe_bypass()
        result2 = apply_cognee_probe_bypass()
        result3 = apply_cognee_probe_bypass()
        
        # All should succeed
        assert result1 is True
        assert result2 is True
        assert result3 is True
        
        # Should still be active
        assert is_bypass_active()


class TestIngestBypassIntegration:
    """Plan 088: ingest.py must apply bypass before Cognee operations."""

    @pytest.fixture
    def temp_workspace(self, tmp_path, monkeypatch):
        """Create a temporary workspace with Cloud credentials."""
        workspace = tmp_path / "test_workspace"
        workspace.mkdir()
        
        # Create required .flowbaby directory structure
        flowbaby_dir = workspace / '.flowbaby'
        flowbaby_dir.mkdir()
        (flowbaby_dir / 'system').mkdir()
        (flowbaby_dir / 'data').mkdir()
        (flowbaby_dir / 'cache').mkdir()
        
        # Set AWS credentials
        monkeypatch.setenv('AWS_ACCESS_KEY_ID', 'AKIAIOSFODNN7EXAMPLE')
        monkeypatch.setenv('AWS_SECRET_ACCESS_KEY', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')
        monkeypatch.setenv('AWS_SESSION_TOKEN', 'test-session-token')
        monkeypatch.setenv('AWS_REGION', 'us-east-1')
        
        return workspace

    def test_ingest_imports_cognee_probe_bypass(self):
        """ingest.py must import and use cognee_probe_bypass module."""
        import ingest
        
        # Read the source to verify bypass is applied
        import inspect
        source = inspect.getsource(ingest.run_add_only)
        
        # Must import the bypass function
        assert 'apply_cognee_probe_bypass' in source
        assert 'cognee_probe_bypass' in source
        
    def test_bypass_called_before_cognee_import_in_add_only(self):
        """Bypass must be applied before cognee is imported in run_add_only."""
        import ingest
        import inspect
        source = inspect.getsource(ingest.run_add_only)
        
        # Find positions
        bypass_pos = source.find('apply_cognee_probe_bypass')
        cognee_import_pos = source.find('import cognee')
        
        assert bypass_pos != -1, "apply_cognee_probe_bypass not found"
        assert cognee_import_pos != -1, "import cognee not found"
        assert bypass_pos < cognee_import_pos, "Bypass must be applied before cognee import"

    def test_bypass_called_before_cognee_import_in_cognify_only(self):
        """Bypass must be applied before cognee is imported in run_cognify_only."""
        import ingest
        import inspect
        source = inspect.getsource(ingest.run_cognify_only)
        
        # Find positions
        bypass_pos = source.find('apply_cognee_probe_bypass')
        cognee_import_pos = source.find('import cognee')
        
        assert bypass_pos != -1, "apply_cognee_probe_bypass not found"
        assert cognee_import_pos != -1, "import cognee not found"
        assert bypass_pos < cognee_import_pos, "Bypass must be applied before cognee import"

    def test_bypass_called_before_cognee_import_in_sync(self):
        """Bypass must be applied before cognee is imported in run_sync."""
        import ingest
        import inspect
        source = inspect.getsource(ingest.run_sync)
        
        # Find positions
        bypass_pos = source.find('apply_cognee_probe_bypass')
        cognee_import_pos = source.find('import cognee')
        
        assert bypass_pos != -1, "apply_cognee_probe_bypass not found"
        assert cognee_import_pos != -1, "import cognee not found"
        assert bypass_pos < cognee_import_pos, "Bypass must be applied before cognee import"


class TestEmbeddingHealthDecision:
    """Plan 088 Section 5.1: Embedding health validation decision."""

    def test_embedding_bypass_decision_documented(self):
        """The bypass decision for embedding probe must be explicitly documented."""
        # This is a documentation/decision test - implementation should include
        # either a replacement embedding check OR explicit documentation that
        # embedding validation is deferred to first-use with clear error handling.
        from bedrock_health import EMBEDDING_HEALTH_DECISION
        
        assert EMBEDDING_HEALTH_DECISION is not None
        assert EMBEDDING_HEALTH_DECISION in ['DEFERRED', 'REPLACED']
        
        if EMBEDDING_HEALTH_DECISION == 'DEFERRED':
            # Must have clear error handling for embedding failures
            from bedrock_health import EMBEDDING_DEFERRED_ERROR_MESSAGE
            assert EMBEDDING_DEFERRED_ERROR_MESSAGE is not None
            assert 'embedding' in EMBEDDING_DEFERRED_ERROR_MESSAGE.lower()


class TestPreflightGateIntegration:
    """Plan 088: Bedrock health check must be an authoritative pre-flight gate."""

    def test_add_only_calls_bedrock_health_check(self):
        """run_add_only must call check_bedrock_health() as authoritative pre-flight."""
        import ingest
        import inspect
        source = inspect.getsource(ingest.run_add_only)
        
        # Must import and call the health check
        assert 'check_bedrock_health' in source, (
            "run_add_only must call check_bedrock_health() as authoritative pre-flight gate"
        )

    def test_health_check_before_cognee_operations(self):
        """Health check must run before any cognee operations in run_add_only."""
        import ingest
        import inspect
        source = inspect.getsource(ingest.run_add_only)
        
        health_check_pos = source.find('check_bedrock_health')
        cognee_import_pos = source.find('import cognee')
        
        assert health_check_pos != -1, "check_bedrock_health not found in run_add_only"
        assert health_check_pos < cognee_import_pos, (
            "Bedrock health check must run before cognee import (authoritative pre-flight)"
        )

    @pytest.mark.asyncio
    async def test_add_only_returns_error_on_health_check_failure(self, tmp_path, monkeypatch):
        """When Bedrock health check fails, run_add_only should return structured error."""
        import ingest
        
        # Setup workspace
        workspace = tmp_path / 'test_workspace'
        workspace.mkdir()
        flowbaby_dir = workspace / '.flowbaby'
        flowbaby_dir.mkdir()
        (flowbaby_dir / 'system').mkdir()
        (flowbaby_dir / 'data').mkdir()
        (flowbaby_dir / 'cache').mkdir()
        
        monkeypatch.setenv('AWS_ACCESS_KEY_ID', 'AKIAIOSFODNN7EXAMPLE')
        monkeypatch.setenv('AWS_SECRET_ACCESS_KEY', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')
        monkeypatch.setenv('AWS_SESSION_TOKEN', 'test-session-token')
        monkeypatch.setenv('AWS_REGION', 'us-east-1')
        
        # Mock health check to return failure - patch at the module where it's imported
        async def mock_health_check_failure(model=None):
            return {
                "success": False,
                "error": "AWS credentials expired",
                "error_code": "BEDROCK_AUTH_ERROR",
                "remediation": "Run 'Flowbaby Cloud: Login' to refresh credentials.",
                "raw_content": None,
            }
        
        import bedrock_health
        monkeypatch.setattr(bedrock_health, 'check_bedrock_health', mock_health_check_failure)
        
        # Call add_only - should return error from health check
        result = await ingest.run_add_only(
            summary_json={'title': 'test', 'summary': 'test', 'importance': 'medium', 'workspace_path': str(workspace)},
        )
        
        assert result['success'] is False
        assert result['error_code'] == 'BEDROCK_AUTH_ERROR'
        assert 'remediation' in result
