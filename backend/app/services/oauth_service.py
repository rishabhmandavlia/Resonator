"""OAuth and multi-account browser session services."""

from __future__ import annotations

import base64
from collections import defaultdict
import hashlib
import json
import logging
import os
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import parse_qsl, urlencode

import bcrypt
import httpx
from cryptography.fernet import Fernet
from fastapi import HTTPException, Request, status
from fastapi.responses import RedirectResponse, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.services.email_auth_service import EmailAuthService
from app.services.email_delivery_service import EmailDeliveryService
from database.models import (
    AuthSession,
    OAuthAuthorizationState,
    OAuthIdentity,
    PendingOAuthLink,
    SessionAccount,
    User,
)

logger = logging.getLogger(__name__)

SESSION_COOKIE_NAME = os.getenv("AUTH_SESSION_COOKIE_NAME", "ai_voice_session")
SESSION_COOKIE_MAX_AGE = int(os.getenv("AUTH_SESSION_MAX_AGE_SECONDS", str(60 * 60 * 24 * 30)))
SESSION_COOKIE_SECURE = os.getenv("AUTH_SESSION_COOKIE_SECURE", "false").lower() == "true"
SESSION_COOKIE_SAMESITE = os.getenv("AUTH_SESSION_COOKIE_SAMESITE", "lax")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
OAUTH_CALLBACK_BASE_URL = os.getenv("OAUTH_CALLBACK_BASE_URL", "").rstrip("/")
OAUTH_STATE_TTL_MINUTES = int(os.getenv("OAUTH_STATE_TTL_MINUTES", "10"))
OAUTH_REFRESH_SKEW_SECONDS = int(os.getenv("OAUTH_REFRESH_SKEW_SECONDS", "60"))


def _utcnow() -> datetime:
    return datetime.utcnow()


def _derive_fernet() -> Fernet:
    secret_material = os.getenv("OAUTH_TOKEN_ENCRYPTION_SECRET") or os.getenv(
        "SECRET_KEY",
        "development-secret-key",
    )
    key = base64.urlsafe_b64encode(
        hashlib.sha256(secret_material.encode("utf-8")).digest()
    )
    return Fernet(key)


TOKEN_FERNET = _derive_fernet()


@dataclass(frozen=True)
class OAuthProviderDefinition:
    provider: str
    display_name: str
    client_id_env: str
    client_secret_env: str
    scopes: tuple[str, ...]
    discovery_url: str | None = None
    authorize_url: str | None = None
    token_url: str | None = None
    userinfo_url: str | None = None
    email_url: str | None = None
    authorization_params: dict[str, str] = field(default_factory=dict)
    supports_prompt: bool = True
    is_oidc: bool = False

    @property
    def client_id(self) -> str | None:
        value = os.getenv(self.client_id_env)
        return value.strip() if value else None

    @property
    def client_secret(self) -> str | None:
        value = os.getenv(self.client_secret_env)
        return value.strip() if value else None

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.client_secret)


PROVIDER_DEFINITIONS: dict[str, OAuthProviderDefinition] = {
    "google": OAuthProviderDefinition(
        provider="google",
        display_name="Google",
        client_id_env="GOOGLE_OAUTH_CLIENT_ID",
        client_secret_env="GOOGLE_OAUTH_CLIENT_SECRET",
        scopes=("openid", "email", "profile"),
        discovery_url="https://accounts.google.com/.well-known/openid-configuration",
        userinfo_url="https://openidconnect.googleapis.com/v1/userinfo",
        authorization_params={
            "access_type": "offline",
            "include_granted_scopes": "true",
        },
        supports_prompt=True,
        is_oidc=True,
    ),
    "github": OAuthProviderDefinition(
        provider="github",
        display_name="GitHub",
        client_id_env="GITHUB_OAUTH_CLIENT_ID",
        client_secret_env="GITHUB_OAUTH_CLIENT_SECRET",
        scopes=("read:user", "user:email"),
        authorize_url="https://github.com/login/oauth/authorize",
        token_url="https://github.com/login/oauth/access_token",
        userinfo_url="https://api.github.com/user",
        email_url="https://api.github.com/user/emails",
        authorization_params={"allow_signup": "true"},
        supports_prompt=False,
        is_oidc=False,
    ),
}

LOCAL_EMAIL_PROVIDER = "email"
LOCAL_EMAIL_PROVIDER_LABEL = "Email"

_provider_metadata_cache: dict[str, dict[str, Any]] = {}


