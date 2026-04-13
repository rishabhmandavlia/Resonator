"""
Database configuration and session management.
"""

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.engine import Engine
from typing import Generator
import os
import logging

from database.models import Base

logger = logging.getLogger(__name__)

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


