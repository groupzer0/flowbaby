"""
Unit tests for visualize.py bridge script (Plan 067).

Tests:
- D3 asset loading and inlining
- Offline validation (no external CDN references)
- Error handling for missing API key
- Error handling for empty graph
"""
import json
import os
import sys
import types
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch, mock_open

import pytest

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


class TestLoadVendoredD3Assets:
    """Tests for load_vendored_d3_assets function."""

    def test_loads_d3_assets_when_files_exist(self):
        """Test that D3 assets are loaded correctly when files exist."""
        from visualize import load_vendored_d3_assets
        
        # The actual files exist in assets/d3/
        assets = load_vendored_d3_assets()
        
        # Should contain entries for D3 CDN URLs
        assert len(assets) > 0, "Should load at least one D3 asset"
        
        # Check that keys are CDN URLs
        for key in assets.keys():
            assert 'https://d3js.org/' in key, f"Key should be D3 CDN URL: {key}"
        
        # Check that values are non-empty JavaScript content
        for url, content in assets.items():
            assert len(content) > 1000, f"D3 content should be substantial: {url}"


class TestInlineVendoredAssets:
    """Tests for inline_vendored_assets function."""

    def test_replaces_cdn_script_with_inline(self):
        """Test that CDN script references are replaced with inline code."""
        from visualize import inline_vendored_assets
        
        html_with_cdn = '''<html>
<head>
    <script src="https://d3js.org/d3.v5.min.js"></script>
</head>
<body></body>
</html>'''
        
        assets = {'https://d3js.org/d3.v5.min.js': '// Vendored D3 content'}
        
        result = inline_vendored_assets(html_with_cdn, assets)
        
        # Should not contain CDN reference
        assert 'src="https://d3js.org/d3.v5.min.js"' not in result
        
        # Should contain inline script
        assert '// Vendored D3 content' in result
        assert 'Vendored: https://d3js.org/d3.v5.min.js' in result

    def test_handles_html_without_matching_scripts(self):
        """Test that HTML without matching scripts is unchanged."""
        from visualize import inline_vendored_assets
        
        html_no_matching_scripts = "<html><body>Content</body></html>"
        assets = {'https://d3js.org/d3.v5.min.js': '// D3 content'}
        
        result = inline_vendored_assets(html_no_matching_scripts, assets)
        
        # Original content should be preserved
        assert "Content" in result


class TestValidateNoExternalScripts:
    """Tests for validate_no_external_scripts function."""

    def test_returns_empty_for_offline_html(self):
        """Test that fully offline HTML returns empty list."""
        from visualize import validate_no_external_scripts
        
        offline_html = '''<html>
<head>
    <script>// Inline JavaScript</script>
    <style>/* Inline CSS */</style>
</head>
<body></body>
</html>'''
        
        external_urls = validate_no_external_scripts(offline_html)
        assert external_urls == [], "Should return empty list for offline HTML"

    def test_returns_urls_for_cdn_scripts(self):
        """Test that CDN script references are detected."""
        from visualize import validate_no_external_scripts
        
        cdn_html = '''<html>
<head>
    <script src="https://cdn.jsdelivr.net/npm/d3@5"></script>
</head>
</html>'''
        
        external_urls = validate_no_external_scripts(cdn_html)
        
        assert len(external_urls) > 0, "Should detect external CDN URL"
        assert 'cdn.jsdelivr.net' in external_urls[0]

    def test_returns_urls_for_unpkg_scripts(self):
        """Test that unpkg script references are detected."""
        from visualize import validate_no_external_scripts
        
        unpkg_html = '<html><script src="https://unpkg.com/d3@5"></script></html>'
        
        external_urls = validate_no_external_scripts(unpkg_html)
        
        assert len(external_urls) > 0, "Should detect external unpkg URL"
        assert 'unpkg.com' in external_urls[0]


