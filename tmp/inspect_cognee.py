import inspect
import cognee
import json
import os

def inspect_cognee():
    results = {}
    
    # 1. Inspect cognee.search signature
    try:
        sig = inspect.signature(cognee.search)
        results['cognee.search_signature'] = str(sig)
        results['cognee.search_params'] = [p.name for p in sig.parameters.values()]
    except Exception as e:
        results['cognee.search_error'] = str(e)

    # 2. Inspect cognee.config
    try:
        # Check if config is a module or object
        if hasattr(cognee, 'config'):
            config_attrs = dir(cognee.config)
            results['cognee.config_attributes'] = [a for a in config_attrs if not a.startswith('_')]
            
            # Check for specific LLM settings
            llm_settings = {}
            for attr in ['llm_config', 'system_prompt', 'temperature', 'llm_client']:
                if hasattr(cognee.config, attr):
                    llm_settings[attr] = str(getattr(cognee.config, attr))
            results['found_llm_settings'] = llm_settings
    except Exception as e:
        results['cognee.config_error'] = str(e)

    # 3. Check for infrastructure/LLM modules
    try:
        # Attempt to find where LLM is initialized
        import cognee.infrastructure.llm as llm_module
        results['llm_module_found'] = True
        results['llm_module_dir'] = [d for d in dir(llm_module) if not d.startswith('_')]
        
        # Check get_llm_config return value if possible (static analysis)
        if hasattr(llm_module, 'get_llm_config'):
             results['get_llm_config_doc'] = llm_module.get_llm_config.__doc__

    except ImportError:
        results['llm_module_found'] = False

    # 4. Inspect SearchResult
    try:
        from cognee.modules.search.types import SearchResult
        results['SearchResult_fields'] = list(SearchResult.SearchResult.__annotations__.keys())
    except Exception as e:
        results['SearchResult_error'] = str(e)

    print(json.dumps(results, indent=2))

if __name__ == "__main__":
    inspect_cognee()
