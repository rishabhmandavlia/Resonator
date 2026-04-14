"""OAuth and multi-account browser session services."""

from __future__ import annotations

import base64
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

from database.models import (
    AuthSession,
    OAuthAuthorizationState,
    OAuthIdentity,
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
                if not email and provider.email_url:
                    email_response = await client.get(provider.email_url, headers=headers)
                    email_response.raise_for_status()
                    emails = email_response.json()
                    primary_email = next(
                        (
                            item.get("email")
                            for item in emails
                            if item.get("primary") and item.get("verified")
                        ),
                        None,
                    )
                    email = primary_email or next(
                        (item.get("email") for item in emails if item.get("verified")),
                        None,
                    )

            return {
                "subject": str(user_data.get("id") or user_data.get("node_id")),
                "email": email,
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
            "display_name": profile.get("name") or profile.get("preferred_username"),
            "avatar_url": profile.get("picture"),
        }

    @staticmethod
    def build_password_placeholder() -> str:
        salt = bcrypt.gensalt()
        return bcrypt.hashpw(uuid.uuid4().hex.encode("utf-8"), salt).decode("utf-8")

    @staticmethod
    def find_or_create_user(
        db: Session,
        provider: OAuthProviderDefinition,
        profile: dict[str, Any],
    ) -> tuple[User, OAuthIdentity]:
        subject = profile.get("subject")
        if not subject:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{provider.display_name} did not return a stable user identifier",
            )

        identity = (
            db.query(OAuthIdentity)
            .filter(
                OAuthIdentity.provider == provider.provider,
                OAuthIdentity.provider_subject == subject,
            )
            .first()
        )

        user = identity.user if identity else None
        email = (profile.get("email") or "").strip() or None

        if user is None and email:
            user = (
                db.query(User)
                .filter(func.lower(User.email) == email.lower())
                .first()
            )

        if user is None:
            fallback_email = email or f"{provider.provider}-{subject}@oauth.local"
            display_name = profile.get("display_name") or fallback_email.split("@")[0]
            user = User(
                email=fallback_email,
                username=(display_name or fallback_email.split("@")[0])[:255],
                password_hash=OAuthService.build_password_placeholder(),
                is_active=True,
                is_admin=False,
                is_verified=bool(email),
                created_at=_utcnow(),
            )
            db.add(user)
            db.flush()

        if identity is None:
            identity = OAuthIdentity(
                user_id=user.id,
                provider=provider.provider,
                provider_subject=subject,
                email=email,
                display_name=profile.get("display_name"),
                avatar_url=profile.get("avatar_url"),
                created_at=_utcnow(),
                updated_at=_utcnow(),
                last_login_at=_utcnow(),
            )
            db.add(identity)
        else:
            identity.user_id = user.id
            identity.email = email
            identity.display_name = profile.get("display_name")
            identity.avatar_url = profile.get("avatar_url")
            identity.updated_at = _utcnow()
            identity.last_login_at = _utcnow()

        db.flush()
        return user, identity

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
    def serialize_account(account: SessionAccount) -> dict[str, Any]:
        return {
            "accountId": str(account.id),
            "userId": str(account.user_id),
            "provider": account.provider,
            "providerLabel": PROVIDER_DEFINITIONS.get(account.provider, OAuthProviderDefinition(
                provider=account.provider,
                display_name=account.provider.title(),
                client_id_env="",
                client_secret_env="",
                scopes=(),
            )).display_name,
            "email": account.email,
            "displayName": account.display_name,
            "avatarUrl": account.avatar_url,
            "expiresAt": int(account.expires_at.timestamp()) if account.expires_at else None,
            "isValid": account.is_valid,
            "invalidReason": account.invalid_reason,
        }

    @staticmethod
    def serialize_session(session: AuthSession | None) -> dict[str, Any]:
        if session is None:
            return {
                "accounts": [],
                "activeAccountId": None,
            }

        ordered_accounts = sorted(
            session.accounts,
            key=lambda account: (
                account.id != session.active_account_id,
                -(account.updated_at.timestamp() if account.updated_at else 0),
            ),
        )
        return {
            "accounts": [OAuthService.serialize_account(account) for account in ordered_accounts],
            "activeAccountId": str(session.active_account_id) if session.active_account_id else None,
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
        user, identity = OAuthService.find_or_create_user(db, provider, profile)
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
                SessionAccount.id == account_uuid,
                SessionAccount.session_id == session.id,
            )
            .first()
        )
        if account is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Account not found in current session",
            )

        session.active_account_id = account.id
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

        account = (
            db.query(SessionAccount)
            .filter(
                SessionAccount.id == account_uuid,
                SessionAccount.session_id == session.id,
            )
            .first()
        )
        if account is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Account not found in current session",
            )

        was_active = session.active_account_id == account.id
        db.delete(account)
        db.flush()

        remaining_accounts = (
            db.query(SessionAccount)
            .filter(SessionAccount.session_id == session.id)
            .order_by(SessionAccount.updated_at.desc())
            .all()
        )
        if not remaining_accounts:
            db.delete(session)
            db.commit()
            return OAuthService.serialize_session(None), True

        if was_active:
            preferred_account = next(
                (item for item in remaining_accounts if item.is_valid),
                remaining_accounts[0],
            )
            session.active_account_id = preferred_account.id

        session.updated_at = _utcnow()
        db.commit()
        db.refresh(session)
        return OAuthService.serialize_session(session), False

    @staticmethod
    def logout_all(db: Session, request: Request) -> None:
        session = OAuthService.get_session_from_request(request, db)
        if session is None:
            return

        db.delete(session)
        db.commit()
