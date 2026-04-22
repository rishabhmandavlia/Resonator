from sqlalchemy import Column, String, DateTime, Text, Float, Integer, Boolean, ForeignKey, func, Table, Enum, UniqueConstraint, UUID
from sqlalchemy.orm import relationship, declarative_base
from datetime import datetime
import uuid

# Initialize Base
Base = declarative_base()


# ==================== USER MODEL ====================
class User(Base):
    """User model for authentication and project ownership."""
    __tablename__ = "users"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    username = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    is_admin = Column(Boolean, nullable=False, default=False)
    is_verified = Column(Boolean, nullable=False, default=False)
    is_email_verified = Column(Boolean, nullable=False, default=False, index=True)
    has_email_auth = Column(Boolean, nullable=False, default=False, index=True)
    last_login = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    projects = relationship("Project", back_populates="user", cascade="all, delete-orphan")
    generations = relationship("Generation", back_populates="user", cascade="all, delete-orphan")
    oauth_identities = relationship("OAuthIdentity", back_populates="user", cascade="all, delete-orphan")
    session_accounts = relationship("SessionAccount", back_populates="user")
    pending_email_changes = relationship(
        "PendingEmailChange",
        back_populates="user",
        cascade="all, delete-orphan",
    )


class PendingEmailVerification(Base):
    """Temporary registration state pending email OTP verification."""
    __tablename__ = "pending_email_verifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), nullable=False, unique=True, index=True)
    password_hash = Column(String(255), nullable=False)
    otp_hash = Column(String(255), nullable=False)
    otp_expires_at = Column(DateTime, nullable=False, index=True)
    failed_attempts = Column(Integer, nullable=False, default=0)
    resend_count = Column(Integer, nullable=False, default=0)
    resend_available_at = Column(DateTime, nullable=False)
    last_sent_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class PendingOAuthLink(Base):
    """Temporary OAuth login state waiting for OTP-based email verification."""
    __tablename__ = "pending_oauth_links"
    __table_args__ = (
        UniqueConstraint("provider", "provider_subject", name="uq_pending_oauth_link_provider_subject"),
        UniqueConstraint("email", name="uq_pending_oauth_link_email"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("auth_sessions.id"), nullable=False, index=True)
    provider = Column(String(50), nullable=False, index=True)
    provider_subject = Column(String(255), nullable=False, index=True)
    email = Column(String(255), nullable=False, index=True)
    display_name = Column(String(255), nullable=True)
    avatar_url = Column(String(500), nullable=True)
    access_token_encrypted = Column(Text, nullable=False)
    refresh_token_encrypted = Column(Text, nullable=True)
    id_token_encrypted = Column(Text, nullable=True)
    expires_at = Column(DateTime, nullable=True, index=True)
    token_type = Column(String(50), nullable=False, default="Bearer")
    scopes_json = Column(Text, nullable=True)
    otp_hash = Column(String(255), nullable=False)
    otp_expires_at = Column(DateTime, nullable=False, index=True)
    failed_attempts = Column(Integer, nullable=False, default=0)
    resend_count = Column(Integer, nullable=False, default=0)
    resend_available_at = Column(DateTime, nullable=False)
    last_sent_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    session = relationship("AuthSession", back_populates="pending_oauth_links")


class PendingEmailChange(Base):
    """Temporary email change state waiting for OTP-based verification."""
    __tablename__ = "pending_email_changes"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_pending_email_change_user"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    new_email = Column(String(255), nullable=False, index=True)
    otp_hash = Column(String(255), nullable=False)
    otp_expires_at = Column(DateTime, nullable=False, index=True)
    failed_attempts = Column(Integer, nullable=False, default=0)
    resend_count = Column(Integer, nullable=False, default=0)
    resend_available_at = Column(DateTime, nullable=False)
    last_sent_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="pending_email_changes")


class AuthSession(Base):
    """Browser session that can contain multiple logged-in OAuth accounts."""
    __tablename__ = "auth_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    active_account_id = Column(UUID(as_uuid=True), ForeignKey("session_accounts.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_seen_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    user_agent = Column(String(500), nullable=True)
    ip_address = Column(String(100), nullable=True)

    accounts = relationship(
        "SessionAccount",
        back_populates="session",
        cascade="all, delete-orphan",
        foreign_keys="SessionAccount.session_id",
    )
    active_account = relationship("SessionAccount", foreign_keys=[active_account_id], post_update=True)
    oauth_states = relationship(
        "OAuthAuthorizationState",
        back_populates="session",
        cascade="all, delete-orphan",
    )
    pending_oauth_links = relationship(
        "PendingOAuthLink",
        back_populates="session",
        cascade="all, delete-orphan",
    )


