from fastapi import APIRouter, Depends, HTTPException, status, Query, File, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel, Field, field_serializer
from datetime import datetime
import json
import logging
from urllib.parse import quote
import uuid

from app.services.project_service import ProjectService, STANDALONE_PROJECT_NAME
from app.services.tts_service import TTSService
from database.models import Project, Generation, ProjectFolder, AudioCollection, AudioTag, ProjectShare
from database.database import get_db
from app.middleware.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/projects", tags=["projects"])


def project_belongs_to_user(project: Project | None, user_id: str) -> bool:
    return project is not None and str(project.user_id) == str(user_id)


def parse_uuid(value: str | uuid.UUID | None) -> uuid.UUID | None:
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return value
    return uuid.UUID(str(value))


def serialize_uuid(value: str | uuid.UUID | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return str(value)
    return str(value)


def build_generation_response(
    *,
    generation_id: str | uuid.UUID,
    project_id: str | uuid.UUID | None,
    user_id: str | uuid.UUID,
    text: str,
    voice_id: str | uuid.UUID | None,
    audio_path: str | None,
    audio_url: str | None,
    duration_seconds: float,
    created_at: datetime,
    file_format: str = "wav",
    title: str | None = None,
    folder_id: str | None = None,
    project_name: str | None = None,
) -> "GenerationResponse":
    normalized_id = serialize_uuid(generation_id)
    normalized_user_id = serialize_uuid(user_id)

    if normalized_id is None or normalized_user_id is None:
        raise ValueError("Generation response requires generation_id and user_id")

    return GenerationResponse(
        id=normalized_id,
        project_id=serialize_uuid(project_id),
        user_id=normalized_user_id,
        text=text,
        text_prompt=text,
        voice_id=serialize_uuid(voice_id),
        audio_path=audio_path,
        audio_file_path=audio_path,
        file_format=file_format,
        audio_url=audio_url,
        title=title,
        folder_id=folder_id,
        project_name=project_name,
        duration_seconds=duration_seconds,
        created_at=created_at,
        updated_at=created_at,
    )


def build_generation_audio_url(audio_path: str | None) -> str | None:
    if not audio_path:
        return None
    return f"/api/audio/proxy?path={quote(audio_path, safe='')}"


def get_generation_project_name(project: Project | None) -> str | None:
    if project is None:
        return None
    if getattr(project, "is_system", False):
        return STANDALONE_PROJECT_NAME
    return project.name


def create_generation_record(
    db: Session,
    *,
    project_id: str | uuid.UUID,
    user_id: str | uuid.UUID,
    text: str,
    voice_id: str | None,
    speed: float,
    pitch: float,
    duration_seconds: float,
    audio_path: str,
    file_format: str = "wav",
    title: str | None = None,
) -> Generation:
    generation = Generation(
        project_id=parse_uuid(project_id),
        user_id=parse_uuid(user_id),
        voice_id=voice_id,
        text_prompt=text,
        speed=speed,
        pitch=pitch,
        duration_seconds=duration_seconds,
        audio_path=audio_path,
        file_format=file_format,
        title=title,
    )
    db.add(generation)
    db.commit()
    db.refresh(generation)
    return generation


def serialize_generation(generation: Generation) -> "GenerationResponse":
    return build_generation_response(
        generation_id=generation.id,
        project_id=generation.project_id,
        user_id=generation.user_id,
        text=generation.text_prompt,
        voice_id=generation.voice_id,
        audio_path=generation.audio_path,
        audio_url=build_generation_audio_url(generation.audio_path),
        duration_seconds=generation.duration_seconds,
        created_at=generation.created_at,
        file_format=generation.file_format,
        title=generation.title,
        folder_id=serialize_uuid(generation.folder_id),
        project_name=get_generation_project_name(generation.project),
    )

# ==================== PYDANTIC MODELS ====================

class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class ProjectResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    description: Optional[str]
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True
    
    @field_serializer('id', 'user_id')
    def serialize_uuid(self, value):
        if isinstance(value, uuid.UUID):
            return str(value)
        return value

class FolderCreate(BaseModel):
    name: str
    parent_folder_id: Optional[str] = None

class FolderResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    parent_folder_id: Optional[uuid.UUID]
    name: str
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True
    
    @field_serializer('id', 'project_id', 'parent_folder_id')
    def serialize_uuid(self, value):
        if isinstance(value, uuid.UUID):
            return str(value)
        return value

class CollectionCreate(BaseModel):
    name: str
    description: Optional[str] = None
    color: str = "#3b82f6"

class CollectionResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    description: Optional[str]
    color: str
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True
    
    @field_serializer('id', 'project_id')
    def serialize_uuid(self, value):
        if isinstance(value, uuid.UUID):
            return str(value)
        return value

class TagCreate(BaseModel):
    name: str
    color: str = "#10b981"

class TagResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    color: str
    created_at: datetime
    
    class Config:
        from_attributes = True
    
    @field_serializer('id', 'project_id')
    def serialize_uuid(self, value):
        if isinstance(value, uuid.UUID):
            return str(value)
        return value

class ShareCreate(BaseModel):
    shared_with_user_id: str
    permission: str = "viewer"  # viewer, editor, admin

class ShareResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    shared_with_user_id: uuid.UUID
    permission: str
    created_at: datetime
    
    class Config:
        from_attributes = True
    
    @field_serializer('id', 'project_id', 'shared_with_user_id')
    def serialize_uuid(self, value):
        if isinstance(value, uuid.UUID):
            return str(value)
        return value

class AnalyticsResponse(BaseModel):
    project_id: str
    total_generations: int
    total_duration_seconds: float
    total_characters: int
    last_modified: str

# ==================== TTS GENERATION MODELS ====================

class GenerationRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000, description="Text to synthesize")
    voice_id: str = Field(..., description="Voice model identifier (e.g., 'af_bella')")
    speed: float = Field(1.0, ge=0.5, le=2.0, description="Speech speed multiplier")
    pitch: float = Field(1.0, ge=0.5, le=2.0, description="Pitch multiplier")
    folder_id: Optional[str] = Field(None, description="Optional folder to save generation in")
    title: Optional[str] = Field(None, max_length=255, description="Optional title for the generation")

