import logging
import logging.handlers
import sys
import json
import os
from datetime import datetime

class JsonFormatter(logging.Formatter):
    """
    Formatter that outputs JSON strings for structured logging.
    """
    def format(self, record):
        log_record = {
            "timestamp": datetime.fromtimestamp(record.created).isoformat(),
            "level": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
            "module": record.module,
            "line": record.lineno
        }
        
        # Add extra fields if present in record.__dict__
        # This allows passing extra={'data': ...} to logger calls
        if hasattr(record, 'data'):
            log_record['data'] = record.data
            
        return json.dumps(log_record)

def setup_logging(workspace_path, script_name):
    """
    Configure logging for bridge scripts.
    
    Args:
        workspace_path (str): Path to the workspace root (where .cognee is located)
        script_name (str): Name of the script (e.g., 'retrieve', 'ingest')
    
    Returns:
        logging.Logger: Configured logger instance
    """
    # Create logger
    logger = logging.getLogger(f"cognee.{script_name}")
    logger.setLevel(logging.DEBUG)
    
    # Prevent propagation to root logger to avoid double logging if root is configured
    logger.propagate = False
    
    # Clear existing handlers to avoid duplicates if setup_logging is called multiple times
    if logger.handlers:
        logger.handlers.clear()
    
    # 1. File Handler - Full detailed logs (rotating)
    try:
        log_dir = os.path.join(workspace_path, ".cognee", "logs")
        os.makedirs(log_dir, exist_ok=True)
        
        log_file = os.path.join(log_dir, "bridge.log")
        
        # Rotate at 5MB, keep 3 backups
        file_handler = logging.handlers.RotatingFileHandler(
            log_file, maxBytes=5*1024*1024, backupCount=3, encoding='utf-8'
        )
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(JsonFormatter())
        logger.addHandler(file_handler)
        
    except Exception as e:
        # If we can't write to file, just ignore (stderr will still work)
        # We write to stderr directly here because logger isn't fully set up
        sys.stderr.write(f'{{"level": "WARN", "message": "Failed to setup file logging: {str(e)}"}}\n')

    # 2. Stderr Handler - JSON-Lines for VS Code extension
    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.setLevel(logging.DEBUG) # Send everything to VS Code, let it filter
    stderr_handler.setFormatter(JsonFormatter())
    logger.addHandler(stderr_handler)
    
    return logger
