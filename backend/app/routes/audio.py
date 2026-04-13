"""
Audio proxy routes for generated voice files.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from urllib.parse import quote
from io import BytesIO
import httpx
import os
import logging

from app.middleware.auth import get_current_user
from app.services.project_service import ProjectService
from database.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/audio", tags=["audio"])


@router.get("/proxy")
def proxy_audio_file(
    path: str = Query(..., description="Supabase storage object path"),
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stream an audio file from Supabase Storage through the API."""
    supabase_url = os.getenv("SUPABASE_URL")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    bucket_name = os.getenv("SUPABASE_STORAGE_BUCKET", "audio-generations")

    if not supabase_url:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Supabase URL is not configured")

    if not service_role_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Supabase service key is not configured")

    if not path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Audio path is required")

    path_parts = path.strip("/").split("/")
    if len(path_parts) >= 2 and path_parts[0] == "generations" and path_parts[1] != "standalone":
        project_id = path_parts[1]
        project = ProjectService.get_project(db, project_id, current_user)
        if not project:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to access this audio file")

    storage_url = (
        f"{supabase_url.rstrip('/')}/storage/v1/object/{bucket_name}/"
        f"{quote(path.lstrip('/'), safe='/')}"
    )

    headers = {
        "Authorization": f"Bearer {service_role_key}",
        "apikey": service_role_key,
    }

    response = httpx.get(storage_url, headers=headers, timeout=120.0)
    if response.status_code != 200:
        logger.error("Failed to fetch audio file %s from Supabase: %s", path, response.text)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audio file not found")

    content_type = response.headers.get("content-type", "audio/wav")
    filename = path.split("/")[-1] or "audio.wav"

    return StreamingResponse(
        BytesIO(response.content),
        media_type=content_type,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