class OAuthIdentity(Base):
    """External OAuth identity linked to an application user."""
    __tablename__ = "oauth_identities"
    __table_args__ = (
        UniqueConstraint("provider", "provider_subject", name="uq_oauth_identity_provider_subject"),
        UniqueConstraint("user_id", "provider", name="uq_oauth_identity_user_provider"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    provider = Column(String(50), nullable=False, index=True)
    provider_subject = Column(String(255), nullable=False, index=True)
    email = Column(String(255), nullable=True, index=True)
    email_verified = Column(Boolean, nullable=False, default=False, index=True)
    display_name = Column(String(255), nullable=True)
    avatar_url = Column(String(500), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True, index=True)

    user = relationship("User", back_populates="oauth_identities")
    session_accounts = relationship("SessionAccount", back_populates="identity")


class SessionAccount(Base):
    """An authenticated OAuth account stored within a browser session."""
    __tablename__ = "session_accounts"
    __table_args__ = (
        UniqueConstraint("session_id", "provider", "provider_subject", name="uq_session_account_provider_subject"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("auth_sessions.id"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    identity_id = Column(UUID(as_uuid=True), ForeignKey("oauth_identities.id"), nullable=True, index=True)
    provider = Column(String(50), nullable=False, index=True)
    provider_subject = Column(String(255), nullable=False, index=True)
    email = Column(String(255), nullable=True, index=True)
    display_name = Column(String(255), nullable=True)
    avatar_url = Column(String(500), nullable=True)
    access_token_encrypted = Column(Text, nullable=False)
    refresh_token_encrypted = Column(Text, nullable=True)
    id_token_encrypted = Column(Text, nullable=True)
    expires_at = Column(DateTime, nullable=True, index=True)
    token_type = Column(String(50), nullable=False, default="Bearer")
    scopes_json = Column(Text, nullable=True)
    is_valid = Column(Boolean, nullable=False, default=True, index=True)
    invalid_reason = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_used_at = Column(DateTime, nullable=True, index=True)

    session = relationship("AuthSession", back_populates="accounts", foreign_keys=[session_id])
    user = relationship("User", back_populates="session_accounts")
    identity = relationship("OAuthIdentity", back_populates="session_accounts")


class OAuthAuthorizationState(Base):
    """Pending OAuth authorization request state for PKCE and CSRF validation."""
    __tablename__ = "oauth_authorization_states"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("auth_sessions.id"), nullable=False, index=True)
    provider = Column(String(50), nullable=False, index=True)
    state = Column(String(255), nullable=False, unique=True, index=True)
    nonce = Column(String(255), nullable=True)
    code_verifier = Column(String(255), nullable=False)
    prompt = Column(String(255), nullable=True)
    link_user_id = Column(String(36), nullable=True, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    expires_at = Column(DateTime, nullable=False, index=True)

    session = relationship("AuthSession", back_populates="oauth_states")


# ==================== VOICE MODEL ====================
class Voice(Base):
    """Voice model for TTS voice definitions."""
    __tablename__ = "voices"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False, index=True)
    language = Column(String(10), nullable=False, index=True)
    gender = Column(String(20), nullable=False)
    model_type = Column(String(50), nullable=False, default="kokoro")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    
# Existing Project model (updated)
class Project(Base):
    __tablename__ = "projects"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    is_system = Column(Boolean, nullable=False, default=False, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    
    # Relationships
    user = relationship("User", back_populates="projects")
    folders = relationship("ProjectFolder", back_populates="project", cascade="all, delete-orphan")
    collections = relationship("AudioCollection", back_populates="project", cascade="all, delete-orphan")
    tags = relationship("AudioTag", back_populates="project", cascade="all, delete-orphan")
    shares = relationship("ProjectShare", back_populates="project", cascade="all, delete-orphan")
    drafts = relationship("GenerationDraft", back_populates="project", cascade="all, delete-orphan")
    analytics = relationship("ProjectAnalytics", back_populates="project", uselist=False, cascade="all, delete-orphan")
    generations = relationship("Generation", back_populates="project", cascade="all, delete-orphan")

    @property
    def updated_at(self):
        return self.created_at


# Existing Generation model (updated with new columns)
class Generation(Base):
    __tablename__ = "generations"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    voice_id = Column(String(100), nullable=True, index=True)
    text_prompt = Column(Text, nullable=False)
    speed = Column(Float, nullable=False, default=1.0)
    pitch = Column(Float, nullable=False, default=1.0)
    duration_seconds = Column(Float, nullable=False, default=0.0, index=True)
    audio_path = Column(String(500), nullable=False)
    file_format = Column(String(20), nullable=False, default="wav")
    title = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    
    # Relationships
    project = relationship("Project", back_populates="generations")
    user = relationship("User", back_populates="generations")
    collections = relationship("AudioCollection", secondary="generation_collections", back_populates="generations")
    tags = relationship("AudioTag", secondary="generation_tags", back_populates="generations")
    history = relationship("GenerationHistory", back_populates="generation", cascade="all, delete-orphan")
    drafts = relationship("GenerationDraft", back_populates="generation", cascade="all, delete-orphan")

    @property
    def text(self):
        return self.text_prompt

    @property
    def audio_file_path(self):
        return self.audio_path

    @property
    def folder_id(self):
        return None

    @property
    def updated_at(self):
        return self.created_at


# NEW: Project Folders (hierarchical organization)
class ProjectFolder(Base):
    __tablename__ = "project_folders"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    parent_folder_id = Column(UUID(as_uuid=True), ForeignKey("project_folders.id"), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    project = relationship("Project", back_populates="folders")
    parent = relationship("ProjectFolder", remote_side=[id])


# NEW: Audio Collections
class AudioCollection(Base):
    __tablename__ = "audio_collections"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    color = Column(String(7), nullable=False, default="#3b82f6")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    project = relationship("Project", back_populates="collections")
    generations = relationship("Generation", secondary="generation_collections", back_populates="collections")


# NEW: Generation-Collection junction table
generation_collections = Table(
    "generation_collections",
    Base.metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
    Column("generation_id", UUID(as_uuid=True), ForeignKey("generations.id"), nullable=False),
    Column("collection_id", UUID(as_uuid=True), ForeignKey("audio_collections.id"), nullable=False),
    Column("created_at", DateTime, nullable=False, default=datetime.utcnow),
)


# NEW: Audio Tags
class AudioTag(Base):
    __tablename__ = "audio_tags"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    color = Column(String(7), nullable=False, default="#10b981")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    
    # Relationships
    project = relationship("Project", back_populates="tags")
    generations = relationship("Generation", secondary="generation_tags", back_populates="tags")


# NEW: Generation-Tag junction table
generation_tags = Table(
    "generation_tags",
    Base.metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
    Column("generation_id", UUID(as_uuid=True), ForeignKey("generations.id"), nullable=False),
    Column("tag_id", UUID(as_uuid=True), ForeignKey("audio_tags.id"), nullable=False),
    Column("created_at", DateTime, nullable=False, default=datetime.utcnow),
)


# NEW: Project Templates
class ProjectTemplate(Base):
    __tablename__ = "project_templates"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    settings = Column(Text, nullable=True)  # JSON stored as string
    is_public = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    
    # Relationships
    user = relationship("User")


# NEW: Project Sharing (collaboration)
class ProjectShare(Base):
    __tablename__ = "project_shares"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    shared_with_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    permission = Column(String(20), nullable=False, default="viewer")  # viewer, editor, admin
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint('project_id', 'shared_with_user_id', name='unique_project_share'),
    )
    
    # Relationships
    project = relationship("Project", back_populates="shares")
    shared_with_user = relationship("User")


# NEW: Generation Drafts (auto-save)
class GenerationDraft(Base):
    __tablename__ = "generation_drafts"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    generation_id = Column(UUID(as_uuid=True), ForeignKey("generations.id"), nullable=True, index=True)
    text_prompt = Column(Text, nullable=False)
    voice_id = Column(String(100), nullable=True, index=True)
    speed = Column(Float, nullable=False, default=1.0)
    pitch = Column(Float, nullable=False, default=1.0)
    saved_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    
    # Relationships
    project = relationship("Project", back_populates="drafts")
    generation = relationship("Generation", back_populates="drafts")


# NEW: Project Analytics
class ProjectAnalytics(Base):
    __tablename__ = "project_analytics"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, unique=True, index=True)
    total_generations = Column(Integer, nullable=False, default=0)
    total_duration_seconds = Column(Float, nullable=False, default=0.0)
    total_characters = Column(Integer, nullable=False, default=0)
    last_modified = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    project = relationship("Project", back_populates="analytics")


# NEW: Generation History (version tracking)
class GenerationHistory(Base):
    __tablename__ = "generation_history"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    generation_id = Column(UUID(as_uuid=True), ForeignKey("generations.id"), nullable=False, index=True)
    version_number = Column(Integer, nullable=False)
    change_type = Column(String(50), nullable=False)  # created, modified, regenerated
    previous_values = Column(Text, nullable=True)  # JSON as string
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    
    # Relationships
    generation = relationship("Generation", back_populates="history")
