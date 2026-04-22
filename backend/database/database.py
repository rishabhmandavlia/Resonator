"""
Database configuration and session management.
"""

from datetime import datetime

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.engine import Engine
from typing import Generator
import os
import logging

from database.models import (
    AuthSession,
    Base,
    Generation,
    OAuthAuthorizationState,
    OAuthIdentity,
    PendingOAuthLink,
    Project,
    ProjectShare,
    ProjectTemplate,
    SessionAccount,
    User,
)

logger = logging.getLogger(__name__)
REMOVED_OAUTH_PROVIDERS = ("github",)

# Get database URL from environment or use default SQLite for development
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite:///./ai_voice_db.db"
)

# Create engine
engine = create_engine(
    DATABASE_URL,
    echo=os.getenv("DATABASE_ECHO", "false").lower() == "true",
    max_overflow=20,
    pool_size=10,
    pool_pre_ping=True,  # Verify connections before using
)

# Enable foreign keys for SQLite
@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_conn, connection_record):
    """Enable foreign key constraints for SQLite."""
    if "sqlite" in DATABASE_URL:
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

# Create session factory
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    expire_on_commit=False
)


def _normalize_email_value(email: str | None) -> str | None:
    if not email:
        return None
    return email.strip().lower()


def _is_placeholder_oauth_email(email: str | None) -> bool:
    return bool(email and email.endswith("@oauth.local"))


def _is_trusted_identity_email(identity: OAuthIdentity) -> bool:
    if not identity.email:
        return False
    return bool(identity.email_verified or identity.provider in {"google"})


def _merge_user_records(db: Session, primary_user: User, duplicate_user: User) -> None:
    if primary_user.id == duplicate_user.id:
        return

    primary_email = _normalize_email_value(primary_user.email)
    duplicate_email = _normalize_email_value(duplicate_user.email)
    if _is_placeholder_oauth_email(primary_email) and duplicate_email and not _is_placeholder_oauth_email(duplicate_email):
        primary_user.email = duplicate_email

    if duplicate_user.has_email_auth and not primary_user.has_email_auth:
        primary_user.password_hash = duplicate_user.password_hash
        primary_user.has_email_auth = True

    primary_user.is_active = primary_user.is_active or duplicate_user.is_active
    primary_user.is_admin = primary_user.is_admin or duplicate_user.is_admin
    primary_user.is_verified = primary_user.is_verified or duplicate_user.is_verified
    primary_user.is_email_verified = primary_user.is_email_verified or duplicate_user.is_email_verified

    if not primary_user.username and duplicate_user.username:
        primary_user.username = duplicate_user.username

    if duplicate_user.last_login and (
        primary_user.last_login is None or duplicate_user.last_login > primary_user.last_login
    ):
        primary_user.last_login = duplicate_user.last_login

    duplicate_identities = (
        db.query(OAuthIdentity)
        .filter(OAuthIdentity.user_id == duplicate_user.id)
        .all()
    )
    for identity in duplicate_identities:
        existing_identity = (
            db.query(OAuthIdentity)
            .filter(
                OAuthIdentity.user_id == primary_user.id,
                OAuthIdentity.provider == identity.provider,
            )
            .first()
        )

        if existing_identity:
            existing_identity.email = existing_identity.email or identity.email
            existing_identity.email_verified = existing_identity.email_verified or identity.email_verified
            existing_identity.display_name = existing_identity.display_name or identity.display_name
            existing_identity.avatar_url = existing_identity.avatar_url or identity.avatar_url
            if identity.last_login_at and (
                existing_identity.last_login_at is None
                or identity.last_login_at > existing_identity.last_login_at
            ):
                existing_identity.last_login_at = identity.last_login_at

            for session_account in (
                db.query(SessionAccount)
                .filter(SessionAccount.identity_id == identity.id)
                .all()
            ):
                session_account.identity_id = existing_identity.id
                session_account.user_id = primary_user.id
                session_account.email = session_account.email or existing_identity.email or primary_user.email

            db.delete(identity)
            continue

        identity.user_id = primary_user.id

    db.query(Project).filter(Project.user_id == duplicate_user.id).update(
        {Project.user_id: primary_user.id},
        synchronize_session=False,
    )
    db.query(Generation).filter(Generation.user_id == duplicate_user.id).update(
        {Generation.user_id: primary_user.id},
        synchronize_session=False,
    )
    db.query(ProjectTemplate).filter(ProjectTemplate.user_id == duplicate_user.id).update(
        {ProjectTemplate.user_id: primary_user.id},
        synchronize_session=False,
    )

    existing_share_project_ids = {
        str(share.project_id)
        for share in db.query(ProjectShare).filter(ProjectShare.shared_with_user_id == primary_user.id).all()
    }
    duplicate_shares = (
        db.query(ProjectShare)
        .filter(ProjectShare.shared_with_user_id == duplicate_user.id)
        .all()
    )
    for share in duplicate_shares:
        project_key = str(share.project_id)
        if project_key in existing_share_project_ids:
            db.delete(share)
            continue
        share.shared_with_user_id = primary_user.id
        existing_share_project_ids.add(project_key)

    for session_account in (
        db.query(SessionAccount)
        .filter(SessionAccount.user_id == duplicate_user.id)
        .all()
    ):
        session_account.user_id = primary_user.id
        session_account.email = session_account.email or primary_user.email

    primary_user.updated_at = datetime.utcnow()
    db.flush()
    db.delete(duplicate_user)
    db.flush()


