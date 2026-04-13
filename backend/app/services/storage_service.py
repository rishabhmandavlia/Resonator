"""
Supabase storage helper for generated audio files.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)


class SupabaseStorageService:
    """Minimal Supabase Storage client using REST requests."""

    @staticmethod
    def _config() -> tuple[str, str, str]:
        supabase_url = os.getenv("SUPABASE_URL")
        service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
        bucket_name = os.getenv("SUPABASE_STORAGE_BUCKET", "audio-generations")

        if not supabase_url:
            raise RuntimeError("SUPABASE_URL is not configured")

        if not service_role_key:
            raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is not configured")

        return supabase_url.rstrip("/"), service_role_key, bucket_name

    @staticmethod
    def build_object_path(file_stem: str, project_id: Optional[str] = None, voice_id: Optional[str] = None) -> str:
        """Build a deterministic-ish storage path for generated audio."""
        project_segment = project_id or "standalone"
        voice_segment = voice_id or "unknown-voice"
        date_segment = datetime.utcnow().strftime("%Y/%m/%d")
        return f"generations/{project_segment}/{voice_segment}/{date_segment}/{file_stem}.wav"

    @classmethod
    def upload_audio_file(
        cls,
        file_path: Path,
        *,
        project_id: Optional[str] = None,
        voice_id: Optional[str] = None,
        object_path: Optional[str] = None,
    ) -> str:
        """Upload a local audio file to Supabase Storage and return the object path."""
        supabase_url, service_role_key, bucket_name = cls._config()
        resolved_object_path = object_path or cls.build_object_path(
            file_stem=file_path.stem,
            project_id=project_id,
            voice_id=voice_id,
        )

        upload_url = (
            f"{supabase_url}/storage/v1/object/{bucket_name}/"
            f"{quote(resolved_object_path, safe='/')}"
        )

        headers = {
            "Authorization": f"Bearer {service_role_key}",
            "apikey": service_role_key,
            "Content-Type": "audio/wav",
        }

        with file_path.open("rb") as audio_file:
            response = httpx.post(
                upload_url,
                headers=headers,
                content=audio_file.read(),
                timeout=120.0,
            )

        if response.status_code not in (200, 201):
            logger.error("Supabase upload failed for %s: %s", file_path.name, response.text)
            raise RuntimeError(f"Supabase upload failed: {response.text}")

        logger.info("Uploaded audio to Supabase Storage: %s", resolved_object_path)
        return resolved_object_path

    @classmethod
    def build_proxy_url(cls, object_path: str) -> str:
        """Build the backend proxy URL for a stored audio object."""
        return f"/api/audio/proxy?path={quote(object_path, safe='')}"

    @classmethod
    def store_audio_file(
        cls,
        file_path: Path,
        *,
        project_id: Optional[str] = None,
        voice_id: Optional[str] = None,
    ) -> Tuple[str, str]:
        """Upload audio and return both the storage path and proxy URL."""
        object_path = cls.upload_audio_file(
            file_path,
            project_id=project_id,
            voice_id=voice_id,
        )
        proxy_url = cls.build_proxy_url(object_path)
        return object_path, proxy_url