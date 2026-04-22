"""Audio proxy and storage management routes."""

from __future__ import annotations

from datetime import datetime
from io import BytesIO
from pathlib import Path
from urllib.parse import quote
import logging
import mimetypes
import os
import re
import tempfile
import uuid

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_serializer
from sqlalchemy.orm import Session

from app.middleware.auth import get_current_user
from app.services.project_service import ProjectService, STANDALONE_PROJECT_NAME
from app.services.storage_service import SupabaseStorageService
from database.database import get_db
from database.models import Generation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/audio", tags=["audio"])

ALLOWED_AUDIO_EXTENSIONS = {
    ".mp3": "mp3",
    ".wav": "wav",
    ".flac": "flac",
    ".ogg": "ogg",
    ".aac": "aac",
    ".m4a": "m4a",
}
DEFAULT_STORAGE_QUOTA_BYTES = int(
    os.getenv("USER_AUDIO_STORAGE_QUOTA_BYTES", str(2 * 1024 * 1024 * 1024))
)
UPLOAD_NOTE_PREFIX = "Uploaded audio file:"


class StorageAudioFileResponse(BaseModel):
    id: str
    projectId: str | None
    projectName: str | None = None
    fileName: str
    fileSizeBytes: int
    durationSeconds: float
    uploadedAt: datetime
    createdAt: datetime
    format: str
    audioUrl: str | None = None
    audioPath: str | None = None
    title: str | None = None
    textPrompt: str
    voiceId: str | None = None
    sourceType: str

    @field_serializer("uploadedAt", "createdAt")
    def serialize_datetime(self, value: datetime) -> str:
        return value.isoformat()


class StorageFilesResponse(BaseModel):
    quotaBytes: int
    usedBytes: int
    remainingBytes: int
    fileCount: int
    files: list[StorageAudioFileResponse]


class BulkDeleteRequest(BaseModel):
    generationIds: list[str]


class BulkDeleteResponse(BaseModel):
    deletedIds: list[str]
    deletedCount: int


def _sanitize_file_stem(filename: str) -> str:
    stem = Path(filename).stem.strip()
    sanitized = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-._")
    return sanitized or "audio"


def _guess_file_name(generation: Generation) -> str:
    if generation.title:
        return generation.title

    if generation.audio_path:
        return Path(generation.audio_path).name

    return f"audio-{generation.id}.{(generation.file_format or 'wav').lower()}"


def _guess_source_type(generation: Generation) -> str:
    if generation.voice_id:
        return "generated"
    return "uploaded"


def _estimate_audio_duration(file_path: Path) -> float:
    try:
        import librosa

        duration = librosa.get_duration(path=str(file_path))
        if duration and duration > 0:
            return float(duration)
    except Exception as exc:
        logger.warning("Could not determine duration for %s: %s", file_path.name, exc)

    return 0.0


def _get_owned_generation(
    db: Session,
    generation_id: str,
    current_user: str,
) -> Generation | None:
    try:
        generation_uuid = uuid.UUID(str(generation_id))
        user_uuid = uuid.UUID(str(current_user))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid audio file ID",
        )

    return (
        db.query(Generation)
        .filter(
            Generation.id == generation_uuid,
            Generation.user_id == user_uuid,
        )
        .first()
    )


def _resolve_file_size_bytes(generation: Generation) -> int:
    audio_path = (generation.audio_path or "").strip()
    if not audio_path:
        return 0

    if audio_path.startswith("generations/"):
        try:
            return SupabaseStorageService.get_object_size(audio_path) or 0
        except Exception as exc:
            logger.warning("Could not load file size for %s: %s", audio_path, exc)
            return 0

    local_path = Path(audio_path)
    if local_path.exists():
        return local_path.stat().st_size

    return 0


def _build_storage_file_response(generation: Generation) -> StorageAudioFileResponse:
    project_name = None
    if generation.project is not None:
        project_name = (
            STANDALONE_PROJECT_NAME
            if getattr(generation.project, "is_system", False)
            else generation.project.name
        )

    return StorageAudioFileResponse(
        id=str(generation.id),
        projectId=str(generation.project_id) if generation.project_id else None,
        projectName=project_name,
        fileName=_guess_file_name(generation),
        fileSizeBytes=_resolve_file_size_bytes(generation),
        durationSeconds=float(generation.duration_seconds or 0.0),
        uploadedAt=generation.created_at,
        createdAt=generation.created_at,
        format=(generation.file_format or "wav").upper(),
        audioUrl=(
            SupabaseStorageService.build_proxy_url(generation.audio_path)
            if generation.audio_path
            else None
        ),
        audioPath=generation.audio_path,
        title=generation.title,
        textPrompt=generation.text_prompt,
        voiceId=generation.voice_id,
        sourceType=_guess_source_type(generation),
    )