def repair_auth_duplicates() -> None:
    """Normalize auth records without merging users solely because emails match."""
    try:
        with SessionLocal() as db:
            users = db.query(User).order_by(User.created_at.asc(), User.id.asc()).all()

            for user in users:
                normalized_email = _normalize_email_value(user.email)
                if normalized_email and user.email != normalized_email:
                    user.email = normalized_email

            identities = (
                db.query(OAuthIdentity)
                .filter(OAuthIdentity.email.isnot(None))
                .order_by(OAuthIdentity.created_at.asc(), OAuthIdentity.id.asc())
                .all()
            )
            for identity in identities:
                normalized_email = _normalize_email_value(identity.email)
                if normalized_email and identity.email != normalized_email:
                    identity.email = normalized_email

            users = db.query(User).all()
            for user in users:
                if user.has_email_auth:
                    continue

                identity_count = (
                    db.query(OAuthIdentity)
                    .filter(OAuthIdentity.user_id == user.id)
                    .count()
                )
                has_email_session = (
                    db.query(SessionAccount)
                    .filter(
                        SessionAccount.user_id == user.id,
                        SessionAccount.provider == "email",
                    )
                    .count()
                    > 0
                )
                if has_email_session or (identity_count == 0 and user.is_email_verified and bool(user.password_hash)):
                    user.has_email_auth = True

            db.commit()
    except Exception as exc:
        logger.warning("Auth duplicate repair warning: %s", exc)