class GenerationResponse(BaseModel):
    id: str
    project_id: Optional[str] = None
    project_name: Optional[str] = None
    user_id: str
    text: str
    text_prompt: str
    voice_id: Optional[str] = None
    audio_path: Optional[str] = None
    audio_file_path: Optional[str] = None
    file_format: str = "wav"
    audio_url: Optional[str] = None
    title: Optional[str] = None
    folder_id: Optional[str] = None
    duration_seconds: float
    created_at: datetime
    updated_at: datetime

class VoiceResponse(BaseModel):
    id: str
    name: str
    language: str
    gender: str
    
    class Config:
        from_attributes = True
    
    @field_serializer('id')
    def serialize_uuid(self, value):
        if isinstance(value, uuid.UUID):
            return str(value)
        return value

# ==================== PROJECT ENDPOINTS ====================

@router.get("/", response_model=dict)
def list_projects(
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all projects for the current user."""
    logger.info(f"GET /api/projects called for user: {current_user}")
    try:
        projects = ProjectService.list_projects(db, current_user)
        logger.info(f"Returning {len(projects)} projects for user: {current_user}")
        serialized_projects = [
            {
                "id": str(project.id),
                "user_id": str(project.user_id),
                "name": project.name,
                "description": project.description,
                "created_at": project.created_at.isoformat() if project.created_at else None,
                "updated_at": project.updated_at.isoformat() if project.updated_at else None,
            }
            for project in projects
        ]
        return {"projects": serialized_projects}
    except HTTPException as exc:
        logger.error(
            "HTTP error in GET /api/projects for user %s: %s",
            current_user,
            exc.detail,
            exc_info=True,
        )
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    except Exception as exc:
        logger.exception("Unhandled error in GET /api/projects for user %s", current_user)
        return JSONResponse(status_code=500, content={"detail": str(exc)})

@router.post("/", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreate,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new project."""
    project = ProjectService.create_project(db, current_user, payload.name, payload.description)
    return project

@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(
    project_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get project details."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project

@router.put("/{project_id}", response_model=ProjectResponse)
def update_project(
    project_id: str,
    payload: ProjectUpdate,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update project."""
    try:
        project = ProjectService.get_project(db, project_id, current_user)
        if not project_belongs_to_user(project, current_user):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

        project = ProjectService.update_project(db, project_id, payload.name, payload.description)
        return project
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to update project %s", project_id)
        return JSONResponse(status_code=500, content={"detail": str(exc)})

@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: str,
    delete_audio_files: bool = Query(False),
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a project."""
    try:
        project = ProjectService.get_project(db, project_id, current_user)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found",
            )

        if not project_belongs_to_user(project, current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the project owner can delete this project",
            )

        if project.is_system:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="System projects cannot be deleted",
            )

        deleted = ProjectService.delete_project(
            db,
            project_id,
            delete_audio_files=delete_audio_files,
        )
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found",
            )

        return None
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to delete project %s", project_id)
        return JSONResponse(status_code=500, content={"detail": str(exc)})


