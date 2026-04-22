from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from datetime import datetime
from pathlib import Path
import json
import uuid
from typing import List, Optional, Dict, Any
import logging

from database.models import (
    Project, Generation, ProjectFolder, AudioCollection, AudioTag,
    ProjectShare, GenerationDraft, ProjectAnalytics, GenerationHistory,
    generation_collections, generation_tags, User
)

logger = logging.getLogger(__name__)

STANDALONE_PROJECT_NAME = "Quick Generate"
STANDALONE_PROJECT_DESCRIPTION = "System-managed workspace for standalone generations"


def _as_uuid(value: str | uuid.UUID | None) -> uuid.UUID | None:
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return value
    return uuid.UUID(str(value))


class ProjectService:
    """Service layer for all project management operations."""

    @staticmethod
    def _delete_generation_audio(audio_path: str | None) -> None:
        if not audio_path:
            return

        normalized_path = audio_path.strip()
        if not normalized_path:
            return

        try:
            if normalized_path.startswith("generations/"):
                from app.services.storage_service import SupabaseStorageService

                SupabaseStorageService.delete_audio_file(normalized_path)
                return

            local_path = Path(normalized_path)
            if local_path.exists():
                local_path.unlink(missing_ok=True)
        except Exception as exc:
            logger.warning(
                "Failed to clean up stored audio for generation path %s: %s",
                normalized_path,
                exc,
            )
    
    # ==================== PROJECT OPERATIONS ====================
    
    @staticmethod
    def create_project(db: Session, user_id: str, name: str, description: str = None) -> Project:
        """Create a new project."""
        try:
            logger.info(f"Creating project: '{name}' for user: {user_id}")
            
            project = Project(
                id=uuid.uuid4(),
                user_id=_as_uuid(user_id),
                name=name,
                description=description,
                is_system=False,
                created_at=datetime.utcnow()
            )
            db.add(project)
            db.flush()
            
            # Create analytics record
            analytics = ProjectAnalytics(
                id=uuid.uuid4(),
                project_id=project.id,
                total_generations=0,
                total_duration_seconds=0.0,
                total_characters=0
            )
            db.add(analytics)
            db.commit()
            
            logger.info(f"Project created successfully with ID: {project.id}")
            return project
        
        except IntegrityError as e:
            db.rollback()
            logger.error(f"Integrity error creating project: {e}")
            raise
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error creating project: {e}")
            raise
        except Exception as e:
            db.rollback()
            logger.error(f"Unexpected error creating project: {e}")
            raise

    @staticmethod
    def get_or_create_standalone_project(db: Session, user_id: str) -> Project:
        """Get or create the hidden workspace that stores standalone generations."""
        try:
            user_uuid = _as_uuid(user_id)
            project = (
                db.query(Project)
                .filter(
                    Project.user_id == user_uuid,
                    Project.is_system.is_(True),
                )
                .order_by(Project.created_at.asc())
                .first()
            )
            if project:
                return project

            logger.info("Creating standalone system project for user: %s", user_id)
            project = Project(
                id=uuid.uuid4(),
                user_id=user_uuid,
                name=STANDALONE_PROJECT_NAME,
                description=STANDALONE_PROJECT_DESCRIPTION,
                is_system=True,
                created_at=datetime.utcnow(),
            )
            db.add(project)
            db.flush()

            analytics = ProjectAnalytics(
                id=uuid.uuid4(),
                project_id=project.id,
                total_generations=0,
                total_duration_seconds=0.0,
                total_characters=0,
            )
            db.add(analytics)
            db.commit()
            db.refresh(project)
            return project
        except SQLAlchemyError as e:
            db.rollback()
            logger.error("Database error creating standalone project for user %s: %s", user_id, e)
            raise
    
    @staticmethod
    def get_project(db: Session, project_id: str, user_id: str = None) -> Optional[Project]:
        """Get project by ID with permission check."""
        try:
            project_uuid = _as_uuid(project_id)
            user_uuid = _as_uuid(user_id)
            project = db.query(Project).filter(Project.id == project_uuid).first()
            if not project:
                return None
            
            if user_uuid and project.user_id != user_uuid:
                # Check if user has access via shares
                share = db.query(ProjectShare).filter(
                    ProjectShare.project_id == project_uuid,
                    ProjectShare.shared_with_user_id == user_uuid,
                ).first()
                if not share:
                    return None
            
            return project
        
        except SQLAlchemyError as e:
            logger.error(f"Database error getting project {project_id}: {e}")
            return None
    
    @staticmethod
    def list_projects(db: Session, user_id: str) -> List[Project]:
        """List all projects for a user (owned + shared)."""
        try:
            logger.info(f"Listing projects for user: {user_id}")
            user_uuid = _as_uuid(user_id)
            
            # Own projects
            owned = (
                db.query(Project)
                .filter(
                    Project.user_id == user_uuid,
                    Project.is_system.is_(False),
                )
                .all()
            )
            
            # Shared projects
            shared_ids = db.query(ProjectShare.project_id).filter(
                ProjectShare.shared_with_user_id == user_uuid
            ).all()
            shared_ids = [s[0] for s in shared_ids]
            shared = (
                db.query(Project)
                .filter(
                    Project.id.in_(shared_ids),
                    Project.is_system.is_(False),
                )
                .all()
                if shared_ids
                else []
            )
            
            return owned + shared
        
        except SQLAlchemyError as e:
            logger.error(f"Database error listing projects for user {user_id}: {e}")
            return []
    
    @staticmethod
    def update_project(db: Session, project_id: str, name: str = None, description: str = None) -> Project:
        """Update project details."""
        try:
            logger.info(f"Updating project: {project_id}")
            
            project = db.query(Project).filter(Project.id == _as_uuid(project_id)).first()
            if not project:
                return None
            
            if name:
                project.name = name
            if description is not None:
                project.description = description
            
            db.commit()
            logger.info(f"Project {project_id} updated successfully")
            return project
        
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error updating project {project_id}: {e}")
            raise
    
    @staticmethod
    def delete_project(
        db: Session,
        project_id: str,
        delete_audio_files: bool = False,
    ) -> bool:
        """Delete a project and all related data."""
        try:
            logger.info(f"Deleting project: {project_id}")
            
            project = db.query(Project).filter(Project.id == _as_uuid(project_id)).first()
            if not project:
                return False

            if project.is_system:
                logger.warning("Refusing to delete system project %s", project_id)
                return False

            audio_paths: List[str] = []
            if delete_audio_files:
                audio_paths = [
                    audio_path
                    for (audio_path,) in db.query(Generation.audio_path)
                    .filter(Generation.project_id == project.id)
                    .all()
                    if audio_path
                ]
            
            db.delete(project)
            db.commit()

            if delete_audio_files:
                for audio_path in audio_paths:
                    ProjectService._delete_generation_audio(audio_path)
            
            logger.info(f"Project {project_id} deleted successfully")
            return True
        
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error deleting project {project_id}: {e}")
            raise

    @staticmethod
    def list_generations(db: Session, project_id: str) -> List[Generation]:
        """List all generations for a project."""
        try:
            return (
                db.query(Generation)
                .filter(Generation.project_id == _as_uuid(project_id))
                .order_by(Generation.created_at.desc())
                .all()
            )
        except SQLAlchemyError as e:
            logger.error(f"Database error listing generations for project {project_id}: {e}")
            return []

    @staticmethod
    def get_generation(db: Session, generation_id: str, project_id: str | None = None) -> Optional[Generation]:
        """Get a generation, optionally scoped to a project."""
        try:
            query = db.query(Generation).filter(Generation.id == _as_uuid(generation_id))
            if project_id is not None:
                query = query.filter(Generation.project_id == _as_uuid(project_id))
            return query.first()
        except SQLAlchemyError as e:
            logger.error(f"Database error getting generation {generation_id}: {e}")
            return None

    @staticmethod
    def delete_generation(db: Session, generation_id: str, project_id: str | None = None) -> bool:
        """Delete a generation and related records."""
        try:
            generation = ProjectService.get_generation(db, generation_id, project_id)
            if not generation:
                return False

            audio_path = generation.audio_path

            db.delete(generation)
            db.commit()
            ProjectService._delete_generation_audio(audio_path)
            return True
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error deleting generation {generation_id}: {e}")
            raise

    @staticmethod
    def filter_generations(
        db: Session,
        user_id: str,
        project_id: str | None = None,
        voice_id: str | None = None,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
        min_duration: float | None = None,
        max_duration: float | None = None,
        search_text: str | None = None,
        sort_by: str = "created_at",
        sort_order: str = "desc",
        skip: int = 0,
        limit: int = 100
    ) -> tuple[List[Generation], int]:
        """
        Filter generations with comprehensive query parameters.
        Returns tuple of (generations list, total count).
        """
        try:
            user_uuid = _as_uuid(user_id)
            
            # Base query - only user's own generations
            query = db.query(Generation).filter(Generation.user_id == user_uuid)
            
            # Apply filters
            if project_id:
                query = query.filter(Generation.project_id == _as_uuid(project_id))
            
            if voice_id:
                query = query.filter(Generation.voice_id == voice_id)
            
            if date_from:
                query = query.filter(Generation.created_at >= date_from)
            
            if date_to:
                query = query.filter(Generation.created_at <= date_to)
            
            if min_duration is not None:
                query = query.filter(Generation.duration_seconds >= min_duration)
            
            if max_duration is not None:
                query = query.filter(Generation.duration_seconds <= max_duration)
            
            if search_text:
                search_pattern = f"%{search_text}%"
                query = query.filter(Generation.text_prompt.ilike(search_pattern))
            
            # Get total count before pagination
            total_count = query.count()
            
            # Apply sorting
            sort_column = getattr(Generation, sort_by, Generation.created_at)
            if sort_order.lower() == "asc":
                query = query.order_by(sort_column.asc())
            else:
                query = query.order_by(sort_column.desc())
            
            # Apply pagination
            query = query.offset(skip).limit(limit)
            
            return query.all(), total_count
            
        except SQLAlchemyError as e:
            logger.error(f"Database error filtering generations for user {user_id}: {e}")
            return [], 0
    
    # ==================== FOLDER OPERATIONS ====================
    
    @staticmethod
    def create_folder(db: Session, project_id: str, name: str, parent_folder_id: str = None) -> ProjectFolder:
        """Create a folder in a project."""
        try:
            logger.info(f"Creating folder '{name}' in project: {project_id}")
            
            folder = ProjectFolder(
                id=uuid.uuid4(),
                project_id=_as_uuid(project_id),
                parent_folder_id=_as_uuid(parent_folder_id),
                name=name,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(folder)
            db.commit()
            
            logger.info(f"Folder created with ID: {folder.id}")
            return folder
        
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error creating folder: {e}")
            raise
    
    @staticmethod
    def get_folders(db: Session, project_id: str) -> List[ProjectFolder]:
        """Get all folders in a project."""
        try:
            return db.query(ProjectFolder).filter(ProjectFolder.project_id == _as_uuid(project_id)).all()
        except SQLAlchemyError as e:
            logger.error(f"Database error getting folders for project {project_id}: {e}")
            return []
    
    @staticmethod
    def delete_folder(db: Session, folder_id: str) -> bool:
        """Delete a folder (and move its audios to project root)."""
        try:
            logger.info(f"Deleting folder: {folder_id}")
            
            folder = db.query(ProjectFolder).filter(ProjectFolder.id == _as_uuid(folder_id)).first()
            if not folder:
                return False
            
            # Move generations to project root
            db.query(Generation).filter(Generation.folder_id == folder_id).update(
                {Generation.folder_id: None}
            )
            
            db.delete(folder)
            db.commit()
            
            logger.info(f"Folder {folder_id} deleted successfully")
            return True
        
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error deleting folder {folder_id}: {e}")
            raise
    
    # ==================== COLLECTION OPERATIONS ====================
    
    @staticmethod
    def create_collection(db: Session, project_id: str, name: str, description: str = None, color: str = "#3b82f6") -> AudioCollection:
        """Create an audio collection."""
        try:
            logger.info(f"Creating collection '{name}' in project: {project_id}")
            
            collection = AudioCollection(
                id=uuid.uuid4(),
                project_id=_as_uuid(project_id),
                name=name,
                description=description,
                color=color,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(collection)
            db.commit()
            
            logger.info(f"Collection created with ID: {collection.id}")
            return collection
        
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error creating collection: {e}")
            raise
    
    @staticmethod
    def get_collections(db: Session, project_id: str) -> List[AudioCollection]:
        """Get all collections in a project."""
        try:
            return db.query(AudioCollection).filter(AudioCollection.project_id == _as_uuid(project_id)).all()
        except SQLAlchemyError as e:
            logger.error(f"Database error getting collections for project {project_id}: {e}")
            return []
    
    @staticmethod
    def add_to_collection(db: Session, generation_id: str, collection_id: str) -> bool:
        """Add a generation to a collection."""
        try:
            logger.info(f"Adding generation {generation_id} to collection {collection_id}")
            
            stmt = generation_collections.insert().values(
                id=uuid.uuid4(),
                generation_id=_as_uuid(generation_id),
                collection_id=_as_uuid(collection_id),
                created_at=datetime.utcnow()
            )
            db.execute(stmt)
            db.commit()
            
            logger.info(f"Generation added to collection successfully")
            return True
        
        except IntegrityError as e:
            db.rollback()
            logger.warning(f"Integrity error adding to collection (may already exist): {e}")
            return False
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error adding to collection: {e}")
            return False
    
    @staticmethod
    def remove_from_collection(db: Session, generation_id: str, collection_id: str) -> bool:
        """Remove a generation from a collection."""
        try:
            logger.info(f"Removing generation {generation_id} from collection {collection_id}")
            
            stmt = generation_collections.delete().where(
                and_(
                    generation_collections.c.generation_id == _as_uuid(generation_id),
                        generation_collections.c.collection_id == _as_uuid(collection_id)
                )
            )
            db.execute(stmt)
            db.commit()
            
            logger.info(f"Generation removed from collection successfully")
            return True
        
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error removing from collection: {e}")
            raise
    
    @staticmethod
    def delete_collection(db: Session, collection_id: str) -> bool:
        """Delete a collection."""
        try:
            logger.info(f"Deleting collection: {collection_id}")
            
            collection = db.query(AudioCollection).filter(AudioCollection.id == _as_uuid(collection_id)).first()
            if not collection:
                return False
            
            db.delete(collection)
            db.commit()
            
            logger.info(f"Collection {collection_id} deleted successfully")
            return True
        
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error deleting collection {collection_id}: {e}")
            raise
    
    # ==================== TAG OPERATIONS ====================
    
    @staticmethod
    def create_tag(db: Session, project_id: str, name: str, color: str = "#10b981") -> AudioTag:
        """Create a tag."""
        try:
            logger.info(f"Creating tag '{name}' in project: {project_id}")
            
            tag = AudioTag(
                id=uuid.uuid4(),
                project_id=_as_uuid(project_id),
                name=name,
                color=color,
                created_at=datetime.utcnow()
            )
            db.add(tag)
            db.commit()
            
            logger.info(f"Tag created with ID: {tag.id}")
            return tag
        
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error creating tag: {e}")
            raise
    
    @staticmethod
    def get_tags(db: Session, project_id: str) -> List[AudioTag]:
        """Get all tags in a project."""
        try:
            return db.query(AudioTag).filter(AudioTag.project_id == _as_uuid(project_id)).all()
        except SQLAlchemyError as e:
            logger.error(f"Database error getting tags for project {project_id}: {e}")
            return []
    
    @staticmethod
    def tag_generation(db: Session, generation_id: str, tag_id: str) -> bool:
        """Add a tag to a generation."""
        try:
            logger.info(f"Tagging generation {generation_id} with tag {tag_id}")
            
            stmt = generation_tags.insert().values(
                id=uuid.uuid4(),
                generation_id=_as_uuid(generation_id),
                tag_id=_as_uuid(tag_id),
                created_at=datetime.utcnow()
            )
            db.execute(stmt)
            db.commit()
            
            logger.info(f"Generation tagged successfully")
            return True
        
        except IntegrityError as e:
            db.rollback()
            logger.warning(f"Integrity error tagging generation (may already exist): {e}")
            return False
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error tagging generation: {e}")
            return False
    
    @staticmethod
    def remove_tag(db: Session, generation_id: str, tag_id: str) -> bool:
        """Remove a tag from a generation."""
        try:
            logger.info(f"Removing tag {tag_id} from generation {generation_id}")
            
            stmt = generation_tags.delete().where(
                and_(
                    generation_tags.c.generation_id == _as_uuid(generation_id),
                    generation_tags.c.tag_id == _as_uuid(tag_id)
                )
            )
            db.execute(stmt)
            db.commit()
            
            logger.info(f"Tag removed successfully")
            return True
        
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error removing tag: {e}")
            raise
    
    @staticmethod
    def delete_tag(db: Session, tag_id: str) -> bool:
        """Delete a tag."""
        try:
            logger.info(f"Deleting tag: {tag_id}")
            
            tag = db.query(AudioTag).filter(AudioTag.id == _as_uuid(tag_id)).first()
            if not tag:
                return False
            
            db.delete(tag)
            db.commit()
            
            logger.info(f"Tag {tag_id} deleted successfully")
            return True
        
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error deleting tag {tag_id}: {e}")
            raise
    
    # ==================== SHARING OPERATIONS ====================
    
    @staticmethod
    def share_project(db: Session, project_id: str, shared_with_user_id: str, permission: str = "viewer") -> ProjectShare:
        """Share a project with another user."""
        try:
            logger.info(f"Sharing project {project_id} with user {shared_with_user_id} - permission: {permission}")
            
            share = ProjectShare(
                id=uuid.uuid4(),
                project_id=_as_uuid(project_id),
                shared_with_user_id=_as_uuid(shared_with_user_id),
                permission=permission,
                created_at=datetime.utcnow()
            )
            db.add(share)
            db.commit()
            
            logger.info(f"Project shared successfully with ID: {share.id}")
            return share
        
        except IntegrityError as e:
            db.rollback()
            logger.warning(f"Integrity error sharing project (may already be shared): {e}")
            raise
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error sharing project: {e}")
            raise
    
    @staticmethod
    def get_shares(db: Session, project_id: str) -> List[ProjectShare]:
        """Get all shares for a project."""
        try:
            return db.query(ProjectShare).filter(ProjectShare.project_id == _as_uuid(project_id)).all()
        except SQLAlchemyError as e:
            logger.error(f"Database error getting shares for project {project_id}: {e}")
            return []
    
    @staticmethod
    def update_share_permission(db: Session, share_id: str, permission: str) -> bool:
        """Update share permission."""
        try:
            logger.info(f"Updating share {share_id} permission to: {permission}")
            
            share = db.query(ProjectShare).filter(ProjectShare.id == _as_uuid(share_id)).first()
            if not share:
                return False
            
            share.permission = permission
            db.commit()
            
            logger.info(f"Share permission updated successfully")
            return True
        
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error updating share permission: {e}")
            raise
    
    @staticmethod
    def revoke_share(db: Session, share_id: str) -> bool:
        """Remove a project share."""
        try:
            logger.info(f"Revoking share: {share_id}")
            
            share = db.query(ProjectShare).filter(ProjectShare.id == _as_uuid(share_id)).first()
            if not share:
                return False
            
            db.delete(share)
            db.commit()
            
            logger.info(f"Share revoked successfully")
            return True
        
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error revoking share: {e}")
            raise
    
    # ==================== DRAFT OPERATIONS ====================
    
    @staticmethod
    def save_draft(db: Session, project_id: str, text_prompt: str, voice_id: str, 
                   speed: float = 1.0, pitch: float = 1.0, generation_id: str = None) -> GenerationDraft:
        """Save a generation draft."""
        try:
            logger.info(f"Saving draft for project: {project_id}")
            
            draft = GenerationDraft(
                id=uuid.uuid4(),
                project_id=_as_uuid(project_id),
                generation_id=_as_uuid(generation_id),
                text_prompt=text_prompt,
                voice_id=voice_id,
                speed=speed,
                pitch=pitch,
                saved_at=datetime.utcnow()
            )
            db.add(draft)
            db.commit()
            
            logger.info(f"Draft saved with ID: {draft.id}")
            return draft
        
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error saving draft: {e}")
            raise
    
    @staticmethod
    def get_drafts(db: Session, project_id: str) -> List[GenerationDraft]:
        """Get all drafts for a project."""
        try:
            return db.query(GenerationDraft).filter(GenerationDraft.project_id == _as_uuid(project_id)).all()
        except SQLAlchemyError as e:
            logger.error(f"Database error getting drafts for project {project_id}: {e}")
            return []
    
    @staticmethod
    def delete_draft(db: Session, draft_id: str) -> bool:
        """Delete a draft."""
        try:
            logger.info(f"Deleting draft: {draft_id}")
            
            draft = db.query(GenerationDraft).filter(GenerationDraft.id == _as_uuid(draft_id)).first()
            if not draft:
                return False
            
            db.delete(draft)
            db.commit()
            
            logger.info(f"Draft {draft_id} deleted successfully")
            return True
        
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error deleting draft {draft_id}: {e}")
            raise
    
    # ==================== ANALYTICS OPERATIONS ====================
    
    @staticmethod
    def get_project_analytics(db: Session, project_id: str) -> Optional[Dict[str, Any]]:
        """Get analytics for a project."""
        try:
            analytics = db.query(ProjectAnalytics).filter(ProjectAnalytics.project_id == _as_uuid(project_id)).first()
            if not analytics:
                return None
            
            generations = db.query(Generation).filter(Generation.project_id == project_id).all()
            total_duration = sum([g.duration_seconds or 0 for g in generations])
            total_chars = sum([len(g.text) for g in generations])
            
            return {
                "project_id": project_id,
                "total_generations": len(generations),
                "total_duration_seconds": total_duration,
                "total_characters": total_chars,
                "last_modified": analytics.last_modified.isoformat()
            }
        except SQLAlchemyError as e:
            logger.error(f"Database error getting analytics for project {project_id}: {e}")
            return None
    
    @staticmethod
    def record_generation(db: Session, project_id: str, generation_id: str, text_length: int, duration: float) -> bool:
        """Record a new generation for analytics."""
        try:
            logger.info(f"Recording generation {generation_id} - text_length: {text_length}, duration: {duration}s")
            
            generation = db.query(Generation).filter(Generation.id == _as_uuid(generation_id)).first()
            if generation:
                generation.updated_at = datetime.utcnow()
            
            analytics = db.query(ProjectAnalytics).filter(ProjectAnalytics.project_id == _as_uuid(project_id)).first()
            if analytics:
                analytics.total_generations += 1
                analytics.total_characters += text_length
                analytics.total_duration_seconds += duration
                analytics.last_modified = datetime.utcnow()
            
            db.commit()
            logger.info(f"Generation recorded successfully")
            return True
        
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error recording generation: {e}")
            raise
    
    # ==================== HISTORY OPERATIONS ====================
    
    @staticmethod
    def record_history(db: Session, generation_id: str, change_type: str, previous_values: dict = None) -> GenerationHistory:
        """Record a generation history entry."""
        try:
            logger.info(f"Recording history for generation {generation_id} - change_type: {change_type}")
            
            generation = db.query(Generation).filter(Generation.id == _as_uuid(generation_id)).first()
            if not generation:
                return None
            
            version_number = db.query(func.max(GenerationHistory.version_number)).filter(
                GenerationHistory.generation_id == _as_uuid(generation_id)
            ).scalar() or 0
            
            history = GenerationHistory(
                id=uuid.uuid4(),
                generation_id=_as_uuid(generation_id),
                version_number=version_number + 1,
                change_type=change_type,
                previous_values=json.dumps(previous_values) if previous_values else None,
                created_at=datetime.utcnow()
            )
            db.add(history)
            db.commit()
            
            logger.info(f"History recorded with version: {history.version_number}")
            return history
        
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error recording history: {e}")
            raise
    
    @staticmethod
    def get_generation_history(db: Session, generation_id: str) -> List[GenerationHistory]:
        """Get all history for a generation."""
        try:
            return db.query(GenerationHistory).filter(
                GenerationHistory.generation_id == _as_uuid(generation_id)
            ).order_by(GenerationHistory.version_number).all()
        except SQLAlchemyError as e:
            logger.error(f"Database error getting history for generation {generation_id}: {e}")
            return []
    
    # ==================== BULK OPERATIONS ====================
    
    @staticmethod
    def bulk_delete_generations(db: Session, generation_ids: List[str]) -> int:
        """Delete multiple generations at once."""
        try:
            logger.info(f"Bulk deleting {len(generation_ids)} generations")
            
            count = db.query(Generation).filter(Generation.id.in_([_as_uuid(gid) for gid in generation_ids])).delete()
            db.commit()
            
            logger.info(f"Successfully deleted {count} generations")
            return count
        
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error bulk deleting generations: {e}")
            raise
    
    @staticmethod
    def bulk_tag_generations(db: Session, generation_ids: List[str], tag_id: str) -> int:
        """Tag multiple generations at once."""
        try:
            logger.info(f"Bulk tagging {len(generation_ids)} generations with tag {tag_id}")
            
            count = 0
            for gen_id in generation_ids:
                if ProjectService.tag_generation(db, gen_id, tag_id):
                    count += 1
            
            logger.info(f"Successfully tagged {count} generations")
            return count
        
        except Exception as e:
            logger.error(f"Error bulk tagging generations: {e}")
            raise
    
    @staticmethod
    def bulk_add_to_collection(db: Session, generation_ids: List[str], collection_id: str) -> int:
        """Add multiple generations to a collection."""
        try:
            logger.info(f"Bulk adding {len(generation_ids)} generations to collection {collection_id}")
            
            count = 0
            for gen_id in generation_ids:
                if ProjectService.add_to_collection(db, gen_id, collection_id):
                    count += 1
            
            logger.info(f"Successfully added {count} generations to collection")
            return count
        
        except Exception as e:
            logger.error(f"Error bulk adding to collection: {e}")
            raise
    
    @staticmethod
    def bulk_move_to_folder(db: Session, generation_ids: List[str], folder_id: str) -> int:
        """Move multiple generations to a folder."""
        try:
            logger.info(f"Bulk moving {len(generation_ids)} generations to folder {folder_id}")
            
            db.query(Generation).filter(Generation.id.in_(generation_ids)).update(
                {Generation.folder_id: folder_id}
            )
            db.commit()
            
            logger.info(f"Successfully moved {len(generation_ids)} generations")
            return len(generation_ids)
        
        except SQLAlchemyError as e:
            db.rollback()
            logger.error(f"Database error bulk moving generations: {e}")
            raise

