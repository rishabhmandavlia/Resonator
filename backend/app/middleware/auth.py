"""
Authentication middleware for JWT token validation and user extraction.
"""

from fastapi import Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from jose import JWTError, jwt
from datetime import datetime, timedelta
import os
import logging

from database.database import get_db
from database.models import User

logger = logging.getLogger(__name__)

# Configuration
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))


def create_access_token(data: dict, expires_delta: timedelta = None) -> str:
    """
    Create a JWT access token.
    
    Args:
        data: Dictionary to encode in token (should include "sub" for user_id)
        expires_delta: Optional expiration time delta
    
    Returns:
        Encoded JWT token
    """
    if expires_delta is None:
        expires_delta = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    expire = datetime.utcnow() + expires_delta
    to_encode = {
        **data,
        "exp": expire,
        "iat": datetime.utcnow()
    }
    
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def verify_token(token: str) -> dict:
    """
    Verify JWT token and extract payload.
    
    Args:
        token: JWT token to verify
    
    Returns:
        Token payload dictionary
    
    Raises:
        HTTPException: If token is invalid or expired
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token: no user ID",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        return {"user_id": user_id, **payload}
    
    except JWTError as e:
        logger.warning(f"JWT verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user(
    request: Request,
    db: Session = Depends(get_db)
) -> str:
    """
    Extract and validate current user from JWT token in Authorization header.
    Returns the user ID as a string.
    
    Usage in routes:
        @router.get("/path")
        def endpoint(current_user: str = Depends(get_current_user)):
            # current_user will be the user_id string
    
    Args:
        request: HTTP request with Authorization header
        db: Database session
    
    Returns:
        User ID string
    
    Raises:
        HTTPException: If token is invalid or user not found
    """
    # Extract token from Authorization header
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        logger.warning("Missing Authorization header")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Parse Bearer token
    try:
        scheme, token = auth_header.split()
        if scheme.lower() != "bearer":
            raise ValueError("Invalid scheme")
    except ValueError:
        logger.warning(f"Invalid Authorization header format")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header format",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Verify token and get user
    payload = verify_token(token)
    user_id = payload.get("user_id")
    
    # Verify user exists in database
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        logger.warning(f"User {user_id} not found in database")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return user_id


async def get_current_user_optional(
    request: Request,
    db: Session = Depends(get_db)
) -> str | None:
    """
    Extract current user ID from JWT token if provided, returns None otherwise.
    
    Usage in routes for optional authentication:
        @router.get("/public")
        def endpoint(current_user: str = Depends(get_current_user_optional)):
            if current_user:
                # User is authenticated
            else:
                # User is anonymous
    
    Args:
        request: HTTP request (may or may not have Authorization header)
        db: Database session
    
    Returns:
        User ID string or None
    """
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        return None
    
    try:
        # Parse Bearer token
        scheme, token = auth_header.split()
        if scheme.lower() != "bearer":
            return None
        
        # Verify token and get user
        payload = verify_token(token)
        user_id = payload.get("user_id")
        
        # Verify user exists in database
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            return user_id
        return None
    except Exception as e:
        logger.debug(f"Optional auth extraction failed: {e}")
        return None
