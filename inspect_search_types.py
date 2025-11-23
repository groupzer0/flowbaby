
import sys
import os

# Add the path to site-packages if needed, or just rely on the environment
# Assuming cognee is installed in the environment
try:
    import cognee
    from cognee.modules.search.types import SearchType
    print("Available SearchTypes:")
    for t in SearchType:
        print(f"- {t.name}: {t.value}")
except ImportError as e:
    print(f"Error importing cognee: {e}")
except Exception as e:
    print(f"Error: {e}")
