"""Authentication middleware supporting multi-account browser sessions and legacy JWT fallback."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.services.oauth_service import OAuthService
from database.database import get_db
from database.models import SessionAccount, User

logger = logging.getLogger(__name__)

SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """Create a legacy JWT access token."""
    if expires_delta is None:
        expires_delta = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    expire = datetime.utcnow() + expires_delta
    to_encode = {**data, "exp": expire, "iat": datetime.utcnow()}
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> dict:
    """Verify a legacy JWT access token."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token: no user ID",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return {"user_id": user_id, **payload}
    except JWTError as exc:
        logger.warning("JWT verification failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def _extract_bearer_token(request: Request) -> str | None:
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        return None

    try:
        scheme, token = auth_header.split()
    except ValueError:
        return None

    if scheme.lower() != "bearer":
        return None
    return token


async def get_current_session_account(
    request: Request,
    db: Session = Depends(get_db),
) -> SessionAccount:
    """Resolve the active OAuth account from the current browser session."""
    return await OAuthService.get_active_session_account(request, db)


async def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> str:
    """Resolve the current authenticated user from browser session or legacy JWT."""
    session = OAuthService.get_session_from_request(request, db)
    if session is not None and session.active_account_id is not None:
        account = await OAuthService.get_active_session_account(request, db)
        user = db.query(User).filter(User.id == account.user_id).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
            )
        return str(user.id)

    token = _extract_bearer_token(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = verify_token(token)
    user_id = payload.get("user_id")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return str(user.id)


async def get_current_user_optional(
    request: Request,
    db: Session = Depends(get_db),
) -> str | None:
    """Resolve the current user if available, otherwise return None."""
    try:
        return await get_current_user(request, db)
    except HTTPException:
        return None
