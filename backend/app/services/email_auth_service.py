"""Email/password registration and OTP verification services."""

from __future__ import annotations

import logging
import secrets
import time
from datetime import datetime, timedelta

import bcrypt
from fastapi import HTTPException, Request, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.services.email_delivery_service import EmailDeliveryService
from database.models import PendingEmailVerification, User

logger = logging.getLogger(__name__)

OTP_LENGTH = 6
OTP_EXPIRY_MINUTES = 5
OTP_MAX_ATTEMPTS = 5
OTP_RESEND_COOLDOWN_SECONDS = 30
PASSWORD_MIN_LENGTH = 8

REGISTER_RATE_LIMIT = (5, 15 * 60)
VERIFY_RATE_LIMIT = (10, 15 * 60)
RESEND_RATE_LIMIT = (5, 15 * 60)
OAUTH_LINK_VERIFY_RATE_LIMIT = (10, 15 * 60)
OAUTH_LINK_RESEND_RATE_LIMIT = (5, 15 * 60)

_RATE_LIMIT_STORE: dict[str, list[float]] = {}


def _utcnow() -> datetime:
    return datetime.utcnow()


class EmailAuthService:
    """Coordinates OTP registration, verification, and local email/password login."""

    @staticmethod
    def normalize_email(email: str) -> str:
        return email.strip().lower()

    @staticmethod
    def hash_password(password: str) -> str:
        salt = bcrypt.gensalt()
        return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

    @staticmethod
    def verify_password(plain_password: str, password_hash: str) -> bool:
        return bcrypt.checkpw(plain_password.encode("utf-8"), password_hash.encode("utf-8"))

    @staticmethod
    def hash_otp(otp_code: str) -> str:
        salt = bcrypt.gensalt()
        return bcrypt.hashpw(otp_code.encode("utf-8"), salt).decode("utf-8")

    @staticmethod
    def verify_otp(otp_code: str, otp_hash: str) -> bool:
        return bcrypt.checkpw(otp_code.encode("utf-8"), otp_hash.encode("utf-8"))

    @staticmethod
    def generate_otp() -> str:
        return f"{secrets.randbelow(10**OTP_LENGTH):0{OTP_LENGTH}d}"

    @staticmethod
    def build_response(
        record: PendingEmailVerification,
        message: str,
        verification_type: str = "email_registration",
        provider: str | None = None,
    ) -> dict[str, str | int | None]:
        resend_available_in = max(
            0,
            int((record.resend_available_at - _utcnow()).total_seconds()),
        )
        return {
            "email": record.email,
            "message": message,
            "expiresAt": record.otp_expires_at.isoformat(),
            "resendAvailableAt": record.resend_available_at.isoformat(),
            "resendCooldownSeconds": OTP_RESEND_COOLDOWN_SECONDS,
            "resendAvailableInSeconds": resend_available_in,
            "verificationType": verification_type,
            "provider": provider,
        }

    @staticmethod
    def _build_rate_limit_key(action: str, email: str, request: Request) -> str:
        client_ip = request.client.host if request.client else "unknown"
        return f"{action}:{client_ip}:{email}"

    @staticmethod
    def enforce_rate_limit(action: str, email: str, request: Request) -> None:
        limits = {
            "register": REGISTER_RATE_LIMIT,
            "verify": VERIFY_RATE_LIMIT,
            "resend": RESEND_RATE_LIMIT,
            "oauth_link_verify": OAUTH_LINK_VERIFY_RATE_LIMIT,
            "oauth_link_resend": OAUTH_LINK_RESEND_RATE_LIMIT,
        }
        max_attempts, window_seconds = limits[action]
        key = EmailAuthService._build_rate_limit_key(action, email, request)
        now = time.time()
        recent_attempts = [stamp for stamp in _RATE_LIMIT_STORE.get(key, []) if now - stamp < window_seconds]
        if len(recent_attempts) >= max_attempts:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many attempts. Please wait before trying again.",
            )
        recent_attempts.append(now)
        _RATE_LIMIT_STORE[key] = recent_attempts

    @staticmethod
    def validate_password(password: str) -> None:
        if len(password) < PASSWORD_MIN_LENGTH:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Password must be at least {PASSWORD_MIN_LENGTH} characters",
            )

    @staticmethod
    def upsert_pending_registration(
        db: Session,
        email: str,
        password_hash: str,
        otp_code: str,
    ) -> PendingEmailVerification:
        now = _utcnow()
        pending = (
            db.query(PendingEmailVerification)
            .filter(func.lower(PendingEmailVerification.email) == email)
            .first()
        )

        if pending is None:
            pending = PendingEmailVerification(
                email=email,
                created_at=now,
            )
            db.add(pending)

        pending.password_hash = password_hash
        pending.otp_hash = EmailAuthService.hash_otp(otp_code)
        pending.otp_expires_at = now + timedelta(minutes=OTP_EXPIRY_MINUTES)
        pending.failed_attempts = 0
        pending.resend_count = (pending.resend_count or 0) + 1
        pending.resend_available_at = now + timedelta(seconds=OTP_RESEND_COOLDOWN_SECONDS)
        pending.last_sent_at = now
        pending.updated_at = now
        db.flush()
        return pending

    @staticmethod
    def start_registration(db: Session, request: Request, email: str, password: str) -> dict[str, str | int]:
        normalized_email = EmailAuthService.normalize_email(email)
        EmailAuthService.enforce_rate_limit("register", normalized_email, request)
        EmailAuthService.validate_password(password)

        existing_user = (
            db.query(User)
            .filter(func.lower(User.email) == normalized_email)
            .first()
        )
        if existing_user and existing_user.has_email_auth and existing_user.is_email_verified:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="An account with this email already exists",
            )

        pending = (
            db.query(PendingEmailVerification)
            .filter(func.lower(PendingEmailVerification.email) == normalized_email)
            .first()
        )
        now = _utcnow()
        if pending and pending.resend_available_at > now:
            retry_after = int((pending.resend_available_at - now).total_seconds())
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {retry_after} seconds before requesting another OTP.",
            )

        otp_code = EmailAuthService.generate_otp()
        pending = EmailAuthService.upsert_pending_registration(
            db,
            normalized_email,
            EmailAuthService.hash_password(password),
            otp_code,
        )
        try:
            EmailDeliveryService.send_registration_otp(
                recipient_email=normalized_email,
                otp_code=otp_code,
                expires_in_minutes=OTP_EXPIRY_MINUTES,
            )
            db.commit()
        except HTTPException:
            db.rollback()
            raise
        except Exception as exc:
            logger.exception("Failed to deliver registration OTP to %s", normalized_email)
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to send verification code",
            ) from exc
        return EmailAuthService.build_response(
            pending,
            "Verification code sent. Enter the OTP to complete registration.",
            verification_type="email_registration",
        )

    @staticmethod
    def resend_otp(db: Session, request: Request, email: str) -> dict[str, str | int]:
        normalized_email = EmailAuthService.normalize_email(email)
        EmailAuthService.enforce_rate_limit("resend", normalized_email, request)

        pending = (
            db.query(PendingEmailVerification)
            .filter(func.lower(PendingEmailVerification.email) == normalized_email)
            .first()
        )
        if pending is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No pending registration found for this email",
            )

        now = _utcnow()
        if pending.resend_available_at > now:
            retry_after = int((pending.resend_available_at - now).total_seconds())
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {retry_after} seconds before resending the OTP.",
            )

        otp_code = EmailAuthService.generate_otp()
        pending = EmailAuthService.upsert_pending_registration(
            db,
            normalized_email,
            pending.password_hash,
            otp_code,
        )
        try:
            EmailDeliveryService.send_registration_otp(
                recipient_email=normalized_email,
                otp_code=otp_code,
                expires_in_minutes=OTP_EXPIRY_MINUTES,
            )
            db.commit()
        except HTTPException:
            db.rollback()
            raise
        except Exception as exc:
            logger.exception("Failed to resend registration OTP to %s", normalized_email)
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to send verification code",
            ) from exc
        return EmailAuthService.build_response(
            pending,
            "A new verification code has been sent.",
            verification_type="email_registration",
        )

    @staticmethod
    def verify_registration_otp(db: Session, request: Request, email: str, otp_code: str) -> User:
        normalized_email = EmailAuthService.normalize_email(email)
        EmailAuthService.enforce_rate_limit("verify", normalized_email, request)

        pending = (
            db.query(PendingEmailVerification)
            .filter(func.lower(PendingEmailVerification.email) == normalized_email)
            .first()
        )
        if pending is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No pending registration found for this email",
            )

        now = _utcnow()
        if pending.otp_expires_at < now:
            db.delete(pending)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="OTP expired. Request a new verification code.",
            )

        if pending.failed_attempts >= OTP_MAX_ATTEMPTS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Maximum OTP attempts exceeded. Request a new verification code.",
            )

        if not EmailAuthService.verify_otp(otp_code, pending.otp_hash):
            pending.failed_attempts += 1
            pending.updated_at = now
            db.commit()
            remaining_attempts = max(0, OTP_MAX_ATTEMPTS - pending.failed_attempts)
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

        existing_user = (
            db.query(User)
            .filter(func.lower(User.email) == normalized_email)
            .first()
        )
        if existing_user and existing_user.has_email_auth:
            db.delete(pending)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="An account with this email already exists",
            )

        username = normalized_email.split("@")[0]
        if existing_user is None:
            existing_user = User(
                email=normalized_email,
                username=username,
                password_hash=pending.password_hash,
                is_active=True,
                is_admin=False,
                is_verified=True,
                is_email_verified=True,
                has_email_auth=True,
                created_at=now,
                updated_at=now,
                last_login=now,
            )
            db.add(existing_user)
        else:
            existing_user.username = existing_user.username or username
            existing_user.password_hash = pending.password_hash
            existing_user.is_active = True
            existing_user.is_verified = True
            existing_user.is_email_verified = True
            existing_user.has_email_auth = True
            existing_user.updated_at = now
            existing_user.last_login = now

        db.flush()
        db.delete(pending)
        return existing_user

    @staticmethod
    def authenticate_user(db: Session, email: str, password: str) -> User:
        normalized_email = EmailAuthService.normalize_email(email)
        user = (
            db.query(User)
            .filter(func.lower(User.email) == normalized_email)
            .first()
        )
        if user is None or not EmailAuthService.verify_password(password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password",
            )

        if not user.has_email_auth:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This email is linked to social sign-in only. Complete email verification to add password sign-in.",
            )

        if not user.is_email_verified:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Please verify your email before signing in",
            )

        user.last_login = _utcnow()
        db.flush()
        return user
