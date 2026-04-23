# AI Voice Generator - Development Instructions

## Project Overview

Full-stack AI voice generation application using Kokoro TTS with voice cloning capabilities.

## Technology Stack

### Backend

- **Runtime:** Python 3.11+
- **Framework:** FastAPI + Uvicorn
- **ORM:** SQLAlchemy
- **Database:** Supabase (PostgreSQL)
- **Authentication:** JWT with python-jose

### Frontend

- **Package Manager:** Bun
- **Framework:** React 18+ with TypeScript
- **Build Tool:** Vite
- **Styling:** CSS/Tailwind (as configured)
- **State Management:** React Context API

### AI/ML

- **TTS Engine:** Kokoro v1.0
- **Voice Models:** Pre-trained Kokoro voices (50+ languages/genders)

---

## Prerequisites

### Backend Setup

1. **Python 3.11** must be installed
   ```bash
   python --version  # Should return 3.11.x
   ```
2. **Virtual Environment**
   ```bash
   python -m venv backend/venv
   backend/venv/Scripts/activate  # Windows
   # or: source backend/venv/bin/activate  # macOS/Linux
   ```

### Frontend Setup

1. **Bun** installed (latest version)
   ```bash
   curl -fsSL https://bun.sh/install | bash
   bun --version
   ```

---

## Environment Configuration

### Backend (.env)

Create `backend/.env`:

```env
# Supabase
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_anon_key
SUPABASE_SERVICE_KEY=your_supabase_service_key
DATABASE_URL=postgresql://user:password@...

# JWT
SECRET_KEY=your_secret_key_here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# App
DEBUG=true
ENVIRONMENT=development
```

### Frontend (.env)

Create `frontend/.env`:

```env
VITE_API_URL=http://localhost:8000
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

---

## Installation & Setup

### Backend Installation

```bash
# Navigate to backend
cd backend

# Activate virtual environment
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run database migrations (if using Alembic)
alembic upgrade head

# Start development server
uvicorn app.main:app --reload --port 8000
```

### Frontend Installation

```bash
# Navigate to frontend
cd frontend

# Install dependencies with Bun
bun install

# Start development server
bun run dev

# Build for production
bun run build

# Preview production build
bun run preview
```

---

## Database (Supabase)

### Connection

- Database is hosted on Supabase (PostgreSQL)
- Use connection string from `DATABASE_URL` env variable
- Supabase client accessible via env keys

### Key Tables

- **users** - User authentication and profiles
- **voices** - Kokoro voice models (system + cloned)
- **voice_clone_jobs** - Training job tracking
- **projects** - User project management
- **generated_audio** - Generated audio file metadata

### Migrations

```bash
# Create new migration
alembic revision --autogenerate -m "Migration description"

# Apply migrations
alembic upgrade head

# Rollback
alembic downgrade -1
```

---

## Development Workflow

### Running Locally

**Terminal 1 - Backend:**

```bash
cd backend
venv\Scripts\activate
uvicorn app.main:app --reload
# Runs on http://localhost:8000
# Swagger docs: http://localhost:8000/docs
```

**Terminal 2 - Frontend:**

```bash
cd frontend
bun run dev
# Runs on http://localhost:5173
```

### API Documentation

- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

### Code Structure

```
backend/
  ├── app/
  │   ├── main.py          # FastAPI app entry
  │   ├── routes/          # API route handlers
  │   └── services/        # Business logic
  ├── database/
  │   └── models.py        # SQLAlchemy models
  ├── models/              # ML model files
  │   └── kokoro/          # TTS models

frontend/
  ├── src/
  │   ├── auth/            # Authentication
  │   ├── generation/      # TTS generation UI
  │   ├── components/      # Reusable components
  │   └── pages/           # Page components
  ├── index.html
  └── vite.config.ts       # Vite configuration
```

---

## Kokoro TTS Integration

### Voice Model Structure

- Location: `backend/models/kokoro/voices/`
- Format: PyTorch `.pt` files
- Available voices: 50+ across multiple languages/genders
  - `af_*` - Female African English
  - `am_*` - Male African English
  - `bf_*` - Female British English
  - `bm_*` - Male British English
  - `ef_*` - Female European English
  - And more for Hindi, Japanese, Chinese, etc.

### Voice Cloning

- User can train custom voice models from audio
- Jobs tracked in `voice_clone_jobs` table
- Status: `pending | training | ready | failed`

---

## Key Features to Implement

### Authentication

- [ ] JWT-based auth system
- [ ] Login/Register endpoints
- [ ] Protected routes
- [ ] Role-based access (admin/user)

### Voice Management

- [ ] List available Kokoro voices
- [ ] Create voice cloning jobs
- [ ] Track cloning progress
- [ ] Manage public/private voices

### TTS Generation

- [ ] Text-to-speech generation endpoint
- [ ] Voice selection
- [ ] Audio output storage
- [ ] Project organization

### Frontend

- [ ] Authentication pages (login, register)
- [ ] Dashboard
- [ ] Voice selection UI
- [ ] Text input & generation form
- [ ] Audio playback
- [ ] Project management

---

## Common Commands

### Backend

```bash
# Format code
black backend/

# Lint
flake8 backend/

# Type checking
mypy backend/

# Run tests
pytest backend/tests/
```

### Frontend

```bash
# Format code
bun run format

# Lint
bun run lint

# Type check
bun run type-check

# Run tests
bun run test
```

---

## Troubleshooting

### Python Version Issues

```bash
# Verify Python 3.11
python --version

# If wrong version, use py launcher
py -3.11 -m venv backend/venv
```

### Bun Installation Issues

- Windows: Use installer or `choco install bun`
- macOS: Use Homebrew `brew install bun`
- Linux: Use npm fallback `npm install -g bun`

### Supabase Connection

- Verify `DATABASE_URL` is correct
- Check network connectivity
- Ensure credentials haven't expired
- Review Supabase dashboard for table creation

### CORS Issues

- Add frontend URL to FastAPI CORS middleware
- Check browser DevTools Network tab
- Verify credentials are sent with requests

---

## Deployment

### Backend (Python 3.11)

- Deploy to: Railway, Render, Fly.io, AWS EC2
- Use Gunicorn for production
- Environment: Python 3.11 runtime

### Frontend (Bun)

- Build: `bun run build` → outputs to `dist/`
- Deploy to: Vercel, Netlify, GitHub Pages
- Environment: Node.js 18+

---

## Resources

- [FastAPI Docs](https://fastapi.tiangolo.com/)
- [React TypeScript](https://react.dev/languages/typescript)
- [Bun Documentation](https://bun.sh/docs)
- [Supabase Docs](https://supabase.com/docs)
- [SQLAlchemy Docs](https://docs.sqlalchemy.org/)