def _list_owned_generations(db: Session, current_user: str) -> list[Generation]:
    user_uuid = uuid.UUID(str(current_user))
    return (
        db.query(Generation)
        .filter(Generation.user_id == user_uuid)
        .order_by(Generation.created_at.desc())
        .all()
    )


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

    normalized_path = path.lstrip("/")
    generation = db.query(Generation).filter(Generation.audio_path == normalized_path).first()
    if generation is not None:
        project = ProjectService.get_project(db, str(generation.project_id), current_user)
        if not project:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to access this audio file")
    elif normalized_path.startswith("generations/"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to access this audio file")

    storage_url = (
        f"{supabase_url.rstrip('/')}/storage/v1/object/{bucket_name}/"
        f"{quote(normalized_path, safe='/')}"
    )

    headers = {
        "Authorization": f"Bearer {service_role_key}",
        "apikey": service_role_key,
    }

    response = httpx.get(storage_url, headers=headers, timeout=120.0)
    if response.status_code != 200:
        logger.error("Failed to fetch audio file %s from Supabase: %s", normalized_path, response.text)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audio file not found")

    content_type = response.headers.get("content-type", "audio/wav")
    filename = normalized_path.split("/")[-1] or "audio.wav"

    return StreamingResponse(
        BytesIO(response.content),
        media_type=content_type,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/storage/files", response_model=StorageFilesResponse)
def list_storage_files(
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StorageFilesResponse:
    generations = _list_owned_generations(db, current_user)
    files = [
        _build_storage_file_response(generation)
        for generation in generations
        if generation.audio_path
    ]
    used_bytes = sum(file.fileSizeBytes for file in files)

    return StorageFilesResponse(
        quotaBytes=DEFAULT_STORAGE_QUOTA_BYTES,
        usedBytes=used_bytes,
        remainingBytes=max(DEFAULT_STORAGE_QUOTA_BYTES - used_bytes, 0),
        fileCount=len(files),
        files=files,
    )


@router.get("/storage/files/{generation_id}", response_model=StorageAudioFileResponse)
def get_storage_file_details(
    generation_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StorageAudioFileResponse:
    generation = _get_owned_generation(db, generation_id, current_user)
    if generation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audio file not found",
        )

    return _build_storage_file_response(generation)


@router.post("/storage/upload", response_model=StorageAudioFileResponse, status_code=status.HTTP_201_CREATED)
async def upload_storage_file(
    file: UploadFile = File(...),
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StorageAudioFileResponse:
    filename = (file.filename or "").strip()
    extension = Path(filename).suffix.lower()
    if not filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A file name is required",
        )

    if extension not in ALLOWED_AUDIO_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file type. Allowed: mp3, wav, flac, ogg, aac, m4a",
        )

    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty",
        )

    existing_files = [
        _build_storage_file_response(generation)
        for generation in _list_owned_generations(db, current_user)
        if generation.audio_path
    ]
    used_bytes = sum(item.fileSizeBytes for item in existing_files)
    if used_bytes + len(content) > DEFAULT_STORAGE_QUOTA_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploading this file would exceed your audio storage quota",
        )

    standalone_project = ProjectService.get_or_create_standalone_project(db, current_user)
    safe_stem = _sanitize_file_stem(filename)
    object_path = SupabaseStorageService.build_object_path(
        file_stem=f"{uuid.uuid4().hex}_{safe_stem}",
        project_id=str(standalone_project.id),
        voice_id="uploaded",
        extension=extension,
    )

    temp_path = Path(tempfile.gettempdir()) / f"storage_upload_{uuid.uuid4().hex}{extension}"
    temp_path.write_bytes(content)

    try:
        duration_seconds = _estimate_audio_duration(temp_path)
        storage_path = SupabaseStorageService.upload_audio_file(
            temp_path,
            project_id=str(standalone_project.id),
            voice_id="uploaded",
            object_path=object_path,
            content_type=(
                file.content_type
                or mimetypes.guess_type(filename)[0]
                or "application/octet-stream"
            ),
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
    finally:
        temp_path.unlink(missing_ok=True)

    generation = Generation(
        id=uuid.uuid4(),
        project_id=standalone_project.id,
        user_id=uuid.UUID(str(current_user)),
        voice_id=None,
        text_prompt=f"{UPLOAD_NOTE_PREFIX} {filename}",
        speed=1.0,
        pitch=1.0,
        duration_seconds=duration_seconds,
        audio_path=storage_path,
        file_format=ALLOWED_AUDIO_EXTENSIONS[extension],
        title=filename,
        created_at=datetime.utcnow(),
    )
    db.add(generation)
    db.commit()
    db.refresh(generation)

    return _build_storage_file_response(generation)


@router.delete("/storage/files/{generation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_storage_file(
    generation_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    generation = _get_owned_generation(db, generation_id, current_user)
    if generation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audio file not found",
        )

    deleted = ProjectService.delete_generation(
        db,
        generation_id,
        str(generation.project_id) if generation.project_id else None,
    )
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audio file not found",
        )

    return None


@router.post("/storage/files/bulk-delete", response_model=BulkDeleteResponse)
def bulk_delete_storage_files(
    payload: BulkDeleteRequest,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BulkDeleteResponse:
    deleted_ids: list[str] = []

    for generation_id in payload.generationIds:
        generation = _get_owned_generation(db, generation_id, current_user)
        if generation is None:
            continue

        deleted = ProjectService.delete_generation(
            db,
            generation_id,
            str(generation.project_id) if generation.project_id else None,
        )
        if deleted:
            deleted_ids.append(generation_id)

    return BulkDeleteResponse(
        deletedIds=deleted_ids,
        deletedCount=len(deleted_ids),
    )