# ==================== GENERATION FILTERING ENDPOINT ====================

class FilteredGenerationsResponse(BaseModel):
    """Response model for filtered generations."""
    generations: List['GenerationResponse']
    total_count: int
    skip: int
    limit: int


@router.get("/generations/search", response_model=FilteredGenerationsResponse)
def search_generations(
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
    project_id: Optional[str] = Query(None, description="Filter by project ID"),
    voice_id: Optional[str] = Query(None, description="Filter by voice ID"),
    date_from: Optional[str] = Query(None, description="Filter generations from this date (ISO format)"),
    date_to: Optional[str] = Query(None, description="Filter generations until this date (ISO format)"),
    min_duration: Optional[float] = Query(None, description="Minimum duration in seconds"),
    max_duration: Optional[float] = Query(None, description="Maximum duration in seconds"),
    search_text: Optional[str] = Query(None, description="Search in text prompt"),
    sort_by: str = Query("created_at", description="Sort field: created_at, duration_seconds, text_prompt"),
    sort_order: str = Query("desc", description="Sort order: asc or desc"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(50, ge=1, le=500, description="Number of records to return")
):
    """
    Search and filter generations across all projects with advanced filtering.
    
    Supports filtering by:
    - project_id: Limit to specific project
    - voice_id: Filter by voice
    - date_from, date_to: Date range filtering
    - min_duration, max_duration: Duration range in seconds
    - search_text: Text search in prompts
    - sort_by: Sort by created_at, duration_seconds, or text_prompt
    - sort_order: asc or desc
    - Pagination: skip and limit
    """
    try:
        # Parse dates if provided
        parsed_date_from = None
        parsed_date_to = None
        
        if date_from:
            try:
                # Handle various ISO format strings
                # First try with time component
                if 'T' in date_from or ' ' in date_from:
                    parsed_date_from = datetime.fromisoformat(date_from.replace('Z', '+00:00'))
                else:
                    # Just date, add midnight time
                    parsed_date_from = datetime.fromisoformat(date_from + "T00:00:00")
            except (ValueError, TypeError):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid date_from format. Use ISO format (e.g., 2024-01-15 or 2024-01-15T00:00:00)"
                )
        
        if date_to:
            try:
                # Handle various ISO format strings
                if 'T' in date_to or ' ' in date_to:
                    parsed_date_to = datetime.fromisoformat(date_to.replace('Z', '+00:00'))
                else:
                    # Just date, add end of day time
                    parsed_date_to = datetime.fromisoformat(date_to + "T23:59:59")
            except (ValueError, TypeError):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid date_to format. Use ISO format (e.g., 2024-01-15 or 2024-01-15T23:59:59)"
                )
        
        # Validate sort_by
        valid_sort_fields = ["created_at", "duration_seconds", "text_prompt"]
        if sort_by not in valid_sort_fields:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid sort_by. Must be one of: {', '.join(valid_sort_fields)}"
            )
        
        # Validate sort_order
        if sort_order.lower() not in ["asc", "desc"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid sort_order. Must be 'asc' or 'desc'"
            )
        
        # Call the filter service
        generations, total_count = ProjectService.filter_generations(
            db=db,
            user_id=current_user,
            project_id=project_id,
            voice_id=voice_id,
            date_from=parsed_date_from,
            date_to=parsed_date_to,
            min_duration=min_duration,
            max_duration=max_duration,
            search_text=search_text,
            sort_by=sort_by,
            sort_order=sort_order,
            skip=skip,
            limit=limit
        )
        
        return FilteredGenerationsResponse(
            generations=[serialize_generation(gen) for gen in generations],
            total_count=total_count,
            skip=skip,
            limit=limit
        )
        
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error searching generations")
        return JSONResponse(
            status_code=500,
            content={"detail": "Failed to search generations"}
        )