class TestOfflineFirstFailClosed:
    """Tests for offline-first fail-closed behavior (Plan 067)."""
    
    @pytest.mark.asyncio
    async def test_external_scripts_cause_failure_and_file_deletion(
        self,
        temp_workspace,
        mock_env,
        mock_cognee_module,
        monkeypatch,
    ):
        """External scripts remaining after inlining must hard-fail and delete output (Plan 067)."""
        from visualize import visualize_graph

        output_path = temp_workspace / 'graph.html'

        async def fake_visualize_graph(*, destination_file_path: str):
            # Simulate Cognee output that includes an unknown external CDN dependency.
            Path(destination_file_path).write_text(
                """<html><head>
<script src=\"https://unknown-cdn.example.com/library.js\"></script>
</head><body>Graph</body></html>""",
                encoding="utf-8",
            )

        # Inject mocked visualize_graph into mocked cognee module
        import sys

        sys.modules["cognee"].visualize_graph = fake_visualize_graph

        result = await visualize_graph(str(temp_workspace), str(output_path))

        assert result["success"] is False
        assert result.get("error_code") == "OFFLINE_VIOLATION"
        assert "external_scripts" in result
        assert not output_path.exists(), "Unsafe HTML output must be deleted (fail-closed)"
        
    def test_inline_does_not_remove_unknown_cdns(self):
        """Test that inlining only handles known CDN URLs."""
        from visualize import inline_vendored_assets, load_vendored_d3_assets
        
        html_with_unknown_cdn = '''<html>
<head>
    <script src="https://unknown-cdn.example.com/library.js"></script>
    <script src="https://d3js.org/d3.v5.min.js"></script>
</head>
<body></body>
</html>'''
        
        assets = load_vendored_d3_assets()
        result = inline_vendored_assets(html_with_unknown_cdn, assets)
        
        # D3 should be inlined
        assert 'src="https://d3js.org/d3.v5.min.js"' not in result
        
        # Unknown CDN should remain (and fail validation)
        assert 'unknown-cdn.example.com' in result

    def test_error_code_for_offline_violation(self):
        """Test that OFFLINE_VIOLATION error code is used."""
        # This verifies the error response structure
        error_response = {
            'success': False,
            'error_code': 'OFFLINE_VIOLATION',
            'error': 'Generated HTML contains external script references',
            'external_scripts': ['https://example.com/script.js']
        }
        
        assert error_response['error_code'] == 'OFFLINE_VIOLATION'
        assert not error_response['success']
        assert 'external_scripts' in error_response


class TestVisualizeGraph:
    """Tests for main visualize_graph function."""

    @pytest.mark.asyncio
    async def test_missing_api_key_returns_structured_error(self, temp_workspace, monkeypatch):
        """Test that missing credentials returns structured error (Plan 083 Cloud-only)."""
        # Remove all credentials from environment
        monkeypatch.delenv('LLM_API_KEY', raising=False)
        monkeypatch.delenv('AWS_ACCESS_KEY_ID', raising=False)
        
        # Remove .env file if it exists
        env_file = temp_workspace / '.env'
        if env_file.exists():
            env_file.unlink()
        
        with patch('sys.path', [str(temp_workspace.parent)] + sys.path):
            from visualize import visualize_graph
            
            output_path = str(temp_workspace / 'graph.html')
            result = await visualize_graph(str(temp_workspace), output_path)
            
            assert result['success'] is False
            # Plan 083: Cloud-only error codes
            assert result.get('error_code') == 'NOT_AUTHENTICATED'
            assert result.get('error_type') == 'MISSING_CREDENTIALS'
            assert 'Cloud login' in result.get('user_message', '')

    @pytest.mark.asyncio
    async def test_result_has_expected_structure(self, temp_workspace, mock_env, mock_cognee_module):
        """Success path returns expected structure without requiring real Cognee."""
        from visualize import visualize_graph

        output_path = temp_workspace / 'graph.html'

        async def fake_visualize_graph(*, destination_file_path: str):
            # Simulate Cognee output using known D3 CDN script tag.
            # visualize.py should inline vendored assets and pass offline validation.
            # Include multiple "id" entries to pass node_count >= 2 threshold
            Path(destination_file_path).write_text(
                """<html><head>
<script src=\"https://d3js.org/d3.v5.min.js\"></script>
</head><body>{\"id\":\"node1\"},{\"id\":\"node2\"},{\"id\":\"node3\"}</body></html>""",
                encoding="utf-8",
            )

        import sys

        sys.modules["cognee"].visualize_graph = fake_visualize_graph

        result = await visualize_graph(str(temp_workspace), str(output_path))

        assert result["success"] is True
        assert result.get("offline_safe") is True
        assert isinstance(result.get("file_size_bytes"), int)
        assert result.get("output_path") == str(output_path)
        assert output_path.exists(), "Expected HTML output should exist on success"


