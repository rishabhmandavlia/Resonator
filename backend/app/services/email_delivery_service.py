"""Email delivery utilities for OTP and authentication notifications."""

from __future__ import annotations

import logging
import os
import smtplib
import ssl
from email.message import EmailMessage

logger = logging.getLogger(__name__)

ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
APPLICATION_NAME = os.getenv("APPLICATION_NAME", "Resonator - AI Voice Generator")
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", "no-reply@localhost")
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", APPLICATION_NAME)
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() == "true"
SMTP_USE_SSL = os.getenv("SMTP_USE_SSL", "false").lower() == "true"
EMAIL_DELIVERY_MODE = (
    os.getenv("EMAIL_DELIVERY_MODE")
    or ("smtp" if SMTP_HOST else ("console" if ENVIRONMENT != "production" else "smtp"))
).lower()


class EmailDeliveryService:
    """Sends transactional emails for authentication flows."""

    @staticmethod
    def _build_message(
        recipient_email: str,
        subject: str,
        text_body: str,
        html_body: str | None = None,
    ) -> EmailMessage:
        message = EmailMessage()
        message["Subject"] = subject
        message["From"] = f"{SMTP_FROM_NAME} <{SMTP_FROM_EMAIL}>"
        message["To"] = recipient_email
        message.set_content(text_body)
        if html_body:
            message.add_alternative(html_body, subtype="html")
        return message

    @staticmethod
    def _send_via_smtp(message: EmailMessage) -> None:
        if not SMTP_HOST:
            raise RuntimeError("SMTP_HOST is not configured")

        if SMTP_USE_SSL:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=context, timeout=20) as server:
                if SMTP_USERNAME:
                    server.login(SMTP_USERNAME, SMTP_PASSWORD)
                server.send_message(message)
            return

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
            if SMTP_USE_TLS:
                context = ssl.create_default_context()
                server.starttls(context=context)
            if SMTP_USERNAME:
                server.login(SMTP_USERNAME, SMTP_PASSWORD)
            server.send_message(message)

    @staticmethod
    def send_registration_otp(
        recipient_email: str,
        otp_code: str,
        expires_in_minutes: int,
    ) -> None:
        subject = f"Verify your email for {APPLICATION_NAME}"
        text_body = (
            f"Hello,\n\n"
            f"We received a request to verify your email for {APPLICATION_NAME}.\n\n"
            f"Use this one-time verification code to finish creating your account:\n\n"
            f"{otp_code}\n\n"
            f"This code expires in {expires_in_minutes} minutes.\n\n"
            "If you did not request this code, you can safely ignore this email.\n\n"
            f"Thanks,\n{APPLICATION_NAME}"
        )
        html_body = (
            "<html>"
            "<body style=\"margin:0;padding:24px;background:#f8fafc;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;\">"
            "<div style=\"max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden;box-shadow:0 20px 45px rgba(15,23,42,0.08);\">"
            "<div style=\"padding:28px 32px;background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);color:#ffffff;\">"
            f"<div style=\"font-size:13px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.72;\">{APPLICATION_NAME}</div>"
            "<h1 style=\"margin:14px 0 0;font-size:28px;line-height:1.2;\">Email verification code</h1>"
            "</div>"
            "<div style=\"padding:32px;\">"
            f"<p style=\"margin:0 0 16px;font-size:16px;line-height:1.7;color:#334155;\">We received a request to verify your email for <strong>{APPLICATION_NAME}</strong>.</p>"
            "<p style=\"margin:0 0 16px;font-size:16px;line-height:1.7;color:#334155;\">Use this one-time code to finish creating your account:</p>"
            f"<div style=\"margin:24px 0;padding:20px;border-radius:16px;background:#eff6ff;border:1px solid #bfdbfe;text-align:center;\"><div style=\"font-size:34px;font-weight:700;letter-spacing:0.35em;color:#0f172a;text-indent:0.35em;\">{otp_code}</div></div>"
            f"<p style=\"margin:0 0 10px;font-size:14px;line-height:1.7;color:#475569;\">This code expires in <strong>{expires_in_minutes} minutes</strong>.</p>"
            "<p style=\"margin:0;font-size:14px;line-height:1.7;color:#64748b;\">If you did not request this code, you can safely ignore this email.</p>"
            "</div>"
            "</div>"
            "</body>"
            "</html>"
        )
        message = EmailDeliveryService._build_message(
            recipient_email,
            subject,
            text_body,
            html_body,
        )

        if EMAIL_DELIVERY_MODE == "console":
            logger.info(
                "EMAIL_DELIVERY_MODE=console, OTP for %s is %s (valid for %s minutes)",
                recipient_email,
                otp_code,
                expires_in_minutes,
            )
            return

        EmailDeliveryService._send_via_smtp(message)