class OAuthService:
    """Service object for OAuth provider login and multi-account browser sessions."""

    @staticmethod
    def encrypt_token(token: str | None) -> str | None:
        if not token:
            return None
        return TOKEN_FERNET.encrypt(token.encode("utf-8")).decode("utf-8")

    @staticmethod
    def decrypt_token(token: str | None) -> str | None:
        if not token:
            return None
        return TOKEN_FERNET.decrypt(token.encode("utf-8")).decode("utf-8")

    @staticmethod
    def get_provider(provider: str) -> OAuthProviderDefinition:
        provider_definition = PROVIDER_DEFINITIONS.get(provider)
        if provider_definition is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Unsupported OAuth provider: {provider}",
            )
        if not provider_definition.configured:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"OAuth provider '{provider}' is not configured",
            )
        return provider_definition

    @staticmethod
    def list_providers() -> list[dict[str, Any]]:
        return [
            {
                "id": provider.provider,
                "displayName": provider.display_name,
                "isConfigured": provider.configured,
                "supportsPrompt": provider.supports_prompt,
            }
            for provider in PROVIDER_DEFINITIONS.values()
        ]

    @staticmethod
    def get_provider_label(provider_name: str) -> str:
        if provider_name == LOCAL_EMAIL_PROVIDER:
            return LOCAL_EMAIL_PROVIDER_LABEL
        provider = PROVIDER_DEFINITIONS.get(provider_name)
        if provider is not None:
            return provider.display_name
        return provider_name.title()

    @staticmethod
    def normalize_email(email: str | None) -> str | None:
        if not email:
            return None
        return email.strip().lower()

    @staticmethod
    def build_user_display_name(email: str | None, display_name: str | None) -> str:
        if display_name:
            return display_name[:255]
        if email:
            return email.split("@")[0][:255]
        return "User"

    @staticmethod
    def is_profile_email_trusted(
        provider: OAuthProviderDefinition,
        profile: dict[str, Any],
    ) -> bool:
        email = OAuthService.normalize_email(profile.get("email"))
        if not email:
            return False

        if provider.provider == "google":
            return bool(profile.get("email_verified", True))

        if provider.provider == "github":
            return bool(profile.get("email_verified"))

        return bool(profile.get("email_verified"))

    @staticmethod
    async def get_provider_metadata(provider: OAuthProviderDefinition) -> dict[str, Any]:
        if not provider.discovery_url:
            return {}

        cached = _provider_metadata_cache.get(provider.provider)
        if cached is not None:
            return cached

        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(provider.discovery_url)
            response.raise_for_status()
            metadata = response.json()

        _provider_metadata_cache[provider.provider] = metadata
        return metadata

    @staticmethod
    async def get_provider_endpoints(provider: OAuthProviderDefinition) -> dict[str, str | None]:
        metadata = await OAuthService.get_provider_metadata(provider)
        return {
            "authorize_url": provider.authorize_url or metadata.get("authorization_endpoint"),
            "token_url": provider.token_url or metadata.get("token_endpoint"),
            "userinfo_url": provider.userinfo_url or metadata.get("userinfo_endpoint"),
            "jwks_uri": metadata.get("jwks_uri"),
        }

    @staticmethod
    def build_pkce_pair() -> tuple[str, str]:
        code_verifier = secrets.token_urlsafe(64)
        digest = hashlib.sha256(code_verifier.encode("utf-8")).digest()
        code_challenge = base64.urlsafe_b64encode(digest).decode("utf-8").rstrip("=")
        return code_verifier, code_challenge

    @staticmethod
    def build_callback_url(request: Request, provider: str) -> str:
        if OAUTH_CALLBACK_BASE_URL:
            return f"{OAUTH_CALLBACK_BASE_URL}/api/auth/oauth/{provider}/callback"
        return str(request.url_for("oauth_callback", provider=provider))

    @staticmethod
    def build_frontend_url(path: str = "/", params: dict[str, str] | None = None) -> str:
        base = FRONTEND_URL.rstrip("/")
        normalized_path = path if path.startswith("/") else f"/{path}"
        url = f"{base}{normalized_path}"
        if params:
            url = f"{url}?{urlencode(params)}"
        return url

    @staticmethod
    def get_session_from_request(request: Request, db: Session) -> AuthSession | None:
        raw_session_id = request.cookies.get(SESSION_COOKIE_NAME)
        if not raw_session_id:
            return None

        try:
            session_uuid = uuid.UUID(raw_session_id)
        except ValueError:
            return None

        session = db.query(AuthSession).filter(AuthSession.id == session_uuid).first()
        if session:
            session.last_seen_at = _utcnow()
        return session

    @staticmethod
    def get_or_create_session(request: Request, db: Session) -> AuthSession:
        session = OAuthService.get_session_from_request(request, db)
        if session is not None:
            return session

        session = AuthSession(
            user_agent=request.headers.get("user-agent"),
            ip_address=request.client.host if request.client else None,
            created_at=_utcnow(),
            updated_at=_utcnow(),
            last_seen_at=_utcnow(),
        )
        db.add(session)
        db.flush()
        return session

    @staticmethod
    def set_session_cookie(response: Response, session: AuthSession | uuid.UUID) -> None:
        session_id = str(session.id if isinstance(session, AuthSession) else session)
        response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=session_id,
            max_age=SESSION_COOKIE_MAX_AGE,
            httponly=True,
            secure=SESSION_COOKIE_SECURE,
            samesite=SESSION_COOKIE_SAMESITE,
            path="/",
        )

    @staticmethod
    def clear_session_cookie(response: Response) -> None:
        response.delete_cookie(
            key=SESSION_COOKIE_NAME,
            path="/",
            samesite=SESSION_COOKIE_SAMESITE,
        )

    @staticmethod
    def cleanup_expired_authorization_states(db: Session) -> None:
        now = _utcnow()
        expired_states = (
            db.query(OAuthAuthorizationState)
            .filter(OAuthAuthorizationState.expires_at < now)
            .all()
        )
        for auth_state in expired_states:
            db.delete(auth_state)

    @staticmethod
    async def create_authorization_redirect(
        db: Session,
        request: Request,
        provider_name: str,
        prompt: str | None = "select_account",
    ) -> RedirectResponse:
        provider = OAuthService.get_provider(provider_name)
        endpoints = await OAuthService.get_provider_endpoints(provider)
        authorization_url = endpoints.get("authorize_url")
        if not authorization_url:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Provider '{provider_name}' is missing an authorization endpoint",
            )

        OAuthService.cleanup_expired_authorization_states(db)
        session = OAuthService.get_or_create_session(request, db)
        code_verifier, code_challenge = OAuthService.build_pkce_pair()
        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        callback_url = OAuthService.build_callback_url(request, provider_name)

        auth_state = OAuthAuthorizationState(
            session_id=session.id,
            provider=provider_name,
            state=state,
            nonce=nonce,
            code_verifier=code_verifier,
            prompt=prompt,
            created_at=_utcnow(),
            expires_at=_utcnow() + timedelta(minutes=OAUTH_STATE_TTL_MINUTES),
        )
        db.add(auth_state)

        query_params = {
            "client_id": provider.client_id,
            "redirect_uri": callback_url,
            "response_type": "code",
            "scope": " ".join(provider.scopes),
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            **provider.authorization_params,
        }

        if provider.supports_prompt and prompt:
            if provider.provider == "google" and "consent" not in prompt:
                query_params["prompt"] = f"consent {prompt}".strip()
            else:
                query_params["prompt"] = prompt

        if provider.is_oidc:
            query_params["nonce"] = nonce

        db.commit()

        response = RedirectResponse(
            url=f"{authorization_url}?{urlencode(query_params)}",
            status_code=status.HTTP_302_FOUND,
        )
        OAuthService.set_session_cookie(response, session)
        return response

    @staticmethod
    async def exchange_code_for_tokens(
        provider: OAuthProviderDefinition,
        request: Request,
        code: str,
        code_verifier: str,
    ) -> dict[str, Any]:
        endpoints = await OAuthService.get_provider_endpoints(provider)
        token_url = endpoints.get("token_url")
        if not token_url:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Provider '{provider.provider}' is missing a token endpoint",
            )

        payload = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": OAuthService.build_callback_url(request, provider.provider),
            "client_id": provider.client_id,
            "client_secret": provider.client_secret,
            "code_verifier": code_verifier,
        }

        headers = {"Accept": "application/json"}
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(token_url, data=payload, headers=headers)

        if response.status_code >= 400:
            logger.warning(
                "OAuth token exchange failed for %s: %s",
                provider.provider,
                response.text,
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to exchange authorization code with {provider.display_name}",
            )

        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            return response.json()
        return dict(parse_qsl(response.text))

    @staticmethod
    def normalize_expires_at(token_payload: dict[str, Any]) -> datetime | None:
        expires_at = token_payload.get("expires_at")
        if expires_at is not None:
            try:
                return datetime.utcfromtimestamp(float(expires_at))
            except (TypeError, ValueError):
                return None

        expires_in = token_payload.get("expires_in")
        if expires_in is not None:
            try:
                return _utcnow() + timedelta(seconds=int(expires_in))
            except (TypeError, ValueError):
                return None

        return None

    @staticmethod
    def normalize_scope(scope_value: Any, provider: OAuthProviderDefinition) -> str:
        if isinstance(scope_value, list):
            scopes = scope_value
        elif isinstance(scope_value, str) and scope_value.strip():
            scopes = scope_value.replace(",", " ").split()
        else:
            scopes = list(provider.scopes)
        return json.dumps(scopes)

    @staticmethod
    async def fetch_user_profile(
        provider: OAuthProviderDefinition,
        token_payload: dict[str, Any],
    ) -> dict[str, Any]:
        access_token = token_payload.get("access_token")
        if not access_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{provider.display_name} did not return an access token",
            )

        headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}

        if provider.provider == "github":
            headers["X-GitHub-Api-Version"] = "2022-11-28"
            async with httpx.AsyncClient(timeout=20.0) as client:
                user_response = await client.get(provider.userinfo_url, headers=headers)
                user_response.raise_for_status()
                user_data = user_response.json()

                email = user_data.get("email")
                email_verified = False
                if not email and provider.email_url:
                    email_response = await client.get(provider.email_url, headers=headers)
                    email_response.raise_for_status()
                    emails = email_response.json()
                    selected_email = next(
                        (
                            item
                            for item in emails
                            if item.get("primary") and item.get("verified")
                        ),
                        None,
                    )
                    if selected_email is None:
                        selected_email = next(
                            (item for item in emails if item.get("verified")),
                            None,
                        )
                    if selected_email is None:
                        selected_email = next(
                            (item for item in emails if item.get("primary")),
                            None,
                        )
                    if selected_email is None and emails:
                        selected_email = emails[0]

                    if selected_email is not None:
                        email = selected_email.get("email")
                        email_verified = bool(selected_email.get("verified"))

            return {
                "subject": str(user_data.get("id") or user_data.get("node_id")),
                "email": email,
                "email_verified": email_verified,
                "display_name": user_data.get("name") or user_data.get("login"),
                "avatar_url": user_data.get("avatar_url"),
            }

        endpoints = await OAuthService.get_provider_endpoints(provider)
        userinfo_url = endpoints.get("userinfo_url")
        if not userinfo_url:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Provider '{provider.provider}' is missing a userinfo endpoint",
            )

        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(userinfo_url, headers=headers)
            response.raise_for_status()
            profile = response.json()

        return {
            "subject": str(profile.get("sub") or profile.get("id")),
            "email": profile.get("email"),
            "email_verified": bool(profile.get("email_verified", profile.get("email"))),
            "display_name": profile.get("name") or profile.get("preferred_username"),
            "avatar_url": profile.get("picture"),
        }

    @staticmethod
    def build_password_placeholder() -> str:
        salt = bcrypt.gensalt()
        return bcrypt.hashpw(uuid.uuid4().hex.encode("utf-8"), salt).decode("utf-8")

    @staticmethod
    def get_identity_by_subject(
        db: Session,
        provider: OAuthProviderDefinition,
        profile: dict[str, Any],
    ) -> OAuthIdentity | None:
        subject = profile.get("subject")
        if not subject:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{provider.display_name} did not return a stable user identifier",
            )

        return (
            db.query(OAuthIdentity)
            .filter(
                OAuthIdentity.provider == provider.provider,
                OAuthIdentity.provider_subject == subject,
            )
            .first()
        )

    @staticmethod
    def link_verified_identity(
        db: Session,
        provider: OAuthProviderDefinition,
        profile: dict[str, Any],
    ) -> tuple[User, OAuthIdentity]:
        subject = profile.get("subject")
        normalized_email = OAuthService.normalize_email(profile.get("email"))
        if not subject or not normalized_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{provider.display_name} did not return a verified email address",
            )

        identity = OAuthService.get_identity_by_subject(db, provider, profile)
        user = identity.user if identity else None

        if user is None:
            user = (
                db.query(User)
                .filter(func.lower(User.email) == normalized_email)
                .first()
            )

        if user is None:
            user = User(
                email=normalized_email,
                username=OAuthService.build_user_display_name(
                    normalized_email,
                    profile.get("display_name"),
                ),
                password_hash=OAuthService.build_password_placeholder(),
                is_active=True,
                is_admin=False,
                is_verified=True,
                is_email_verified=True,
                has_email_auth=False,
                created_at=_utcnow(),
                updated_at=_utcnow(),
                last_login=_utcnow(),
            )
            db.add(user)
            db.flush()
        else:
            existing_provider_identity = (
                db.query(OAuthIdentity)
                .filter(
                    OAuthIdentity.user_id == user.id,
                    OAuthIdentity.provider == provider.provider,
                )
                .first()
            )
            if (
                existing_provider_identity is not None
                and existing_provider_identity.provider_subject != subject
                and (identity is None or existing_provider_identity.id != identity.id)
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        f"A different {provider.display_name} account is already linked to this email."
                    ),
                )

            user.email = normalized_email
            user.username = user.username or OAuthService.build_user_display_name(
                normalized_email,
                profile.get("display_name"),
            )
            user.is_active = True
            user.is_verified = True
            user.is_email_verified = True
            user.updated_at = _utcnow()
            user.last_login = _utcnow()

        if identity is None:
            identity = OAuthIdentity(
                user_id=user.id,
                provider=provider.provider,
                provider_subject=subject,
                email=normalized_email,
                email_verified=True,
                display_name=profile.get("display_name"),
                avatar_url=profile.get("avatar_url"),
                created_at=_utcnow(),
                updated_at=_utcnow(),
                last_login_at=_utcnow(),
            )
            db.add(identity)
        else:
            identity.user_id = user.id
            identity.email = normalized_email
            identity.email_verified = True
            identity.display_name = profile.get("display_name")
            identity.avatar_url = profile.get("avatar_url")
            identity.updated_at = _utcnow()
            identity.last_login_at = _utcnow()

        db.flush()
        return user, identity

    @staticmethod
    def start_pending_oauth_link(
        db: Session,
        request: Request,
        provider: OAuthProviderDefinition,
        profile: dict[str, Any],
        token_payload: dict[str, Any],
        session: AuthSession,
    ) -> dict[str, Any]:
        subject = profile.get("subject")
        normalized_email = OAuthService.normalize_email(profile.get("email"))
        if not subject or not normalized_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{provider.display_name} account must expose an email address to continue",
            )

        EmailAuthService.enforce_rate_limit("register", normalized_email, request)
        now = _utcnow()
        pending = (
            db.query(PendingOAuthLink)
            .filter(func.lower(PendingOAuthLink.email) == normalized_email)
            .first()
        )

        if pending and pending.resend_available_at > now:
            retry_after = int((pending.resend_available_at - now).total_seconds())
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {retry_after} seconds before requesting another OTP.",
            )

        otp_code = EmailAuthService.generate_otp()
        if pending is None:
            pending = PendingOAuthLink(
                session_id=session.id,
                provider=provider.provider,
                provider_subject=subject,
                email=normalized_email,
                created_at=now,
            )
            db.add(pending)

        pending.session_id = session.id
        pending.provider = provider.provider
        pending.provider_subject = subject
        pending.email = normalized_email
        pending.display_name = profile.get("display_name")
        pending.avatar_url = profile.get("avatar_url")
        pending.access_token_encrypted = OAuthService.encrypt_token(token_payload.get("access_token")) or ""
        pending.refresh_token_encrypted = OAuthService.encrypt_token(token_payload.get("refresh_token"))
        pending.id_token_encrypted = OAuthService.encrypt_token(token_payload.get("id_token"))
        pending.expires_at = OAuthService.normalize_expires_at(token_payload)
        pending.token_type = token_payload.get("token_type", "Bearer")
        pending.scopes_json = OAuthService.normalize_scope(token_payload.get("scope"), provider)
        pending.otp_hash = EmailAuthService.hash_otp(otp_code)
        pending.otp_expires_at = now + timedelta(minutes=5)
        pending.failed_attempts = 0
        pending.resend_count = (pending.resend_count or 0) + 1
        pending.resend_available_at = now + timedelta(seconds=30)
        pending.last_sent_at = now
        pending.updated_at = now
        db.flush()

        try:
            EmailDeliveryService.send_registration_otp(
                recipient_email=normalized_email,
                otp_code=otp_code,
                expires_in_minutes=5,
            )
            db.commit()
        except Exception as exc:
            logger.exception(
                "Failed to deliver OAuth link verification OTP to %s",
                normalized_email,
            )
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to send verification code",
            ) from exc

        return EmailAuthService.build_response(
            pending,
            f"Verify your email to link {provider.display_name} to Resonator - AI Voice Generator.",
            verification_type="oauth_link",
            provider=provider.provider,
        )

    @staticmethod
    def resend_pending_oauth_link(
        db: Session,
        request: Request,
        email: str,
    ) -> dict[str, Any]:
        normalized_email = OAuthService.normalize_email(email)
        if not normalized_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email is required",
            )

        EmailAuthService.enforce_rate_limit("oauth_link_resend", normalized_email, request)
        pending = (
            db.query(PendingOAuthLink)
            .filter(func.lower(PendingOAuthLink.email) == normalized_email)
            .first()
        )
        if pending is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No pending OAuth email verification found for this email",
            )

        now = _utcnow()
        if pending.resend_available_at > now:
            retry_after = int((pending.resend_available_at - now).total_seconds())
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {retry_after} seconds before resending the OTP.",
            )

        otp_code = EmailAuthService.generate_otp()
        pending.otp_hash = EmailAuthService.hash_otp(otp_code)
        pending.otp_expires_at = now + timedelta(minutes=5)
        pending.failed_attempts = 0
        pending.resend_count = (pending.resend_count or 0) + 1
        pending.resend_available_at = now + timedelta(seconds=30)
        pending.last_sent_at = now
        pending.updated_at = now
        db.flush()

        try:
            EmailDeliveryService.send_registration_otp(
                recipient_email=normalized_email,
                otp_code=otp_code,
                expires_in_minutes=5,
            )
            db.commit()
        except Exception as exc:
            logger.exception(
                "Failed to resend OAuth link verification OTP to %s",
                normalized_email,
            )
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to send verification code",
            ) from exc

        return EmailAuthService.build_response(
            pending,
            f"Verify your email to link {OAuthService.get_provider_label(pending.provider)} to Resonator - AI Voice Generator.",
            verification_type="oauth_link",
            provider=pending.provider,
        )

    @staticmethod
    def verify_pending_oauth_link(
        db: Session,
        request: Request,
        email: str,
        otp_code: str,
    ) -> tuple[AuthSession, SessionAccount]:
        normalized_email = OAuthService.normalize_email(email)
        if not normalized_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email is required",
            )

        EmailAuthService.enforce_rate_limit("oauth_link_verify", normalized_email, request)
        pending = (
            db.query(PendingOAuthLink)
            .filter(func.lower(PendingOAuthLink.email) == normalized_email)
            .first()
        )
        if pending is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No pending OAuth email verification found for this email",
            )

        now = _utcnow()
        if pending.otp_expires_at < now:
            db.delete(pending)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="OTP expired. Request a new verification code.",
            )

        if pending.failed_attempts >= 5:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Maximum OTP attempts exceeded. Request a new verification code.",
            )

        if not EmailAuthService.verify_otp(otp_code, pending.otp_hash):
            pending.failed_attempts += 1
            pending.updated_at = now
            db.commit()
            remaining_attempts = max(0, 5 - pending.failed_attempts)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Invalid OTP. "
                    + (
                        f"{remaining_attempts} attempt(s) remaining."
                        if remaining_attempts > 0
                        else "Request a new verification code."
                    )
                ),
            )

        provider = OAuthService.get_provider(pending.provider)
        profile = {
            "subject": pending.provider_subject,
            "email": pending.email,
            "email_verified": True,
            "display_name": pending.display_name,
            "avatar_url": pending.avatar_url,
        }
        token_payload = {
            "access_token": OAuthService.decrypt_token(pending.access_token_encrypted),
            "refresh_token": OAuthService.decrypt_token(pending.refresh_token_encrypted),
            "id_token": OAuthService.decrypt_token(pending.id_token_encrypted),
            "token_type": pending.token_type,
            "scope": json.loads(pending.scopes_json) if pending.scopes_json else list(provider.scopes),
            "expires_at": int(pending.expires_at.timestamp()) if pending.expires_at else None,
        }
        user, identity = OAuthService.link_verified_identity(db, provider, profile)

        session = db.query(AuthSession).filter(AuthSession.id == pending.session_id).first()
        if session is None:
            session = OAuthService.get_or_create_session(request, db)

        account = OAuthService.upsert_session_account(
            db,
            session,
            user,
            identity,
            provider,
            profile,
            token_payload,
        )

        session.active_account_id = account.id
        session.updated_at = _utcnow()
        session.last_seen_at = _utcnow()
        db.delete(pending)
        db.commit()
        db.refresh(session)
        return session, account

    @staticmethod
    def upsert_session_account(
        db: Session,
        session: AuthSession,
        user: User,
        identity: OAuthIdentity,
        provider: OAuthProviderDefinition,
        profile: dict[str, Any],
        token_payload: dict[str, Any],
    ) -> SessionAccount:
        existing_account = (
            db.query(SessionAccount)
            .filter(
                SessionAccount.session_id == session.id,
                SessionAccount.provider == provider.provider,
                SessionAccount.provider_subject == identity.provider_subject,
            )
            .first()
        )

        if existing_account is None:
            existing_account = SessionAccount(
                session_id=session.id,
                user_id=user.id,
                identity_id=identity.id,
                provider=provider.provider,
                provider_subject=identity.provider_subject,
                created_at=_utcnow(),
            )
            db.add(existing_account)

        existing_account.user_id = user.id
        existing_account.identity_id = identity.id
        existing_account.email = profile.get("email") or user.email
        existing_account.display_name = profile.get("display_name")
        existing_account.avatar_url = profile.get("avatar_url")
        existing_account.access_token_encrypted = OAuthService.encrypt_token(token_payload.get("access_token")) or ""
        existing_account.refresh_token_encrypted = (
            OAuthService.encrypt_token(token_payload.get("refresh_token"))
            or existing_account.refresh_token_encrypted
        )
        existing_account.id_token_encrypted = OAuthService.encrypt_token(token_payload.get("id_token"))
        existing_account.expires_at = OAuthService.normalize_expires_at(token_payload)
        existing_account.token_type = token_payload.get("token_type", "Bearer")
        existing_account.scopes_json = OAuthService.normalize_scope(token_payload.get("scope"), provider)
        existing_account.is_valid = True
        existing_account.invalid_reason = None
        existing_account.updated_at = _utcnow()
        existing_account.last_used_at = _utcnow()
        db.flush()
        return existing_account

    @staticmethod
    def upsert_local_session_account(
        db: Session,
        request: Request,
        user: User,
    ) -> tuple[AuthSession, SessionAccount]:
        session = OAuthService.get_or_create_session(request, db)
        provider_subject = (user.email or str(user.id)).strip().lower()

        existing_account = (
            db.query(SessionAccount)
            .filter(
                SessionAccount.session_id == session.id,
                SessionAccount.provider == LOCAL_EMAIL_PROVIDER,
                SessionAccount.provider_subject == provider_subject,
            )
            .first()
        )

        if existing_account is None:
            existing_account = SessionAccount(
                session_id=session.id,
                user_id=user.id,
                provider=LOCAL_EMAIL_PROVIDER,
                provider_subject=provider_subject,
                created_at=_utcnow(),
            )
            db.add(existing_account)

        existing_account.user_id = user.id
        existing_account.identity_id = None
        existing_account.email = user.email
        existing_account.display_name = user.username
        existing_account.avatar_url = None
        existing_account.access_token_encrypted = (
            OAuthService.encrypt_token(secrets.token_urlsafe(48)) or ""
        )
        existing_account.refresh_token_encrypted = None
        existing_account.id_token_encrypted = None
        existing_account.expires_at = None
        existing_account.token_type = "Session"
        existing_account.scopes_json = json.dumps(["local_auth"])
        existing_account.is_valid = True
        existing_account.invalid_reason = None
        existing_account.updated_at = _utcnow()
        existing_account.last_used_at = _utcnow()
        db.flush()

        session.active_account_id = existing_account.id
        session.updated_at = _utcnow()
        session.last_seen_at = _utcnow()
        db.flush()
        return session, existing_account

    @staticmethod
    def sync_local_email_session_accounts(db: Session, user: User) -> None:
        provider_subject = (user.email or str(user.id)).strip().lower()
        local_accounts = (
            db.query(SessionAccount)
            .filter(
                SessionAccount.user_id == user.id,
                SessionAccount.provider == LOCAL_EMAIL_PROVIDER,
            )
            .all()
        )

        for account in local_accounts:
            account.email = user.email
            account.display_name = user.username
            account.provider_subject = provider_subject
            account.updated_at = _utcnow()
            account.last_used_at = _utcnow()

        db.flush()

    @staticmethod
    def _finalize_session_after_account_removal(
        db: Session,
        session: AuthSession,
        removed_account_ids: set[uuid.UUID],
    ) -> bool:
        previous_active_account_id = session.active_account_id
        was_active = (
            previous_active_account_id in removed_account_ids
            if previous_active_account_id is not None
            else False
        )

        remaining_accounts = (
            db.query(SessionAccount)
            .filter(SessionAccount.session_id == session.id)
            .order_by(SessionAccount.updated_at.desc())
            .all()
        )

        if not remaining_accounts:
            db.delete(session)
            db.flush()
            return True

        if not was_active and previous_active_account_id is not None:
            active_account_still_present = next(
                (
                    item
                    for item in remaining_accounts
                    if item.id == previous_active_account_id
                ),
                None,
            )
            session.active_account_id = (
                active_account_still_present.id
                if active_account_still_present is not None
                else None
            )
        else:
            session.active_account_id = None

        if session.active_account_id is None:
            preferred_account = next(
                (item for item in remaining_accounts if item.is_valid),
                remaining_accounts[0],
            )
            session.active_account_id = preferred_account.id

        session.updated_at = _utcnow()
        session.last_seen_at = _utcnow()
        db.flush()
        return False

    @staticmethod
    def remove_user_from_all_sessions(
        db: Session,
        user_id: str | uuid.UUID,
        current_session_id: str | uuid.UUID | None = None,
    ) -> tuple[dict[str, Any], bool]:
        user_uuid = user_id if isinstance(user_id, uuid.UUID) else uuid.UUID(str(user_id))
        current_session_uuid = (
            current_session_id
            if isinstance(current_session_id, uuid.UUID)
            else uuid.UUID(str(current_session_id))
            if current_session_id is not None
            else None
        )

        sessions = (
            db.query(AuthSession)
            .join(SessionAccount, SessionAccount.session_id == AuthSession.id)
            .filter(SessionAccount.user_id == user_uuid)
            .all()
        )

        active_current_session: AuthSession | None = None
        cleared_current_session = False

        for session in sessions:
            user_accounts = (
                db.query(SessionAccount)
                .filter(
                    SessionAccount.session_id == session.id,
                    SessionAccount.user_id == user_uuid,
                )
                .all()
            )
            if not user_accounts:
                continue

            removed_account_ids = {account.id for account in user_accounts}
            for account in user_accounts:
                db.delete(account)

            session_deleted = OAuthService._finalize_session_after_account_removal(
                db,
                session,
                removed_account_ids,
            )

            if current_session_uuid is not None and session.id == current_session_uuid:
                cleared_current_session = session_deleted
                active_current_session = None if session_deleted else session

        db.flush()

        if active_current_session is not None:
            current_session = (
                db.query(AuthSession)
                .filter(AuthSession.id == active_current_session.id)
                .first()
            )
            return OAuthService.serialize_session(current_session), False

        return OAuthService.serialize_session(None), cleared_current_session

    @staticmethod
    def serialize_linked_provider(
        provider_type: str,
        session_account: SessionAccount | None,
    ) -> dict[str, Any]:
        return {
            "type": provider_type,
            "label": OAuthService.get_provider_label(provider_type),
            "isInSession": session_account is not None,
            "isValid": session_account.is_valid if session_account is not None else True,
            "expiresAt": (
                int(session_account.expires_at.timestamp())
                if session_account is not None and session_account.expires_at
                else None
            ),
        }

    @staticmethod
    def serialize_session_user(
        user: User,
        session_accounts: list[SessionAccount],
    ) -> dict[str, Any]:
        session_accounts_by_provider = {
            account.provider: account
            for account in session_accounts
        }
        linked_provider_types = {
            identity.provider
            for identity in user.oauth_identities
        }
        if user.has_email_auth:
            linked_provider_types.add(LOCAL_EMAIL_PROVIDER)
        linked_provider_types.update(session_accounts_by_provider.keys())

        provider_order = [LOCAL_EMAIL_PROVIDER, "google", "github"]
        ordered_provider_types = sorted(
            linked_provider_types,
            key=lambda provider_name: (
                provider_order.index(provider_name)
                if provider_name in provider_order
                else len(provider_order),
                provider_name,
            ),
        )

        display_name = user.username or next(
            (account.display_name for account in session_accounts if account.display_name),
            None,
        )
        avatar_url = next(
            (account.avatar_url for account in session_accounts if account.avatar_url),
            None,
        )
        has_valid_session_provider = any(account.is_valid for account in session_accounts)
        invalid_reasons = [
            account.invalid_reason
            for account in session_accounts
            if account.invalid_reason
        ]

        return {
            "accountId": str(user.id),
            "userId": str(user.id),
            "email": user.email,
            "displayName": display_name,
            "avatarUrl": avatar_url,
            "isValid": has_valid_session_provider,
            "invalidReason": None if has_valid_session_provider else (invalid_reasons[0] if invalid_reasons else None),
            "providers": [
                OAuthService.serialize_linked_provider(
                    provider_type,
                    session_accounts_by_provider.get(provider_type),
                )
                for provider_type in ordered_provider_types
            ],
        }

    @staticmethod
    def serialize_session(session: AuthSession | None) -> dict[str, Any]:
        if session is None:
            return {
                "accounts": [],
                "activeAccountId": None,
            }

        grouped_accounts: dict[str, list[SessionAccount]] = defaultdict(list)
        for account in session.accounts:
            grouped_accounts[str(account.user_id)].append(account)

        active_user_id = None
        if session.active_account_id:
            active_account = next(
                (account for account in session.accounts if account.id == session.active_account_id),
                None,
            )
            if active_account is not None:
                active_user_id = str(active_account.user_id)

        ordered_users = sorted(
            grouped_accounts.items(),
            key=lambda item: (
                item[0] != active_user_id,
                -max(
                    (account.updated_at.timestamp() if account.updated_at else 0)
                    for account in item[1]
                ),
            ),
        )

        serialized_accounts = [
            OAuthService.serialize_session_user(accounts[0].user, accounts)
            for _user_id, accounts in ordered_users
        ]

        return {
            "accounts": serialized_accounts,
            "activeAccountId": active_user_id,
        }

    @staticmethod
    async def handle_oauth_callback(
        db: Session,
        request: Request,
        provider_name: str,
        code: str,
        state: str,
    ) -> RedirectResponse:
        provider = OAuthService.get_provider(provider_name)
        OAuthService.cleanup_expired_authorization_states(db)

        auth_state = (
            db.query(OAuthAuthorizationState)
            .filter(
                OAuthAuthorizationState.provider == provider_name,
                OAuthAuthorizationState.state == state,
            )
            .first()
        )

        if auth_state is None or auth_state.expires_at < _utcnow():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="OAuth authorization state is missing or expired",
            )

        session = auth_state.session
        token_payload = await OAuthService.exchange_code_for_tokens(
            provider,
            request,
            code,
            auth_state.code_verifier,
        )
        profile = await OAuthService.fetch_user_profile(provider, token_payload)
        existing_identity = OAuthService.get_identity_by_subject(db, provider, profile)
        if existing_identity is None and not OAuthService.is_profile_email_trusted(provider, profile):
            db.delete(auth_state)
            challenge = OAuthService.start_pending_oauth_link(
                db,
                request,
                provider,
                profile,
                token_payload,
                session,
            )

            redirect = RedirectResponse(
                url=OAuthService.build_frontend_url(
                    "/register",
                    {
                        "mode": "oauth-link",
                        "provider": provider.provider,
                        "email": challenge["email"],
                        "message": str(challenge["message"]),
                        "expiresAt": str(challenge["expiresAt"]),
                        "resendAvailableAt": str(challenge["resendAvailableAt"]),
                    },
                ),
                status_code=status.HTTP_302_FOUND,
            )
            OAuthService.set_session_cookie(redirect, session)
            return redirect

        if existing_identity is not None:
            user = existing_identity.user
            normalized_email = OAuthService.normalize_email(profile.get("email"))
            if normalized_email:
                user.email = normalized_email
                existing_identity.email = normalized_email
            user.is_active = True
            user.updated_at = _utcnow()
            user.last_login = _utcnow()
            existing_identity.email_verified = existing_identity.email_verified or bool(profile.get("email_verified"))
            existing_identity.display_name = profile.get("display_name") or existing_identity.display_name
            existing_identity.avatar_url = profile.get("avatar_url") or existing_identity.avatar_url
            existing_identity.updated_at = _utcnow()
            existing_identity.last_login_at = _utcnow()
            identity = existing_identity
        else:
            user, identity = OAuthService.link_verified_identity(db, provider, profile)

        account = OAuthService.upsert_session_account(
            db,
            session,
            user,
            identity,
            provider,
            profile,
            token_payload,
        )

        session.active_account_id = account.id
        session.updated_at = _utcnow()
        session.last_seen_at = _utcnow()
        db.delete(auth_state)
        db.commit()

        response = RedirectResponse(
            url=OAuthService.build_frontend_url("/"),
            status_code=status.HTTP_302_FOUND,
        )
        OAuthService.set_session_cookie(response, session)
        return response

    @staticmethod
    async def refresh_session_account_tokens(db: Session, account: SessionAccount) -> SessionAccount:
        provider = OAuthService.get_provider(account.provider)
        refresh_token = OAuthService.decrypt_token(account.refresh_token_encrypted)

        if not refresh_token:
            account.is_valid = False
            account.invalid_reason = "This account must be reconnected because no refresh token is available."
            account.updated_at = _utcnow()
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=account.invalid_reason,
            )

        endpoints = await OAuthService.get_provider_endpoints(provider)
        token_url = endpoints.get("token_url")
        if not token_url:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Provider '{provider.provider}' is missing a token endpoint",
            )

        payload = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": provider.client_id,
            "client_secret": provider.client_secret,
        }

        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                token_url,
                data=payload,
                headers={"Accept": "application/json"},
            )

        if response.status_code >= 400:
            logger.warning(
                "OAuth refresh failed for %s account %s: %s",
                account.provider,
                account.id,
                response.text,
            )
            account.is_valid = False
            account.invalid_reason = "This account session expired and must be reconnected."
            account.updated_at = _utcnow()
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=account.invalid_reason,
            )

        refreshed = response.json()
        account.access_token_encrypted = OAuthService.encrypt_token(refreshed.get("access_token")) or account.access_token_encrypted
        account.refresh_token_encrypted = (
            OAuthService.encrypt_token(refreshed.get("refresh_token"))
            or account.refresh_token_encrypted
        )
        account.id_token_encrypted = (
            OAuthService.encrypt_token(refreshed.get("id_token"))
            or account.id_token_encrypted
        )
        account.expires_at = OAuthService.normalize_expires_at(refreshed)
        account.token_type = refreshed.get("token_type", account.token_type)
        account.scopes_json = OAuthService.normalize_scope(refreshed.get("scope"), provider)
        account.is_valid = True
        account.invalid_reason = None
        account.updated_at = _utcnow()
        account.last_used_at = _utcnow()
        db.commit()
        db.refresh(account)
        return account

    @staticmethod
    async def get_active_session_account(request: Request, db: Session) -> SessionAccount:
        session = OAuthService.get_session_from_request(request, db)
        if session is None or session.active_account_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="No active account selected",
            )

        account = (
            db.query(SessionAccount)
            .filter(
                SessionAccount.id == session.active_account_id,
                SessionAccount.session_id == session.id,
            )
            .first()
        )

        if account is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Active account not found",
            )

        if not account.is_valid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=account.invalid_reason or "Active account must be reconnected",
            )

        if account.expires_at and account.expires_at <= _utcnow() + timedelta(seconds=OAUTH_REFRESH_SKEW_SECONDS):
            account = await OAuthService.refresh_session_account_tokens(db, account)

        request.state.auth_session = session
        request.state.active_account = account
        return account

    @staticmethod
    def switch_account(db: Session, request: Request, account_id: str) -> dict[str, Any]:
        session = OAuthService.get_session_from_request(request, db)
        if session is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="No active browser session",
            )

        try:
            account_uuid = uuid.UUID(account_id)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid account ID",
            ) from exc

        account = (
            db.query(SessionAccount)
            .filter(
                SessionAccount.user_id == account_uuid,
                SessionAccount.session_id == session.id,
            )
            .order_by(SessionAccount.updated_at.desc())
            .all()
        )
        if not account:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found in current session",
            )

        preferred_account = next(
            (item for item in account if item.is_valid),
            account[0],
        )

        session.active_account_id = preferred_account.id
        session.updated_at = _utcnow()
        db.commit()
        db.refresh(session)
        return OAuthService.serialize_session(session)

    @staticmethod
    def remove_account(db: Session, request: Request, account_id: str) -> tuple[dict[str, Any], bool]:
        session = OAuthService.get_session_from_request(request, db)
        if session is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="No active browser session",
            )

        try:
            account_uuid = uuid.UUID(account_id)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid account ID",
            ) from exc

        session_accounts = (
            db.query(SessionAccount)
            .filter(
                SessionAccount.user_id == account_uuid,
                SessionAccount.session_id == session.id,
            )
            .order_by(SessionAccount.updated_at.desc())
            .all()
        )
        if not session_accounts:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found in current session",
            )

        account_ids_to_remove = {item.id for item in session_accounts}

        for account in session_accounts:
            db.delete(account)

        cleared_session = OAuthService._finalize_session_after_account_removal(
            db,
            session,
            account_ids_to_remove,
        )
        db.commit()
        if cleared_session:
            return OAuthService.serialize_session(None), True

        db.refresh(session)
        return OAuthService.serialize_session(session), False

    @staticmethod
    def logout_all(db: Session, request: Request) -> None:
        session = OAuthService.get_session_from_request(request, db)
        if session is None:
            return

        db.delete(session)
        db.commit()