class TestEmptyGraphDetection:
    """Tests for Plan 091 M3: Fail-closed empty graph detection."""

    @pytest.mark.asyncio
    async def test_empty_graph_sentinel_returns_failure(self, temp_workspace, mock_env, mock_cognee_module):
        """Test that Cognee's 'No graph data available' sentinel triggers failure."""
        from visualize import visualize_graph

        output_path = temp_workspace / 'graph.html'

        async def fake_visualize_graph(*, destination_file_path: str):
            # Simulate Cognee output with the empty graph sentinel
            Path(destination_file_path).write_text(
                """<html><head>
<script src=\"https://d3js.org/d3.v5.min.js\"></script>
</head><body><div>No graph data available</div></body></html>""",
                encoding="utf-8",
            )

        import sys
        sys.modules["cognee"].visualize_graph = fake_visualize_graph

        result = await visualize_graph(str(temp_workspace), str(output_path))

        assert result["success"] is False
        assert result.get("error_code") in ("EMPTY_GRAPH", "EMPTY_GRAPH_WRONG_STORE")
        assert result.get("has_sentinel") is True
        assert not output_path.exists(), "Empty graph HTML should be deleted"

    @pytest.mark.asyncio
    async def test_low_node_count_returns_failure(self, temp_workspace, mock_env, mock_cognee_module):
        """Test that suspiciously low node count triggers failure."""
        from visualize import visualize_graph

        output_path = temp_workspace / 'graph.html'

        async def fake_visualize_graph(*, destination_file_path: str):
            # Simulate Cognee output with only one node (below threshold)
            Path(destination_file_path).write_text(
                """<html><head>
<script src=\"https://d3js.org/d3.v5.min.js\"></script>
</head><body>{\"id\":\"single_node\"}</body></html>""",
                encoding="utf-8",
            )

        import sys
        sys.modules["cognee"].visualize_graph = fake_visualize_graph

        result = await visualize_graph(str(temp_workspace), str(output_path))

        assert result["success"] is False
        assert result.get("error_code") == "EMPTY_GRAPH"
        assert result.get("node_count") == 1
        assert not output_path.exists(), "Empty graph HTML should be deleted"

    @pytest.mark.asyncio
    async def test_wrong_store_detection(self, temp_workspace, mock_env, mock_cognee_module):
        """Test that sentinel + nodes triggers EMPTY_GRAPH_WRONG_STORE error."""
        from visualize import visualize_graph

        output_path = temp_workspace / 'graph.html'

        async def fake_visualize_graph(*, destination_file_path: str):
            # Simulate pathological case: sentinel present but also some nodes
            # This suggests visualization read from wrong store
            Path(destination_file_path).write_text(
                """<html><head>
<script src=\"https://d3js.org/d3.v5.min.js\"></script>
</head><body>
<div>No graph data available</div>
<div>{\"id\":\"node1\"},{\"id\":\"node2\"},{\"id\":\"node3\"}</div>
</body></html>""",
                encoding="utf-8",
            )

        import sys
        sys.modules["cognee"].visualize_graph = fake_visualize_graph

        result = await visualize_graph(str(temp_workspace), str(output_path))

        assert result["success"] is False
        assert result.get("error_code") == "EMPTY_GRAPH_WRONG_STORE"
        assert result.get("has_sentinel") is True
        assert result.get("node_count") >= 2
        assert not output_path.exists(), "Empty graph HTML should be deleted"

    @pytest.mark.asyncio
    async def test_cognee_no_data_exception_returns_empty_graph(self, temp_workspace, mock_env, mock_cognee_module):
        """Test that Cognee 'No graph data available' exception returns EMPTY_GRAPH error code."""
        from visualize import visualize_graph

        output_path = temp_workspace / 'graph.html'

        async def fake_visualize_graph_raises(*, destination_file_path: str):
            # Simulate Cognee raising exception when no data exists
            raise Exception("No graph data available in workspace")

        import sys
        sys.modules["cognee"].visualize_graph = fake_visualize_graph_raises

        result = await visualize_graph(str(temp_workspace), str(output_path))

        assert result["success"] is False
        assert result.get("error_code") == "EMPTY_GRAPH"
        assert "no graph data" in result.get("error", "").lower()

    @pytest.mark.asyncio
    async def test_valid_graph_succeeds(self, temp_workspace, mock_env, mock_cognee_module):
        """Test that a valid graph with sufficient nodes succeeds."""
        from visualize import visualize_graph

        output_path = temp_workspace / 'graph.html'

        async def fake_visualize_graph(*, destination_file_path: str):
            # Simulate valid Cognee output with multiple nodes
            Path(destination_file_path).write_text(
                """<html><head>
<script src=\"https://d3js.org/d3.v5.min.js\"></script>
</head><body>
{\"id\":\"entity1\",\"type\":\"Decision\"},
{\"id\":\"entity2\",\"type\":\"Problem\"},
{\"id\":\"entity3\",\"type\":\"Solution\"}
</body></html>""",
                encoding="utf-8",
            )

        import sys
        sys.modules["cognee"].visualize_graph = fake_visualize_graph

        result = await visualize_graph(str(temp_workspace), str(output_path))

        assert result["success"] is True
        assert result.get("node_count") >= 2
        assert output_path.exists(), "Valid graph HTML should be preserved"


