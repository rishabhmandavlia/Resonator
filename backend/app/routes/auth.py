"""Authentication API routes with multi-account OAuth session support."""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field, field_serializer
from sqlalchemy.orm import Session

from app.middleware.auth import get_current_user
from app.services.email_auth_service import EmailAuthService
from app.services.oauth_service import OAuthService
from database.database import get_db
from database.models import SessionAccount, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class UserRegister(BaseModel):
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class ProviderResponse(BaseModel):
    id: str
    displayName: str
    isConfigured: bool
    supportsPrompt: bool


class ProviderListResponse(BaseModel):
    providers: list[ProviderResponse]


class LinkedProviderResponse(BaseModel):
    type: str
    label: str
    isInSession: bool
    isValid: bool
    expiresAt: int | None = None


class SessionAccountResponse(BaseModel):
    accountId: str
    userId: str
    email: str | None = None
    displayName: str | None = None
    avatarUrl: str | None = None
    isValid: bool
    invalidReason: str | None = None
    providers: list[LinkedProviderResponse]


class AuthSessionResponse(BaseModel):
    accounts: list[SessionAccountResponse]
    activeAccountId: str | None = None


class SwitchAccountRequest(BaseModel):
    accountId: str


class VerifyEmailRequest(BaseModel):
    email: EmailStr
    otp: str = Field(..., min_length=6, max_length=6)


class ResendOtpRequest(BaseModel):
    email: EmailStr


class RegistrationChallengeResponse(BaseModel):
    email: str
    message: str
    expiresAt: str
    resendAvailableAt: str
    resendCooldownSeconds: int
    resendAvailableInSeconds: int
    verificationType: str = "email_registration"
    provider: str | None = None


class UserResponse(BaseModel):
    id: str
    email: str
    created_at: datetime
    provider: str | None = None
    account_id: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None
    is_valid: bool = True

    @field_serializer("created_at")
    def serialize_datetime(self, value: datetime) -> str:
        return value.isoformat()


@router.get("/providers", response_model=ProviderListResponse)
async def list_auth_providers() -> ProviderListResponse:
    return ProviderListResponse(providers=OAuthService.list_providers())


@router.get("/session", response_model=AuthSessionResponse)
async def get_auth_session(
    request: Request,
    db: Session = Depends(get_db),
) -> AuthSessionResponse:
    session = OAuthService.get_session_from_request(request, db)
    return AuthSessionResponse(**OAuthService.serialize_session(session))


@router.get("/oauth/{provider}/start")
async def start_oauth_login(
    provider: str,
    request: Request,
    db: Session = Depends(get_db),
    prompt: str | None = Query("select_account"),
    add_account: bool = Query(False),
):
    try:
        response = await OAuthService.create_authorization_redirect(
            db,
            request,
            provider,
            prompt=prompt,
        )
        if add_account:
            response.headers["Cache-Control"] = "no-store"
        return response
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to start OAuth login for provider %s", provider)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to start OAuth login",
        ) from exc


@router.get("/oauth/{provider}/callback", name="oauth_callback")
async def oauth_callback(
    provider: str,
    request: Request,
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
    error_description: str | None = Query(None),
    db: Session = Depends(get_db),
):
    if error:
        redirect = OAuthService.build_frontend_url(
            "/login",
            {"authError": error_description or error},
        )
        return RedirectResponse(url=redirect, status_code=status.HTTP_302_FOUND)

    if not code or not state:
        redirect = OAuthService.build_frontend_url(
            "/login",
            {"authError": "Missing OAuth callback parameters"},
        )
        return RedirectResponse(url=redirect, status_code=status.HTTP_302_FOUND)

    try:
        return await OAuthService.handle_oauth_callback(db, request, provider, code, state)
    except HTTPException as exc:
        logger.warning("OAuth callback failed for %s: %s", provider, exc.detail)
        redirect = OAuthService.build_frontend_url(
            "/login",
            {"authError": str(exc.detail)},
        )
        return RedirectResponse(url=redirect, status_code=status.HTTP_302_FOUND)
    except Exception as exc:
        logger.exception("Unexpected OAuth callback failure for %s", provider)
        redirect = OAuthService.build_frontend_url(
            "/login",
            {"authError": "OAuth login failed"},
        )
        return RedirectResponse(url=redirect, status_code=status.HTTP_302_FOUND)


