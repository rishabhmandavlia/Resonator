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
    def _build_storage_url(
        supabase_url: str,
        bucket_name: str,
        object_path: str,
    ) -> str:
        return (
            f"{supabase_url}/storage/v1/object/{bucket_name}/"
            f"{quote(object_path, safe='/')}"
        )

    @staticmethod
    def _build_headers(
        service_role_key: str,
        content_type: str | None = None,
    ) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {service_role_key}",
            "apikey": service_role_key,
        }
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    @staticmethod
    def build_object_path(
        file_stem: str,
        project_id: Optional[str] = None,
        voice_id: Optional[str] = None,
        extension: str = "wav",
    ) -> str:
        """Build a deterministic-ish storage path for generated audio."""
        project_segment = project_id or "standalone"
        voice_segment = voice_id or "unknown-voice"
        date_segment = datetime.utcnow().strftime("%Y/%m/%d")
        normalized_extension = extension.lower().lstrip(".") or "wav"
        return f"generations/{project_segment}/{voice_segment}/{date_segment}/{file_stem}.{normalized_extension}"

    @classmethod
    def upload_audio_file(
        cls,
        file_path: Path,
        *,
        project_id: Optional[str] = None,
        voice_id: Optional[str] = None,
        object_path: Optional[str] = None,
        content_type: str = "audio/wav",
    ) -> str:
        """Upload a local audio file to Supabase Storage and return the object path."""
        supabase_url, service_role_key, bucket_name = cls._config()
        resolved_object_path = object_path or cls.build_object_path(
            file_stem=file_path.stem,
            project_id=project_id,
            voice_id=voice_id,
            extension=file_path.suffix or "wav",
        )

        upload_url = cls._build_storage_url(
            supabase_url,
            bucket_name,
            resolved_object_path,
        )
        headers = cls._build_headers(service_role_key, content_type)

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
    def upload_audio_bytes(
        cls,
        content: bytes,
        *,
        object_path: str,
        content_type: str,
    ) -> str:
        """Upload in-memory audio bytes to Supabase Storage."""
        supabase_url, service_role_key, bucket_name = cls._config()
        upload_url = cls._build_storage_url(supabase_url, bucket_name, object_path)
        headers = cls._build_headers(service_role_key, content_type)

        response = httpx.post(
            upload_url,
            headers=headers,
            content=content,
            timeout=120.0,
        )

        if response.status_code not in (200, 201):
            logger.error("Supabase byte upload failed for %s: %s", object_path, response.text)
            raise RuntimeError(f"Supabase upload failed: {response.text}")

        logger.info("Uploaded audio bytes to Supabase Storage: %s", object_path)
        return object_path

    @classmethod
    def delete_audio_file(cls, object_path: str) -> bool:
        """Delete an audio object from Supabase Storage."""
        supabase_url, service_role_key, bucket_name = cls._config()
        delete_url = cls._build_storage_url(supabase_url, bucket_name, object_path)
        headers = cls._build_headers(service_role_key)

        response = httpx.delete(delete_url, headers=headers, timeout=120.0)
        if response.status_code in (200, 202, 204):
            logger.info("Deleted audio from Supabase Storage: %s", object_path)
            return True
        if response.status_code == 404:
            logger.info("Audio file already missing in Supabase Storage: %s", object_path)
            return False

        logger.error("Supabase delete failed for %s: %s", object_path, response.text)
        raise RuntimeError(f"Supabase delete failed: {response.text}")

    @classmethod
    def get_object_size(cls, object_path: str) -> int | None:
        """Read the size of a stored audio object."""
        supabase_url, service_role_key, bucket_name = cls._config()
        storage_url = cls._build_storage_url(supabase_url, bucket_name, object_path)
        headers = cls._build_headers(service_role_key)

        head_response = httpx.head(storage_url, headers=headers, timeout=30.0)
        if head_response.status_code == 200:
            content_length = head_response.headers.get("content-length")
            if content_length and content_length.isdigit():
                return int(content_length)

        range_response = httpx.get(
            storage_url,
            headers={**headers, "Range": "bytes=0-0"},
            timeout=30.0,
        )
        if range_response.status_code in (200, 206):
            content_range = range_response.headers.get("content-range")
            if content_range and "/" in content_range:
                total_size = content_range.rsplit("/", 1)[-1]
                if total_size.isdigit():
                    return int(total_size)

            content_length = range_response.headers.get("content-length")
            if content_length and content_length.isdigit() and range_response.status_code == 200:
                return int(content_length)

        if head_response.status_code == 404 or range_response.status_code == 404:
            return None

        logger.warning(
            "Could not determine object size for %s: HEAD=%s GET=%s",
            object_path,
            head_response.status_code,
            range_response.status_code,
        )
        return None

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
        content_type: str = "audio/wav",
    ) -> Tuple[str, str]:
        """Upload audio and return both the storage path and proxy URL."""
        object_path = cls.upload_audio_file(
            file_path,
            project_id=project_id,
            voice_id=voice_id,
            content_type=content_type,
        )
        proxy_url = cls.build_proxy_url(object_path)
        return object_path, proxy_url