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
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from sqlalchemy.orm import joinedload

from app.middleware.auth import get_current_user
from app.services.project_service import ProjectService, STANDALONE_PROJECT_NAME
from app.services.storage_service import SupabaseStorageService
from database.database import get_db
from database.models import Generation, Project

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
    totalCount: int
    skip: int
    limit: int
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


def _build_owned_storage_query(db: Session, current_user: str):
    user_uuid = uuid.UUID(str(current_user))
    return (
        db.query(Generation)
        .options(joinedload(Generation.project))
        .filter(
            Generation.user_id == user_uuid,
            Generation.audio_path.isnot(None),
        )
    )


def _apply_storage_filters(
    query,
    *,
    project_id: str | None,
    voice_id: str | None,
    date_from: datetime | None,
    date_to: datetime | None,
    min_duration: float | None,
    max_duration: float | None,
    search_text: str | None,
    file_format: str | None,
):
    if project_id:
        query = query.filter(Generation.project_id == uuid.UUID(str(project_id)))

    if voice_id:
        query = query.filter(Generation.voice_id == voice_id)

    if date_from is not None:
        query = query.filter(Generation.created_at >= date_from)

    if date_to is not None:
        query = query.filter(Generation.created_at <= date_to)

    if min_duration is not None:
        query = query.filter(Generation.duration_seconds >= min_duration)

    if max_duration is not None:
        query = query.filter(Generation.duration_seconds <= max_duration)

    if search_text:
        search_pattern = f"%{search_text.strip()}%"
        query = query.join(Project, Generation.project_id == Project.id)
        query = query.filter(
            or_(
                Generation.text_prompt.ilike(search_pattern),
                Generation.title.ilike(search_pattern),
                Project.name.ilike(search_pattern),
                Generation.file_format.ilike(search_pattern),
            )
        )

    if file_format and file_format.upper() != "ALL":
        query = query.filter(func.lower(Generation.file_format) == file_format.lower())

    return query


def _apply_storage_sorting(query, sort_by: str, sort_order: str):
    is_desc = sort_order.lower() != "asc"

    if sort_by == "name":
        sort_column = func.coalesce(Generation.title, Generation.text_prompt)
    elif sort_by == "duration_seconds":
        sort_column = Generation.duration_seconds
    else:
        sort_column = Generation.created_at

    ordered = sort_column.desc() if is_desc else sort_column.asc()
    tie_breaker = Generation.created_at.desc()
    return query.order_by(ordered, tie_breaker)


def _parse_storage_date(value: str, *, end_of_day: bool = False) -> datetime:
    normalized_value = value.strip()
    if "T" not in normalized_value and " " not in normalized_value:
        normalized_value = (
            f"{normalized_value}T23:59:59"
            if end_of_day
            else f"{normalized_value}T00:00:00"
        )

    return datetime.fromisoformat(normalized_value.replace("Z", "+00:00"))


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
    project_id: str | None = Query(None, description="Filter by project ID"),
    voice_id: str | None = Query(None, description="Filter by voice ID"),
    date_from: str | None = Query(None, description="Filter files from this date (ISO format)"),
    date_to: str | None = Query(None, description="Filter files until this date (ISO format)"),
    min_duration: float | None = Query(None, description="Minimum duration in seconds"),
    max_duration: float | None = Query(None, description="Maximum duration in seconds"),
    search_text: str | None = Query(None, description="Search prompt, title, project name, or format"),
    file_format: str | None = Query(None, description="Filter by file format"),
    sort_by: str = Query("created_at", description="Sort by created_at, duration_seconds, name, or size"),
    sort_order: str = Query("desc", description="Sort order: asc or desc"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=100, description="Number of records to return"),
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StorageFilesResponse:
    valid_sort_fields = {"created_at", "duration_seconds", "name", "size"}
    if sort_by not in valid_sort_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid sort_by. Must be one of: {', '.join(sorted(valid_sort_fields))}",
        )

    if sort_order.lower() not in {"asc", "desc"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid sort_order. Must be 'asc' or 'desc'",
        )

    parsed_date_from = None
    parsed_date_to = None
    if date_from:
        try:
          parsed_date_from = _parse_storage_date(date_from)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid date_from format. Use ISO format or YYYY-MM-DD.",
            ) from exc
    if date_to:
        try:
            parsed_date_to = _parse_storage_date(date_to, end_of_day=True)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid date_to format. Use ISO format or YYYY-MM-DD.",
            ) from exc

    all_generations = _build_owned_storage_query(db, current_user).all()
    file_count = len(all_generations)
    used_bytes = sum(_resolve_file_size_bytes(generation) for generation in all_generations)

    filtered_query = _apply_storage_filters(
        _build_owned_storage_query(db, current_user),
        project_id=project_id,
        voice_id=voice_id,
        date_from=parsed_date_from,
        date_to=parsed_date_to,
        min_duration=min_duration,
        max_duration=max_duration,
        search_text=search_text,
        file_format=file_format,
    )
    total_count = filtered_query.count()

    if sort_by == "size":
        filtered_files = [
            _build_storage_file_response(generation)
            for generation in filtered_query.all()
        ]
        filtered_files.sort(
            key=lambda file: (file.fileSizeBytes, file.uploadedAt.isoformat(), file.id),
            reverse=sort_order.lower() == "desc",
        )
        files = filtered_files[skip : skip + limit]
    else:
        generations = _apply_storage_sorting(filtered_query, sort_by, sort_order).offset(skip).limit(limit).all()
        files = [
            _build_storage_file_response(generation)
            for generation in generations
        ]

    return StorageFilesResponse(
        quotaBytes=DEFAULT_STORAGE_QUOTA_BYTES,
        usedBytes=used_bytes,
        remainingBytes=max(DEFAULT_STORAGE_QUOTA_BYTES - used_bytes, 0),
        fileCount=file_count,
        totalCount=total_count,
        skip=skip,
        limit=limit,
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
