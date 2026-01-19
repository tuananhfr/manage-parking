"""
Authentication utilities for backend-central
"""
import os
import json
from datetime import datetime, timedelta
from typing import Optional, Dict
import bcrypt
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import requests
import logging

# JWT settings
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key-change-this-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 8

# HTTP Bearer scheme
security = HTTPBearer()

# Cache for users loaded from JSON/URL
_users_cache = None
_users_cache_time = None
CACHE_DURATION_SECONDS = 300  # 5 minutes


def load_users() -> Dict:
    """
    Load users from data/users.json or external URL.
    Cache for 5 minutes.
    """
    global _users_cache, _users_cache_time
    
    now = datetime.now()
    if _users_cache and _users_cache_time:
        elapsed = (now - _users_cache_time).total_seconds()
        if elapsed < CACHE_DURATION_SECONDS:
            return _users_cache
    
    users_file = os.path.join(os.path.dirname(__file__), "data", "users.json")
    
    try:
        # Load from JSON file
        with open(users_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Check if external_url is set
        external_url = data.get("external_url", "").strip()
        if external_url:
            try:
                response = requests.get(external_url, timeout=5)
                if response.status_code == 200:
                    external_data = response.json()
                    # Merge or replace users
                    data["users"] = external_data.get("users", data["users"])
                    logging.info(f"Loaded users from external URL: {external_url}")
            except Exception as e:
                logging.warning(f"Failed to load users from external URL: {e}, using local file")
        
        _users_cache = data
        _users_cache_time = now
        return data
    except Exception as e:
        logging.error(f"Failed to load users: {e}")
        return {"users": []}


def clear_user_cache():
    """Clear internal user cache to force reload"""
    global _users_cache, _users_cache_time
    _users_cache = None
    _users_cache_time = None


def get_user_by_username(username: str) -> Optional[Dict]:
    """Get user by username"""
    data = load_users()
    for user in data.get("users", []):
        if user["username"] == username:
            return user
    return None


def get_user_by_id(user_id: int) -> Optional[Dict]:
    """Get user by user  ID"""
    data = load_users()
    for user in data.get("users", []):
        if user["id"] == user_id:
            return user
    return None


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against hash using bcrypt directly"""
    try:
        return bcrypt.checkpw(
            plain_password.encode('utf-8'),
            hashed_password.encode('utf-8')
        )
    except Exception:
        return False


def create_access_token(data: dict) -> str:
    """Create JWT access token"""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def decode_token(token: str) -> Optional[Dict]:
    """Decode and verify JWT token"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> Dict:
    """
    Dependency to get current authenticated user from JWT token.
    Returns user info directly from JWT payload (no file lookup).
    Raises 401 if token invalid.
    """
    token = credentials.credentials
    payload = decode_token(token)
    
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user_id = payload.get("user_id")
    username = payload.get("username")
    role = payload.get("role")
    
    if user_id is None or username is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Return user object built from JWT payload
    return {
        "id": user_id,
        "username": username,
        "full_name": username,  # JWT doesn't store full_name separately
        "role": role or "guard"
    }


async def require_manager(user: Dict = Depends(get_current_user)) -> Dict:
    """
    Dependency to require manager role.
    Raises 403 if user is not manager.
    """
    if user["role"] != "manager":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Manager role required"
        )
    return user


async def require_guard_or_manager(user: Dict = Depends(get_current_user)) -> Dict:
    """
    Dependency to require guard or manager role (basically any authenticated user).
    """
    return user