@router.post("/switch", response_model=AuthSessionResponse)
async def switch_active_account(
    payload: SwitchAccountRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AuthSessionResponse:
    session_payload = OAuthService.switch_account(db, request, payload.accountId)
    return AuthSessionResponse(**session_payload)


@router.delete("/accounts/{account_id}", response_model=AuthSessionResponse)
async def remove_account(
    account_id: str,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> AuthSessionResponse:
    session_payload, cleared_session = OAuthService.remove_account(db, request, account_id)
    if cleared_session:
        OAuthService.clear_session_cookie(response)
    return AuthSessionResponse(**session_payload)


@router.post("/logout-all", response_model=AuthSessionResponse)
async def logout_all_accounts(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> AuthSessionResponse:
    OAuthService.logout_all(db, request)
    OAuthService.clear_session_cookie(response)
    return AuthSessionResponse(accounts=[], activeAccountId=None)


@router.post("/register", response_model=RegistrationChallengeResponse)
async def register_email_account(
    payload: UserRegister,
    request: Request,
    db: Session = Depends(get_db),
) -> RegistrationChallengeResponse:
    try:
        challenge = EmailAuthService.start_registration(
            db,
            request,
            payload.email,
            payload.password,
        )
        return RegistrationChallengeResponse(**challenge)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to start OTP registration for %s", payload.email)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to start registration",
        ) from exc


@router.post("/verify-email", response_model=AuthSessionResponse)
async def verify_email_registration(
    payload: VerifyEmailRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> AuthSessionResponse:
    try:
        user = EmailAuthService.verify_registration_otp(
            db,
            request,
            payload.email,
            payload.otp,
        )
        session, _account = OAuthService.upsert_local_session_account(db, request, user)
        db.commit()
        db.refresh(session)
        OAuthService.set_session_cookie(response, session)
        return AuthSessionResponse(**OAuthService.serialize_session(session))
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to verify email registration for %s", payload.email)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to verify email",
        ) from exc


@router.post("/resend-otp", response_model=RegistrationChallengeResponse)
async def resend_registration_otp(
    payload: ResendOtpRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> RegistrationChallengeResponse:
    try:
        challenge = EmailAuthService.resend_otp(db, request, payload.email)
        return RegistrationChallengeResponse(**challenge)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to resend OTP for %s", payload.email)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to resend verification code",
        ) from exc


@router.post("/verify-oauth-link", response_model=AuthSessionResponse)
async def verify_oauth_link(
    payload: VerifyEmailRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> AuthSessionResponse:
    try:
        session, _account = OAuthService.verify_pending_oauth_link(
            db,
            request,
            payload.email,
            payload.otp,
        )
        OAuthService.set_session_cookie(response, session)
        return AuthSessionResponse(**OAuthService.serialize_session(session))
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to verify OAuth link for %s", payload.email)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to verify linked provider",
        ) from exc


@router.post("/resend-oauth-link", response_model=RegistrationChallengeResponse)
async def resend_oauth_link_otp(
    payload: ResendOtpRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> RegistrationChallengeResponse:
    try:
        challenge = OAuthService.resend_pending_oauth_link(db, request, payload.email)
        return RegistrationChallengeResponse(**challenge)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to resend OAuth link OTP for %s", payload.email)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to resend verification code",
        ) from exc


@router.post("/login", response_model=AuthSessionResponse)
async def login_email_account(
    payload: UserLogin,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> AuthSessionResponse:
    try:
        user = EmailAuthService.authenticate_user(db, payload.email, payload.password)
        session, _account = OAuthService.upsert_local_session_account(db, request, user)
        db.commit()
        db.refresh(session)
        OAuthService.set_session_cookie(response, session)
        return AuthSessionResponse(**OAuthService.serialize_session(session))
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed email login for %s", payload.email)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to sign in",
        ) from exc


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    request: Request,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserResponse:
    user = db.query(User).filter(User.id == current_user).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    active_account: SessionAccount | None = getattr(request.state, "active_account", None)
    return UserResponse(
        id=str(user.id),
        email=active_account.email or user.email if active_account else user.email,
        created_at=user.created_at,
        provider=active_account.provider if active_account else None,
        account_id=str(active_account.id) if active_account else None,
        display_name=active_account.display_name if active_account else user.username,
        avatar_url=active_account.avatar_url if active_account else None,
        is_valid=active_account.is_valid if active_account else True,
    )