@router.get("/{project_id}/generations", response_model=List[GenerationResponse])
def list_generations(
    project_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all saved generations in a project."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    generations = ProjectService.list_generations(db, project_id)
    return [serialize_generation(generation) for generation in generations]


@router.get("/{project_id}/generations/{generation_id}", response_model=GenerationResponse)
def get_generation(
    project_id: str,
    generation_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a single saved generation in a project."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    generation = ProjectService.get_generation(db, generation_id, project_id)
    if not generation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Generation not found")

    return serialize_generation(generation)


@router.delete("/{project_id}/generations/{generation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_generation(
    project_id: str,
    generation_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a saved generation in a project."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project_belongs_to_user(project, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    deleted = ProjectService.delete_generation(db, generation_id, project_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Generation not found")

    return None

# ==================== FOLDER ENDPOINTS ====================

@router.get("/{project_id}/folders", response_model=List[FolderResponse])
def list_folders(
    project_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all folders in a project."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    
    folders = ProjectService.get_folders(db, project_id)
    return folders

@router.post("/{project_id}/folders", response_model=FolderResponse, status_code=status.HTTP_201_CREATED)
def create_folder(
    project_id: str,
    payload: FolderCreate,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a folder in a project."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project_belongs_to_user(project, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    folder = ProjectService.create_folder(db, project_id, payload.name, payload.parent_folder_id)
    return folder

@router.delete("/{project_id}/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_folder(
    project_id: str,
    folder_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a folder."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project_belongs_to_user(project, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    ProjectService.delete_folder(db, folder_id)
    return None

# ==================== COLLECTION ENDPOINTS ====================

@router.get("/{project_id}/collections", response_model=List[CollectionResponse])
def list_collections(
    project_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all collections in a project."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    
    collections = ProjectService.get_collections(db, project_id)
    return collections

@router.post("/{project_id}/collections", response_model=CollectionResponse, status_code=status.HTTP_201_CREATED)
def create_collection(
    project_id: str,
    payload: CollectionCreate,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a collection."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project_belongs_to_user(project, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    collection = ProjectService.create_collection(db, project_id, payload.name, payload.description, payload.color)
    return collection

@router.post("/{project_id}/collections/{collection_id}/audios/{generation_id}")
def add_to_collection(
    project_id: str,
    collection_id: str,
    generation_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add audio to collection."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project_belongs_to_user(project, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    success = ProjectService.add_to_collection(db, generation_id, collection_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to add to collection")
    
    return {"status": "success"}

@router.delete("/{project_id}/collections/{collection_id}/audios/{generation_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_from_collection(
    project_id: str,
    collection_id: str,
    generation_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove audio from collection."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project_belongs_to_user(project, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    ProjectService.remove_from_collection(db, generation_id, collection_id)
    return None

@router.delete("/{project_id}/collections/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_collection(
    project_id: str,
    collection_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a collection."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project_belongs_to_user(project, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    ProjectService.delete_collection(db, collection_id)
    return None

# ==================== TAG ENDPOINTS ====================

@router.get("/{project_id}/tags", response_model=List[TagResponse])
def list_tags(
    project_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all tags in a project."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    
    tags = ProjectService.get_tags(db, project_id)
    return tags

@router.post("/{project_id}/tags", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
def create_tag(
    project_id: str,
    payload: TagCreate,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a tag."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project_belongs_to_user(project, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    tag = ProjectService.create_tag(db, project_id, payload.name, payload.color)
    return tag

@router.post("/audios/{generation_id}/tags/{tag_id}")
def tag_audio(
    generation_id: str,
    tag_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Tag an audio."""
    success = ProjectService.tag_generation(db, generation_id, tag_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to tag audio")
    
    return {"status": "success"}

@router.delete("/audios/{generation_id}/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_tag_from_audio(
    generation_id: str,
    tag_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove tag from audio."""
    ProjectService.remove_tag(db, generation_id, tag_id)
    return None

@router.delete("/{project_id}/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(
    project_id: str,
    tag_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a tag."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project_belongs_to_user(project, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    ProjectService.delete_tag(db, tag_id)
    return None

# ==================== SHARING ENDPOINTS ====================

@router.get("/{project_id}/shares", response_model=List[ShareResponse])
def list_shares(
    project_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all shares for a project."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project_belongs_to_user(project, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    shares = ProjectService.get_shares(db, project_id)
    return shares

@router.post("/{project_id}/share", response_model=ShareResponse, status_code=status.HTTP_201_CREATED)
def share_project(
    project_id: str,
    payload: ShareCreate,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Share a project with another user."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project_belongs_to_user(project, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    share = ProjectService.share_project(db, project_id, payload.shared_with_user_id, payload.permission)
    return share

@router.delete("/{project_id}/shares/{share_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_share(
    project_id: str,
    share_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Revoke a project share."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project_belongs_to_user(project, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    ProjectService.revoke_share(db, share_id)
    return None

# ==================== TTS GENERATION ENDPOINTS ====================

@router.get("/voices/available", response_model=List[VoiceResponse])
def get_available_voices():
    """Get list of available Kokoro voices."""
    try:
        voices_dict = TTSService.get_available_voices()
        voices = [VoiceResponse(**voice) for voice in voices_dict.values()]
        return voices
    except Exception as e:
        logger.error(f"Failed to get available voices: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to load voices")

# ==================== STANDALONE GENERATION ENDPOINT ====================

@router.post("/generate/standalone", response_model=GenerationResponse, status_code=status.HTTP_201_CREATED)
def generate_audio_standalone(
    payload: GenerationRequest,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Generate audio without requiring a visible user project.
    
    This endpoint synthesizes text into audio and stores it in the user's hidden
    standalone workspace so it appears in generation history.
    """
    try:
        logger.info(f"Generating standalone audio for user {current_user}")
        standalone_project = ProjectService.get_or_create_standalone_project(
            db,
            current_user,
        )
        
        # Generate audio using TTS service
        audio_path, duration, audio_url = TTSService.generate_audio(
            text=payload.text,
            voice_id=payload.voice_id,
            speed=payload.speed,
            pitch=payload.pitch,
            project_id=str(standalone_project.id),
        )

        generation = create_generation_record(
            db,
            project_id=standalone_project.id,
            user_id=current_user,
            text=payload.text,
            voice_id=payload.voice_id,
            speed=payload.speed,
            pitch=payload.pitch,
            duration_seconds=duration,
            audio_path=audio_path,
            title=payload.title,
        )

        response = build_generation_response(
            generation_id=generation.id,
            project_id=generation.project_id,
            user_id=generation.user_id,
            project_name=STANDALONE_PROJECT_NAME,
            text=payload.text,
            voice_id=payload.voice_id,
            audio_path=generation.audio_path,
            audio_url=audio_url,
            duration_seconds=generation.duration_seconds,
            created_at=generation.created_at,
            file_format=generation.file_format,
            title=payload.title,
            folder_id=payload.folder_id,
        )
        
        logger.info(f"Standalone audio generated successfully")
        
        return response
        
    except ValueError as e:
        logger.warning(f"Validation error: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except RuntimeError as e:
        logger.error(f"TTS generation failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to generate audio")
    except Exception as e:
        logger.error(f"Unexpected error during generation: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

# ==================== PROJECT GENERATION ENDPOINT ====================

@router.post("/{project_id}/generate", response_model=GenerationResponse, status_code=status.HTTP_201_CREATED)
def generate_audio(
    project_id: str,
    payload: GenerationRequest,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Generate audio using Kokoro TTS.
    
    This endpoint synthesizes text into audio using the specified voice and parameters.
    """
    # Verify project ownership
    project = ProjectService.get_project(db, project_id, current_user)
    if not project_belongs_to_user(project, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    try:
        logger.info(f"Generating audio for user {current_user}, project {project_id}")
        
        # Generate audio using TTS service
        audio_path, duration, audio_url = TTSService.generate_audio(
            text=payload.text,
            voice_id=payload.voice_id,
            speed=payload.speed,
            pitch=payload.pitch,
            project_id=project_id,
        )
        
        generation = create_generation_record(
            db,
            project_id=project_id,
            user_id=current_user,
            text=payload.text,
            voice_id=payload.voice_id,
            speed=payload.speed,
            pitch=payload.pitch,
            duration_seconds=duration,
            audio_path=audio_path,
            title=payload.title,
        )

        response = build_generation_response(
            generation_id=generation.id,
            project_id=generation.project_id,
            user_id=generation.user_id,
            project_name=project.name,
            text=payload.text,
            voice_id=payload.voice_id,
            audio_path=generation.audio_path,
            audio_url=audio_url,
            duration_seconds=generation.duration_seconds,
            created_at=generation.created_at,
            file_format=generation.file_format,
            title=payload.title,
            folder_id=payload.folder_id,
        )
        
        logger.info(f"Audio generated successfully: {generation.id}")
        
        return response
        
    except ValueError as e:
        logger.warning(f"Validation error: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except RuntimeError as e:
        logger.error(f"TTS generation failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to generate audio")
    except Exception as e:
        logger.error(f"Unexpected error during generation: {e}")
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

# ==================== ANALYTICS ENDPOINTS ====================

@router.get("/{project_id}/analytics", response_model=AnalyticsResponse)
def get_analytics(
    project_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get project analytics."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    
    analytics = ProjectService.get_project_analytics(db, project_id)
    if not analytics:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analytics not found")
    
    return analytics

# ==================== BULK OPERATIONS ====================

@router.post("/{project_id}/bulk/delete")
def bulk_delete(
    project_id: str,
    generation_ids: List[str],
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Bulk delete generations."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project_belongs_to_user(project, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    count = ProjectService.bulk_delete_generations(db, generation_ids)
    return {"deleted": count}

@router.post("/{project_id}/bulk/tag")
def bulk_tag(
    project_id: str,
    generation_ids: List[str],
    tag_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Bulk tag generations."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project_belongs_to_user(project, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    count = ProjectService.bulk_tag_generations(db, generation_ids, tag_id)
    return {"tagged": count}

@router.post("/{project_id}/bulk/collect")
def bulk_collect(
    project_id: str,
    generation_ids: List[str],
    collection_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Bulk add generations to collection."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project_belongs_to_user(project, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    count = ProjectService.bulk_add_to_collection(db, generation_ids, collection_id)
    return {"added": count}

@router.post("/{project_id}/bulk/move")
def bulk_move(
    project_id: str,
    generation_ids: List[str],
    folder_id: str,
    current_user: str = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Bulk move generations to folder."""
    project = ProjectService.get_project(db, project_id, current_user)
    if not project_belongs_to_user(project, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    count = ProjectService.bulk_move_to_folder(db, generation_ids, folder_id)
    return {"moved": count}