def purge_removed_oauth_provider_data() -> None:
    """Remove persisted auth records for OAuth providers that are no longer supported."""
    if not REMOVED_OAUTH_PROVIDERS:
        return

    try:
        with SessionLocal() as db:
            removed_provider_names = tuple(REMOVED_OAUTH_PROVIDERS)
            removed_session_accounts = (
                db.query(SessionAccount)
                .filter(SessionAccount.provider.in_(removed_provider_names))
                .all()
            )
            removed_account_ids = {account.id for account in removed_session_accounts}
            affected_session_ids = {account.session_id for account in removed_session_accounts}

            removed_identity_count = (
                db.query(OAuthIdentity)
                .filter(OAuthIdentity.provider.in_(removed_provider_names))
                .count()
            )
            removed_pending_link_count = (
                db.query(PendingOAuthLink)
                .filter(PendingOAuthLink.provider.in_(removed_provider_names))
                .count()
            )
            removed_auth_state_count = (
                db.query(OAuthAuthorizationState)
                .filter(OAuthAuthorizationState.provider.in_(removed_provider_names))
                .count()
            )

            if (
                not removed_account_ids
                and removed_identity_count == 0
                and removed_pending_link_count == 0
                and removed_auth_state_count == 0
            ):
                return

            deleted_session_count = 0
            repointed_session_count = 0

            if affected_session_ids:
                affected_sessions = (
                    db.query(AuthSession)
                    .filter(AuthSession.id.in_(tuple(affected_session_ids)))
                    .all()
                )
                for session in affected_sessions:
                    remaining_accounts = [
                        account
                        for account in session.accounts
                        if account.id not in removed_account_ids
                        and account.provider not in removed_provider_names
                    ]

                    if not remaining_accounts:
                        db.delete(session)
                        deleted_session_count += 1
                        continue

                    preferred_account = next(
                        (account for account in remaining_accounts if account.is_valid),
                        remaining_accounts[0],
                    )
                    if session.active_account_id != preferred_account.id:
                        session.active_account_id = preferred_account.id
                        repointed_session_count += 1
                    session.updated_at = datetime.utcnow()

                db.flush()

            removed_session_account_count = (
                db.query(SessionAccount)
                .filter(SessionAccount.provider.in_(removed_provider_names))
                .delete(synchronize_session=False)
            )
            db.query(PendingOAuthLink).filter(
                PendingOAuthLink.provider.in_(removed_provider_names)
            ).delete(synchronize_session=False)
            db.query(OAuthAuthorizationState).filter(
                OAuthAuthorizationState.provider.in_(removed_provider_names)
            ).delete(synchronize_session=False)
            db.query(OAuthIdentity).filter(
                OAuthIdentity.provider.in_(removed_provider_names)
            ).delete(synchronize_session=False)
            db.commit()

            logger.info(
                "Purged legacy OAuth provider data for %s: %s session accounts, %s identities, %s pending links, %s auth states, %s sessions deleted, %s sessions repointed",
                ", ".join(removed_provider_names),
                removed_session_account_count,
                removed_identity_count,
                removed_pending_link_count,
                removed_auth_state_count,
                deleted_session_count,
                repointed_session_count,
            )
    except Exception as exc:
        logger.warning("Removed OAuth provider cleanup warning: %s", exc)


def get_db() -> Generator[Session, None, None]:
    """
    Dependency for getting database session in routes.
    Usage: db: Session = Depends(get_db)
    """
    db = SessionLocal()
    try:
        yield db
    except Exception as e:
        db.rollback()
        logger.error(f"Database session error: {e}")
        raise
    finally:
        db.close()