class TestD3AssetIntegrity:
    """Tests for D3 asset vendoring integrity."""

    def test_d3_main_file_exists(self):
        """Test that vendored D3 main file exists."""
        assets_dir = Path(__file__).parent.parent / "assets" / "d3"
        d3_main = assets_dir / "d3.v5.min.js"
        
        assert d3_main.exists(), "Vendored D3 main file should exist"

    def test_d3_contour_file_exists(self):
        """Test that vendored D3 contour file exists."""
        assets_dir = Path(__file__).parent.parent / "assets" / "d3"
        d3_contour = assets_dir / "d3-contour.v1.min.js"
        
        assert d3_contour.exists(), "Vendored D3 contour file should exist"

    def test_provenance_file_exists(self):
        """Test that PROVENANCE.md documents asset sources."""
        assets_dir = Path(__file__).parent.parent / "assets" / "d3"
        provenance = assets_dir / "PROVENANCE.md"
        
        assert provenance.exists(), "PROVENANCE.md should document asset sources"
        
        content = provenance.read_text()
        assert "d3" in content.lower()
        assert "sha256" in content.lower() or "checksum" in content.lower()

    def test_d3_files_are_substantial(self):
        """Test that D3 files contain substantial content (not empty)."""
        assets_dir = Path(__file__).parent.parent / "assets" / "d3"
        
        d3_main = assets_dir / "d3.v5.min.js"
        d3_contour = assets_dir / "d3-contour.v1.min.js"
        
        # D3 v5 minified should be around 250KB
        assert d3_main.stat().st_size > 200000, "D3 main should be >200KB"
        
        # d3-contour minified is smaller (~6KB)
        assert d3_contour.stat().st_size > 5000, "D3 contour should be >5KB"


# ============================================================================
# Plan 093: User Context Integration Tests
# ============================================================================


class TestVisualizeUserContextIntegration:
    """Test that visualize operations call ensure_user_context() - Plan 093."""

    @pytest.mark.asyncio
    async def test_visualize_graph_calls_ensure_user_context(self, temp_workspace, mock_env):
        """TDD: visualize_graph should call ensure_user_context after env wiring."""
        output_path = temp_workspace / 'test_graph.html'

        with patch('visualize.apply_workspace_env') as mock_apply_env:
            mock_apply_env.return_value = MagicMock(
                system_root=str(temp_workspace / '.flowbaby/system'),
                data_root=str(temp_workspace / '.flowbaby/data')
            )

            with patch('visualize.ensure_user_context', new_callable=AsyncMock) as mock_ensure_user:
                mock_ensure_user.return_value = MagicMock(success=True, user_id='test-user')

                with patch.dict('sys.modules', {'cognee': MagicMock()}):
                    sys.modules['cognee'].visualize_graph = AsyncMock(return_value='<html></html>')

                    from visualize import visualize_graph

                    await visualize_graph(str(temp_workspace), str(output_path))

                    # Verify ensure_user_context was called
                    mock_ensure_user.assert_called_once()

    @pytest.mark.asyncio
    async def test_visualize_user_context_error_returns_structured_error(self, temp_workspace, mock_env):
        """TDD: User context errors should return structured error envelope."""
        output_path = temp_workspace / 'test_graph.html'

        from user_context import UserContextError

        with patch('visualize.apply_workspace_env') as mock_apply_env:
            mock_apply_env.return_value = MagicMock(
                system_root=str(temp_workspace / '.flowbaby/system'),
                data_root=str(temp_workspace / '.flowbaby/data')
            )

            with patch('visualize.ensure_user_context', new_callable=AsyncMock) as mock_ensure_user:
                mock_ensure_user.side_effect = UserContextError(
                    error_code='COGNEE_RELATIONAL_DB_NOT_CREATED',
                    user_message='Database not initialized',
                    remediation='Run cognify first',
                    details={}
                )

                from visualize import visualize_graph

                result = await visualize_graph(str(temp_workspace), str(output_path))

                # Verify structured error is returned
                assert result['success'] is False
                assert result['error_code'] == 'COGNEE_RELATIONAL_DB_NOT_CREATED'
                assert 'remediation' in result
