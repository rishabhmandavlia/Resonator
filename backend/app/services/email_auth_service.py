"""Email/password registration and OTP verification services."""

from __future__ import annotations

import logging
import hashlib
import os
import re
import secrets
import time
from datetime import datetime, timedelta
from urllib.parse import urlencode

import bcrypt
from fastapi import HTTPException, Request, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.services.email_delivery_service import EmailDeliveryService
from database.models import PasswordResetToken, PendingEmailChange, PendingEmailVerification, User

logger = logging.getLogger(__name__)

GITHUB_LOGIN_REMOVED_MESSAGE = (
    "GitHub login is no longer supported. Please use Google or reset your password."
)

OTP_LENGTH = 6
OTP_EXPIRY_MINUTES = 5
OTP_MAX_ATTEMPTS = 5
OTP_RESEND_COOLDOWN_SECONDS = 30
PASSWORD_MIN_LENGTH = 12
COMMON_PASSWORDS = {
    "password",
    "password123",
    "12345678",
    "qwerty",
    "111111",
}

REGISTER_RATE_LIMIT = (5, 15 * 60)
VERIFY_RATE_LIMIT = (10, 15 * 60)
RESEND_RATE_LIMIT = (5, 15 * 60)
OAUTH_LINK_VERIFY_RATE_LIMIT = (10, 15 * 60)
OAUTH_LINK_RESEND_RATE_LIMIT = (5, 15 * 60)
EMAIL_CHANGE_REQUEST_RATE_LIMIT = (5, 15 * 60)
EMAIL_CHANGE_VERIFY_RATE_LIMIT = (10, 15 * 60)
EMAIL_CHANGE_RESEND_RATE_LIMIT = (5, 15 * 60)
PASSWORD_RESET_REQUEST_RATE_LIMIT = (5, 15 * 60)
PASSWORD_RESET_SUBMIT_RATE_LIMIT = (10, 15 * 60)
PASSWORD_RESET_TOKEN_TTL_MINUTES = int(
    os.getenv("PASSWORD_RESET_TOKEN_TTL_MINUTES", "20")
)
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")

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
    def verify_password(plain_password: str, password_hash: str | None) -> bool:
        if not password_hash:
            return False
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
            "email_change_request": EMAIL_CHANGE_REQUEST_RATE_LIMIT,
            "email_change_verify": EMAIL_CHANGE_VERIFY_RATE_LIMIT,
            "email_change_resend": EMAIL_CHANGE_RESEND_RATE_LIMIT,
            "password_reset_request": PASSWORD_RESET_REQUEST_RATE_LIMIT,
            "password_reset_submit": PASSWORD_RESET_SUBMIT_RATE_LIMIT,
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
    def get_password_validation_errors(
        password: str,
        email: str | None = None,
    ) -> list[str]:
        errors: list[str] = []

        if len(password) < PASSWORD_MIN_LENGTH:
            errors.append(
                f"Password must be at least {PASSWORD_MIN_LENGTH} characters"
            )
        if not re.search(r"[A-Z]", password):
            errors.append("Password must contain at least one uppercase letter")
        if not re.search(r"[a-z]", password):
            errors.append("Password must contain at least one lowercase letter")
        if not re.search(r"[0-9]", password):
            errors.append("Password must contain at least one number")
        if not re.search(r"[!@#$%^&*()\[\]{}\-_=+|:;\"'<>,./?]", password):
            errors.append("Password must contain at least one special character")
        if re.search(r"\s", password):
            errors.append("Password cannot contain spaces")

        normalized_password = password.lower()
        if normalized_password in COMMON_PASSWORDS:
            errors.append("Password is too common")

        if email:
            email_prefix = email.split("@", 1)[0].strip().lower()
            if len(email_prefix) >= 3 and email_prefix in normalized_password:
                errors.append("Password cannot contain your email prefix")

        return errors

    @staticmethod
    def validate_password(password: str, email: str | None = None) -> None:
        errors = EmailAuthService.get_password_validation_errors(password, email)
        if errors:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=errors[0],
            )

    @staticmethod
    def enable_password_auth(user: User, password: str) -> None:
        if user.has_email_auth:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email/password sign-in is already enabled for this account",
            )

        EmailAuthService.validate_password(password, user.email)
        user.password_hash = EmailAuthService.hash_password(password)
        user.has_email_auth = True
        user.is_verified = True
        user.is_email_verified = True
        user.updated_at = _utcnow()

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
    def upsert_pending_email_change(
        db: Session,
        user: User,
        new_email: str,
        otp_code: str,
    ) -> PendingEmailChange:
        now = _utcnow()
        pending = (
            db.query(PendingEmailChange)
            .filter(PendingEmailChange.user_id == user.id)
            .first()
        )

        if pending is None:
            pending = PendingEmailChange(
                user_id=user.id,
                created_at=now,
            )
            db.add(pending)

        pending.new_email = new_email
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
    def build_email_change_response(
        record: PendingEmailChange,
        message: str,
    ) -> dict[str, str | int | None]:
        resend_available_in = max(
            0,
            int((record.resend_available_at - _utcnow()).total_seconds()),
        )
        return {
            "email": record.new_email,
            "message": message,
            "expiresAt": record.otp_expires_at.isoformat(),
            "resendAvailableAt": record.resend_available_at.isoformat(),
            "resendCooldownSeconds": OTP_RESEND_COOLDOWN_SECONDS,
            "resendAvailableInSeconds": resend_available_in,
            "verificationType": "email_change",
            "provider": None,
        }

    @staticmethod
    def build_password_reset_token_hash(reset_token: str) -> str:
        return hashlib.sha256(reset_token.encode("utf-8")).hexdigest()

    @staticmethod
    def build_password_reset_url(reset_token: str) -> str:
        return f"{FRONTEND_URL}/reset-password?{urlencode({'token': reset_token})}"

    @staticmethod
    def mask_email(email: str) -> str:
        local_part, _, domain = email.partition("@")
        if not domain:
            return email

        if len(local_part) <= 2:
            masked_local_part = f"{local_part[:1]}*"
        else:
            masked_local_part = f"{local_part[:1]}{'*' * (len(local_part) - 2)}{local_part[-1]}"

        domain_name, dot, suffix = domain.partition(".")
        if len(domain_name) <= 2:
            masked_domain_name = f"{domain_name[:1]}*"
        else:
            masked_domain_name = f"{domain_name[:1]}{'*' * (len(domain_name) - 2)}{domain_name[-1]}"

        masked_domain = (
            f"{masked_domain_name}{dot}{suffix}"
            if dot
            else masked_domain_name
        )
        return f"{masked_local_part}@{masked_domain}"

    @staticmethod
    def is_password_reset_eligible_user(user: User | None) -> bool:
        if user is None:
            return False
        if not user.is_active or not user.is_email_verified:
            return False
        if not user.email:
            return False
        return not user.email.endswith("@oauth.local")

    @staticmethod
    def invalidate_password_reset_tokens(
        db: Session,
        user: User,
        *,
        exclude_token_id: str | None = None,
    ) -> None:
        now = _utcnow()
        query = db.query(PasswordResetToken).filter(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.invalidated_at.is_(None),
        )

        if exclude_token_id is not None:
            query = query.filter(PasswordResetToken.id != exclude_token_id)

        for token in query.all():
            token.invalidated_at = now
            token.updated_at = now

        db.flush()

    @staticmethod
    def start_password_reset(
        db: Session,
        request: Request,
        email: str,
    ) -> dict[str, str]:
        normalized_email = EmailAuthService.normalize_email(email)
        EmailAuthService.enforce_rate_limit(
            "password_reset_request",
            normalized_email,
            request,
        )

        generic_response = {
            "message": (
                "If an account exists for that email, a password reset link will arrive shortly."
            )
        }

        user = (
            db.query(User)
            .filter(func.lower(User.email) == normalized_email)
            .first()
        )
        if not EmailAuthService.is_password_reset_eligible_user(user):
            return generic_response

        now = _utcnow()
        EmailAuthService.invalidate_password_reset_tokens(db, user)

        raw_reset_token = secrets.token_urlsafe(48)
        reset_token = PasswordResetToken(
            user_id=user.id,
            email=normalized_email,
            token_hash=EmailAuthService.build_password_reset_token_hash(raw_reset_token),
            expires_at=now + timedelta(minutes=PASSWORD_RESET_TOKEN_TTL_MINUTES),
            requested_ip=request.client.host if request.client else None,
            requested_user_agent=request.headers.get("user-agent"),
            created_at=now,
            updated_at=now,
        )
        db.add(reset_token)
        db.flush()

        try:
            EmailDeliveryService.send_password_reset_email(
                recipient_email=normalized_email,
                reset_url=EmailAuthService.build_password_reset_url(raw_reset_token),
                expires_in_minutes=PASSWORD_RESET_TOKEN_TTL_MINUTES,
            )
            db.commit()
        except HTTPException:
            db.rollback()
            raise
        except Exception as exc:
            logger.exception(
                "Failed to deliver password reset email to %s",
                normalized_email,
            )
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to send password reset email",
            ) from exc

        return generic_response

    @staticmethod
    def get_password_reset_token_record(
        db: Session,
        reset_token: str,
    ) -> PasswordResetToken | None:
        if not reset_token:
            return None

        return (
            db.query(PasswordResetToken)
            .filter(
                PasswordResetToken.token_hash
                == EmailAuthService.build_password_reset_token_hash(reset_token)
            )
            .first()
        )

    @staticmethod
    def validate_password_reset_token(
        db: Session,
        reset_token: str,
    ) -> PasswordResetToken:
        token_record = EmailAuthService.get_password_reset_token_record(db, reset_token)
        if token_record is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Password reset link is invalid.",
            )

        now = _utcnow()
        if token_record.used_at is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This password reset link has already been used.",
            )

        if token_record.invalidated_at is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This password reset link is no longer valid. Request a new one.",
            )

        if token_record.expires_at < now:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This password reset link has expired. Request a new one.",
            )

        user = token_record.user
        if not EmailAuthService.is_password_reset_eligible_user(user):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This password reset link is no longer valid. Request a new one.",
            )

        if EmailAuthService.normalize_email(user.email) != token_record.email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This password reset link is no longer valid. Request a new one.",
            )

        return token_record

    @staticmethod
    def validate_password_reset_request(
        db: Session,
        reset_token: str,
    ) -> dict[str, str]:
        token_record = EmailAuthService.validate_password_reset_token(db, reset_token)
        return {
            "emailHint": EmailAuthService.mask_email(token_record.email),
            "expiresAt": token_record.expires_at.isoformat(),
        }

    @staticmethod
    def reset_password(
        db: Session,
        request: Request,
        reset_token: str,
        new_password: str,
        confirm_password: str,
    ) -> User:
        rate_limit_key = EmailAuthService.build_password_reset_token_hash(reset_token)[:24]
        EmailAuthService.enforce_rate_limit(
            "password_reset_submit",
            rate_limit_key,
            request,
        )

        token_record = EmailAuthService.validate_password_reset_token(db, reset_token)
        if new_password != confirm_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New password confirmation does not match",
            )

        user = token_record.user
        EmailAuthService.validate_password(new_password, user.email)
        if user.password_hash and EmailAuthService.verify_password(new_password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New password must be different from the current password",
            )

        now = _utcnow()
        user.password_hash = EmailAuthService.hash_password(new_password)
        user.has_email_auth = True
        user.is_verified = True
        user.is_email_verified = True
        user.updated_at = now
        user.last_login = now

        token_record.used_at = now
        token_record.updated_at = now
        EmailAuthService.invalidate_password_reset_tokens(
            db,
            user,
            exclude_token_id=token_record.id,
        )
        db.flush()
        return user

    @staticmethod
    def validate_email_change_target(
        db: Session,
        user: User,
        new_email: str,
    ) -> str:
        normalized_email = EmailAuthService.normalize_email(new_email)
        if not normalized_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New email is required",
            )

        if normalized_email == EmailAuthService.normalize_email(user.email):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New email must be different from your current email",
            )

        existing_user = (
            db.query(User)
            .filter(func.lower(User.email) == normalized_email)
            .first()
        )
        if existing_user and existing_user.id != user.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered",
            )

        return normalized_email

    @staticmethod
    def start_registration(db: Session, request: Request, email: str, password: str) -> dict[str, str | int]:
        normalized_email = EmailAuthService.normalize_email(email)
        EmailAuthService.enforce_rate_limit("register", normalized_email, request)
        EmailAuthService.validate_password(password, email)

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
    def start_email_change(
        db: Session,
        request: Request,
        user: User,
        new_email: str,
    ) -> dict[str, str | int | None]:
        normalized_email = EmailAuthService.validate_email_change_target(
            db,
            user,
            new_email,
        )

        EmailAuthService.enforce_rate_limit("email_change_request", normalized_email, request)

        pending = (
            db.query(PendingEmailChange)
            .filter(PendingEmailChange.user_id == user.id)
            .first()
        )
        now = _utcnow()
        if (
            pending is not None
            and pending.new_email == normalized_email
            and pending.resend_available_at > now
        ):
            retry_after = int((pending.resend_available_at - now).total_seconds())
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {retry_after} seconds before requesting another OTP.",
            )

        otp_code = EmailAuthService.generate_otp()
        pending = EmailAuthService.upsert_pending_email_change(
            db,
            user,
            normalized_email,
            otp_code,
        )
        try:
            EmailDeliveryService.send_email_change_otp(
                recipient_email=normalized_email,
                otp_code=otp_code,
                expires_in_minutes=OTP_EXPIRY_MINUTES,
            )
            db.commit()
        except HTTPException:
            db.rollback()
            raise
        except Exception as exc:
            logger.exception("Failed to deliver email change OTP to %s", normalized_email)
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to send verification code",
            ) from exc

        return EmailAuthService.build_email_change_response(
            pending,
            "Verification code sent. Enter the OTP to confirm your new email.",
        )

    @staticmethod
    def resend_email_change(
        db: Session,
        request: Request,
        user: User,
    ) -> dict[str, str | int | None]:
        pending = (
            db.query(PendingEmailChange)
            .filter(PendingEmailChange.user_id == user.id)
            .first()
        )
        if pending is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No pending email change found for this account",
            )

        normalized_email = EmailAuthService.normalize_email(pending.new_email)
        EmailAuthService.enforce_rate_limit("email_change_resend", normalized_email, request)

        now = _utcnow()
        if pending.resend_available_at > now:
            retry_after = int((pending.resend_available_at - now).total_seconds())
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {retry_after} seconds before resending the OTP.",
            )

        otp_code = EmailAuthService.generate_otp()
        pending = EmailAuthService.upsert_pending_email_change(
            db,
            user,
            normalized_email,
            otp_code,
        )
        try:
            EmailDeliveryService.send_email_change_otp(
                recipient_email=normalized_email,
                otp_code=otp_code,
                expires_in_minutes=OTP_EXPIRY_MINUTES,
            )
            db.commit()
        except HTTPException:
            db.rollback()
            raise
        except Exception as exc:
            logger.exception("Failed to resend email change OTP to %s", normalized_email)
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to send verification code",
            ) from exc

        return EmailAuthService.build_email_change_response(
            pending,
            "A new verification code has been sent to your new email address.",
        )

    @staticmethod
    def verify_email_change(
        db: Session,
        request: Request,
        user: User,
        otp_code: str,
    ) -> User:
        pending = (
            db.query(PendingEmailChange)
            .filter(PendingEmailChange.user_id == user.id)
            .first()
        )
        if pending is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No pending email change found for this account",
            )

        normalized_email = EmailAuthService.normalize_email(pending.new_email)
        EmailAuthService.enforce_rate_limit("email_change_verify", normalized_email, request)

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
        if existing_user and existing_user.id != user.id:
            db.delete(pending)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered",
            )

        user.email = normalized_email
        user.is_email_verified = True
        user.updated_at = now
        db.flush()
        db.delete(pending)
        return user

    @staticmethod
    def authenticate_user(db: Session, email: str, password: str) -> User:
        normalized_email = EmailAuthService.normalize_email(email)
        user = (
            db.query(User)
            .filter(func.lower(User.email) == normalized_email)
            .first()
        )
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password",
            )

        if not user.has_email_auth or not user.password_hash:
            linked_provider_names = {
                identity.provider
                for identity in user.oauth_identities
            }
            if linked_provider_names and linked_provider_names <= {"github"}:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=GITHUB_LOGIN_REMOVED_MESSAGE,
                )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Password sign-in is not enabled for this account yet. "
                    "Sign in with a connected provider and set a password in Settings to enable email login."
                ),
            )

        if not EmailAuthService.verify_password(password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password",
            )

        if not user.is_email_verified:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Please verify your email before signing in",
            )

        user.last_login = _utcnow()
        db.flush()
        return user