def repair_schema() -> None:
    """Apply targeted schema repairs for known model drift in existing databases."""
    try:
        inspector = inspect(engine)

        def ensure_boolean_column(table_name: str, column_name: str, default_sql: str) -> None:
            if not inspector.has_table(table_name):
                return

            columns = {
                column["name"]: column
                for column in inspector.get_columns(table_name)
            }
            if column_name in columns:
                return

            if engine.dialect.name == "postgresql":
                statement = (
                    f"ALTER TABLE {table_name} "
                    f"ADD COLUMN IF NOT EXISTS {column_name} BOOLEAN NOT NULL DEFAULT {default_sql}"
                )
            else:
                statement = (
                    f"ALTER TABLE {table_name} "
                    f"ADD COLUMN {column_name} BOOLEAN NOT NULL DEFAULT {default_sql}"
                )

            with engine.begin() as connection:
                connection.execute(text(statement))

            logger.info("Added missing %s.%s boolean column", table_name, column_name)

        def ensure_string_column(
            table_name: str,
            column_name: str,
            length: int,
        ) -> None:
            if not inspector.has_table(table_name):
                return

            columns = {
                column["name"]: column
                for column in inspector.get_columns(table_name)
            }
            if column_name in columns:
                return

            if engine.dialect.name == "postgresql":
                statement = (
                    f"ALTER TABLE {table_name} "
                    f"ADD COLUMN IF NOT EXISTS {column_name} VARCHAR({length})"
                )
            else:
                statement = (
                    f"ALTER TABLE {table_name} "
                    f"ADD COLUMN {column_name} VARCHAR({length})"
                )

            with engine.begin() as connection:
                connection.execute(text(statement))

            logger.info("Added missing %s.%s string column", table_name, column_name)

        def ensure_unique_index(index_name: str, table_name: str, columns_sql: str) -> None:
            if not inspector.has_table(table_name):
                return

            statement = f"CREATE UNIQUE INDEX IF NOT EXISTS {index_name} ON {table_name} ({columns_sql})"
            with engine.begin() as connection:
                connection.execute(text(statement))

        def repair_voice_id_column(table_name: str) -> None:
            if not inspector.has_table(table_name):
                return

            columns = {
                column["name"]: column
                for column in inspector.get_columns(table_name)
            }
            voice_column = columns.get("voice_id")
            if voice_column is None:
                return

            voice_type_name = str(voice_column["type"]).lower()
            if engine.dialect.name != "postgresql" or "uuid" not in voice_type_name:
                return

            with engine.begin() as connection:
                table_inspector = inspect(connection)

                for foreign_key in table_inspector.get_foreign_keys(table_name):
                    constrained_columns = foreign_key.get("constrained_columns") or []
                    constraint_name = foreign_key.get("name")

                    if "voice_id" in constrained_columns and constraint_name:
                        connection.execute(
                            text(
                                f"ALTER TABLE {table_name} "
                                f"DROP CONSTRAINT IF EXISTS {constraint_name}"
                            )
                        )

                connection.execute(
                    text(
                        f"ALTER TABLE {table_name} "
                        "ALTER COLUMN voice_id TYPE VARCHAR(100) USING voice_id::text"
                    )
                )

            logger.info(
                "Repaired %s.voice_id column type from UUID to VARCHAR(100)",
                table_name,
            )

        repair_voice_id_column("generation_drafts")
        repair_voice_id_column("generations")
        ensure_string_column("generations", "title", 255)
        ensure_string_column("oauth_authorization_states", "link_user_id", 36)
        ensure_boolean_column("projects", "is_system", "FALSE" if engine.dialect.name == "postgresql" else "0")
        ensure_boolean_column("users", "is_email_verified", "FALSE" if engine.dialect.name == "postgresql" else "0")
        ensure_boolean_column("users", "has_email_auth", "FALSE" if engine.dialect.name == "postgresql" else "0")
        ensure_boolean_column("oauth_identities", "email_verified", "FALSE" if engine.dialect.name == "postgresql" else "0")

        with engine.begin() as connection:
            if inspector.has_table("users"):
                connection.execute(
                    text(
                        "UPDATE users SET is_email_verified = is_verified "
                        "WHERE is_verified = TRUE AND is_email_verified = FALSE"
                    )
                )

            if inspector.has_table("oauth_identities"):
                connection.execute(
                    text(
                        "UPDATE oauth_identities SET email_verified = TRUE "
                        "WHERE provider = 'google' AND email IS NOT NULL AND email_verified = FALSE"
                    )
                )

        repair_auth_duplicates()
        purge_removed_oauth_provider_data()
        ensure_unique_index("uq_users_email_normalized", "users", "LOWER(email)")
        ensure_unique_index("uq_oauth_identities_user_provider_idx", "oauth_identities", "user_id, provider")
    except Exception as e:
        logger.warning(f"Database schema repair warning: {e}")


def init_db() -> None:
    """
    Initialize database by creating all tables.
    Call this once at application startup.
    """
    try:
        # Create missing tables without dropping existing schema.
        Base.metadata.create_all(bind=engine)
        repair_schema()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.warning(f"Database initialization warning: {e}")
        # Don't raise - let the app continue even if DB init has issues.
        # This allows working with existing database schemas.


def drop_all_tables() -> None:
    """
    Drop all tables. Use with caution - this is for development only!
    """
    Base.metadata.drop_all(bind=engine)
    logger.warning("All database tables dropped!")


