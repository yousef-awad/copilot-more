import queue
import threading
import time
import json
import asyncio
from typing import List, Optional, Dict

from aiohttp import ClientSession

from copilot_more.logger import logger
from copilot_more.settings import settings

# Dictionary to store cached tokens {token_index: {"token": str, "expires_at": int}}
CACHED_TOKENS: Dict[int, dict] = {}

# Dictionary to store token errors
TOKEN_ERRORS: Dict[int, str] = {}

TOKEN_LOCK = threading.Lock()
TOKEN_CACHE_QUEUE: queue.Queue = queue.Queue(maxsize=1)

def get_all_tokens() -> List[str]:
    """Get all available refresh tokens."""
    return [token.strip() for token in settings.refresh_token.split(",")]

def get_current_token_index() -> int:
    """Get the index of the currently active token."""
    return settings.active_token_index

def set_current_token_index(index: int) -> None:
    """Set the active token index."""
    if 0 <= index < len(get_all_tokens()):
        settings.active_token_index = index
        logger.info(f"Switched to token {index}")
    else:
        raise ValueError(f"Invalid token index: {index}")

def cache_copilot_token(token_data: dict, index: int) -> None:
    """Cache a token for a specific index."""
    logger.info(f"Caching token for index {index}")
    global CACHED_TOKENS
    with TOKEN_LOCK:
        logger.debug(
            f"Caching new token at index {index} that expires at {token_data.get('expires_at')}"
        )
        CACHED_TOKENS[index] = token_data
        # Clear any error state for this token since it's now working
        if index in TOKEN_ERRORS:
            del TOKEN_ERRORS[index]
        logger.debug("Token cached successfully")

def record_token_error(index: int, error_msg: str) -> None:
    """Record an error for a specific token."""
    global TOKEN_ERRORS
    TOKEN_ERRORS[index] = error_msg
    logger.error(f"Token {index} error: {error_msg}")

def get_token_errors() -> Dict[int, str]:
    """Get all recorded token errors."""
    return TOKEN_ERRORS

async def get_cached_copilot_token() -> dict:
    """Get the currently active cached token, refreshing if necessary."""
    current_index = get_current_token_index()
    with TOKEN_LOCK:
        current_time = time.time()
        if current_index in CACHED_TOKENS:
            cached_token = CACHED_TOKENS[current_index]
            expires_at = cached_token.get("expires_at", 0)
            logger.info(
                f"Current token (index {current_index}) expires at {expires_at}, current time is {current_time}"
            )

            if expires_at > time.time() + 300:
                logger.info(f"Using cached token at index {current_index}")
                return cached_token

    logger.info(f"Token at index {current_index} expired or not found, refreshing...")
    try:
        new_token = await refresh_token(current_index)
        logger.info(
            f"Token at index {current_index} refreshed successfully, expires at {new_token.get('expires_at')}"
        )
        cache_copilot_token(new_token, current_index)
        return new_token
    except ValueError as e:
        # If current token fails, try next available token
        await try_next_valid_token()
        return await get_cached_copilot_token()

async def try_next_valid_token() -> None:
    """Try to switch to the next valid token."""
    current_index = get_current_token_index()
    tokens = get_all_tokens()
    
    # Try each subsequent token
    for i in range(current_index + 1, len(tokens)):
        try:
            # Add delay before trying next token
            await asyncio.sleep(2)
            logger.info(f"Attempting to switch to token {i}...")
            
            # Try to refresh the token first to validate it
            await refresh_token(i)
            # If successful, switch to this token
            set_current_token_index(i)
            logger.info(f"Successfully switched to token {i}")
            return
        except ValueError as e:
            logger.error(f"Token {i} also failed: {str(e)}")
            await asyncio.sleep(1)  # Add small delay between failures
            continue
    
    # If we get here, all remaining tokens failed
    raise ValueError("All available tokens have failed")

def parse_github_error(response_text: str) -> str:
    """Parse GitHub API error response to get the relevant error message."""
    try:
        error_data = json.loads(response_text)
        if isinstance(error_data, dict):
            if 'error_details' in error_data:
                return error_data['error_details'].get('message', '')
            elif 'message' in error_data:
                return error_data['message']
    except json.JSONDecodeError:
        pass
    return response_text

async def refresh_token(token_index: int = None) -> dict:
    """Refresh a specific token or the currently active token."""
    if token_index is None:
        token_index = get_current_token_index()
    
    tokens = get_all_tokens()
    if token_index < 0 or token_index >= len(tokens):
        raise ValueError(f"Invalid token index: {token_index}")

    refresh_token_str = tokens[token_index]
    logger.info(f"Attempting to refresh token at index {token_index}")

    try:
        async with ClientSession() as session:
            async with session.get(
                url="https://api.github.com/copilot_internal/v2/token",
                headers={
                    "Authorization": "token " + refresh_token_str,
                    "editor-version": settings.editor_version,
                },
            ) as response:
                response_text = await response.text()
                if response.status == 200:
                    token_data = json.loads(response_text)
                    # Clear any previous error state for this token
                    if token_index in TOKEN_ERRORS:
                        del TOKEN_ERRORS[token_index]
                    return token_data
                
                # For non-200 responses, extract the meaningful error message
                error_message = parse_github_error(response_text)
                full_error = f"Failed to refresh token at index {token_index}: {response.status} {error_message}"
                record_token_error(token_index, full_error)
                
                if token_index == get_current_token_index():
                    # If this is the current token, try to switch to next valid token
                    await try_next_valid_token()
                    return await refresh_token()
                
                raise ValueError(full_error)
    except Exception as e:
        full_error = f"Failed to refresh token at index {token_index}: {str(e)}"
        record_token_error(token_index, full_error)
        raise ValueError(full_error)
