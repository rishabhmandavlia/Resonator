"""
TTS (Text-to-Speech) Service for Kokoro Voice Generation
Handles voice model loading, audio generation, and storage.
"""

import logging
import math
from pathlib import Path
from typing import Optional, Tuple
import uuid
from datetime import datetime

import numpy as np

logger = logging.getLogger(__name__)

try:
    from app.services.storage_service import SupabaseStorageService
    STORAGE_AVAILABLE = True
except Exception as storage_import_error:
    STORAGE_AVAILABLE = False
    SupabaseStorageService = None  # type: ignore[assignment]
    logger.warning(f"Supabase storage not available. Audio will not be uploaded: {storage_import_error}")

try:
    import torch
    TORCH_AVAILABLE = True
except ImportError as torch_import_error:
    torch = None  # type: ignore[assignment]
    TORCH_AVAILABLE = False
    logger.warning(f"PyTorch not available. TTS generation is disabled: {torch_import_error}")

try:
    import torchaudio
    TORCHAUDIO_AVAILABLE = True
except ImportError as torchaudio_import_error:
    torchaudio = None  # type: ignore[assignment]
    TORCHAUDIO_AVAILABLE = False
    logger.warning(f"torchaudio not available. Pitch shifting will be disabled: {torchaudio_import_error}")

try:
    from kokoro import KModel, KPipeline
    KOKORO_AVAILABLE = True
except ImportError as kokoro_import_error:
    KModel = None  # type: ignore[assignment]
    KPipeline = None  # type: ignore[assignment]
    KOKORO_AVAILABLE = False
    logger.warning(f"Kokoro package not available. Audio generation is disabled: {kokoro_import_error}")

# Kokoro model paths
MODEL_DIR = Path(__file__).parent.parent.parent / "models" / "kokoro"
VOICES_DIR = MODEL_DIR / "voices"
KOKORO_CONFIG_PATH = MODEL_DIR / "config.json"
KOKORO_MODEL_PATH = MODEL_DIR / "kokoro-v1_0.pth"
AUDIO_SAMPLE_RATE = 24000
KOKORO_REPO_ID = "hexgrad/Kokoro-82M"
AUDIO_OUTPUT_DIR = Path(__file__).parent.parent.parent / "audio_outputs"

# Ensure output directory exists
AUDIO_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


class TTSService:
    """Service for Kokoro TTS voice generation."""
    
    # Class-level cache for model to avoid reloading
    _model = None
    _device = None
    _pipelines = {}
    
    @staticmethod
    def _get_device():
        """Get the appropriate device (CUDA or CPU)."""
        if not TORCH_AVAILABLE:
            return None
            
        if TTSService._device is None:
            TTSService._device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            logger.info(f"Using device: {TTSService._device}")
        return TTSService._device
    
    @staticmethod
    def _load_model():
        """Load Kokoro model (cached)."""
        if not TORCH_AVAILABLE or not KOKORO_AVAILABLE:
            raise RuntimeError("Kokoro TTS requires torch and the kokoro package to be installed")

        if TTSService._model is None:
            try:
                device = TTSService._get_device()
                
                if not KOKORO_MODEL_PATH.exists():
                    raise FileNotFoundError(f"Kokoro model not found at {KOKORO_MODEL_PATH}")
                
                logger.info(f"Loading Kokoro model from {KOKORO_MODEL_PATH}")
                config_path = str(KOKORO_CONFIG_PATH) if KOKORO_CONFIG_PATH.exists() else None
                TTSService._model = KModel(
                    repo_id=KOKORO_REPO_ID,
                    config=config_path,
                    model=str(KOKORO_MODEL_PATH),
                ).to(device).eval()
                
                logger.info("Kokoro model loaded successfully")
            except Exception as e:
                logger.error(f"Failed to load Kokoro model: {e}")
                raise RuntimeError(f"Failed to load Kokoro model: {str(e)}") from e
        
        return TTSService._model
    
    @staticmethod
    def _get_voice_path(voice_id: str) -> Path:
        """Resolve the local voice pack path for a voice identifier."""
        voice_path = VOICES_DIR / f"{voice_id}.pt"

        if not voice_path.exists():
            raise ValueError(f"Voice model not found: {voice_path}")

        return voice_path

    @staticmethod
    def _load_pipeline(language_code: str):
        """Load and cache a Kokoro pipeline for a specific language."""
        if not KOKORO_AVAILABLE:
            raise RuntimeError("Kokoro package is not available")

        language_code = language_code.lower()

        if language_code not in TTSService._pipelines:
            try:
                TTSService._pipelines[language_code] = KPipeline(
                    lang_code=language_code,
                    repo_id=KOKORO_REPO_ID,
                    model=False,
                )
            except AssertionError as error:
                raise ValueError(f"Unsupported Kokoro language code: {language_code}") from error

        return TTSService._pipelines[language_code]

    @staticmethod
    def _save_audio_file(audio_path: Path, waveform: "torch.Tensor") -> None:
        """Write a mono WAV file using 16-bit PCM."""
        import wave

        waveform = waveform.detach().cpu().clamp(-1.0, 1.0)
        pcm_bytes = (waveform * 32767.0).to(torch.int16).numpy().tobytes()

        with wave.open(str(audio_path), "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(AUDIO_SAMPLE_RATE)
            wav_file.writeframes(pcm_bytes)

    @staticmethod
    def _apply_pitch_shift(waveform: "torch.Tensor", pitch: float) -> "torch.Tensor":
        """Apply a musical pitch shift while preserving duration."""
        if abs(pitch - 1.0) < 1e-6:
            return waveform

        n_steps = math.log2(pitch) * 12.0

        if TORCHAUDIO_AVAILABLE:
            shifted = torchaudio.functional.pitch_shift(
                waveform.unsqueeze(0),
                sample_rate=AUDIO_SAMPLE_RATE,
                n_steps=n_steps,
            )
            return shifted.squeeze(0)

        try:
            import librosa

            shifted_np = librosa.effects.pitch_shift(
                waveform.detach().cpu().numpy().astype(np.float32),
                sr=AUDIO_SAMPLE_RATE,
                n_steps=n_steps,
            )
            return torch.from_numpy(np.asarray(shifted_np)).to(waveform.device)
        except Exception as error:
            logger.warning(
                "Pitch control was requested, but pitch shifting failed; returning original waveform: %s",
                error,
            )
            return waveform
    
    @staticmethod
    def _generate_mock_audio(
        text: str,
        voice_id: str,
        speed: float = 1.0,
        pitch: float = 1.0,
        project_id: Optional[str] = None,
    ) -> Tuple[str, float, str]:
        """
        Generate mock audio data for testing when PyTorch is not available.
        Creates a simple WAV file with dummy audio.
        """
        try:
            import wave
            import struct
            
            audio_id = str(uuid.uuid4())
            audio_path = AUDIO_OUTPUT_DIR / f"{audio_id}.wav"
            
            # Calculate duration based on text length and speed
            # Rough estimate: 5 characters per second at normal speed
            base_duration = max(1.0, len(text) / (5.0 / speed))
            duration = min(base_duration, 30.0)  # Cap at 30 seconds
            
            sample_rate = 24000
            num_samples = int(sample_rate * duration)
            
            # Generate simple sine wave audio
            frequency = 440  # A4 note
            amplitude = 0.1  # Quiet
            
            frames = []
            for i in range(num_samples):
                sample = amplitude * (2 ** 15 - 1)
                sample = int(sample * (0.5 + 0.5 * (i % 1000) / 1000))
                frames.append(struct.pack('<h', sample))
            
            # Write WAV file
            with wave.open(str(audio_path), 'wb') as wav_file:
                wav_file.setnchannels(1)  # Mono
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(sample_rate)
                wav_file.writeframes(b''.join(frames))
            
            logger.info(f"Mock audio generated: {audio_path} (duration: {duration:.2f}s)")

            if not STORAGE_AVAILABLE:
                raise RuntimeError("Supabase storage is not available")

            storage_path, audio_url = SupabaseStorageService.store_audio_file(
                audio_path,
                project_id=project_id,
                voice_id=voice_id,
            )
            try:
                audio_path.unlink(missing_ok=True)
            except Exception:
                logger.debug("Unable to remove temporary mock audio file: %s", audio_path)
            return storage_path, duration, audio_url
            
        except Exception as e:
            logger.error(f"Failed to generate mock audio: {e}")
            raise RuntimeError(f"Failed to generate audio: {str(e)}")
    
    @staticmethod
    def generate_audio(
        text: str,
        voice_id: str,
        speed: float = 1.0,
        pitch: float = 1.0,
        project_id: Optional[str] = None,
    ) -> Tuple[str, float, str]:
        """
        Generate audio from text using Kokoro TTS.
        
        Args:
            text: Text to synthesize
            voice_id: Voice model identifier (e.g., 'af_bella')
            speed: Speech speed multiplier (0.5 - 2.0)
            pitch: Pitch multiplier (0.5 - 2.0)
        
        Returns:
            Tuple of (storage_object_path, duration_seconds, signed_audio_url)
        
        Raises:
            ValueError: If inputs are invalid
            RuntimeError: If generation fails
        """
        # Validation
        if not text or not text.strip():
            raise ValueError("Text cannot be empty")
        
        if len(text) > 5000:
            raise ValueError("Text is too long (max 5000 characters)")
        
        if speed < 0.5 or speed > 2.0:
            raise ValueError("Speed must be between 0.5 and 2.0")
        
        if pitch < 0.5 or pitch > 2.0:
            raise ValueError("Pitch must be between 0.5 and 2.0")
        
        try:
            logger.info(f"Generating audio: text_len={len(text)}, voice={voice_id}, speed={speed}, pitch={pitch}")
            model = TTSService._load_model()

            if not voice_id:
                raise ValueError("Voice ID cannot be empty")

            voice_path = TTSService._get_voice_path(voice_id)
            language_code = voice_id[0].lower()
            pipeline = TTSService._load_pipeline(language_code)

            audio_chunks = []
            with torch.no_grad():
                for result in pipeline(
                    text.strip(),
                    voice=str(voice_path),
                    speed=speed,
                    split_pattern=r"\n+",
                    model=model,
                ):
                    if result.audio is None:
                        continue

                    chunk = result.audio.detach().cpu().float().flatten()
                    if chunk.numel() == 0:
                        continue

                    audio_chunks.append(chunk)

            if not audio_chunks:
                raise RuntimeError("Kokoro did not return any audio")

            waveform = torch.cat(audio_chunks)

            if abs(pitch - 1.0) > 1e-6:
                waveform = TTSService._apply_pitch_shift(waveform, pitch)

            waveform = waveform.clamp(-1.0, 1.0)

            audio_id = str(uuid.uuid4())
            audio_path = AUDIO_OUTPUT_DIR / f"{audio_id}.wav"

            TTSService._save_audio_file(audio_path, waveform)
            duration = waveform.numel() / AUDIO_SAMPLE_RATE

            if not STORAGE_AVAILABLE:
                raise RuntimeError("Supabase storage is not available")

            storage_path, audio_url = SupabaseStorageService.store_audio_file(
                audio_path,
                project_id=project_id,
                voice_id=voice_id,
            )

            try:
                audio_path.unlink(missing_ok=True)
            except Exception:
                logger.debug("Unable to remove temporary generated audio file: %s", audio_path)
            
            logger.info(f"Audio generated successfully: {storage_path} (duration: {duration:.2f}s)")
            
            return storage_path, duration, audio_url
            
        except Exception as e:
            logger.error(f"Audio generation failed: {e}")
            raise RuntimeError(f"Failed to generate audio: {str(e)}")
    
    @staticmethod
    def get_available_voices() -> dict:
        """
        Get list of available voices with metadata.
        
        Returns:
            Dictionary mapping voice_id to voice metadata
        """
        voices = {}
        
        try:
            if VOICES_DIR.exists():
                for voice_file in VOICES_DIR.glob("*.pt"):
                    voice_id = voice_file.stem
                    
                    # Extract language and gender from voice_id
                    # Format: {language_code}{gender_char}_{name}
                    # e.g., af_bella = African Female Bella
                    parts = voice_id.split("_", 1)
                    if len(parts) == 2:
                        code, name = parts
                        gender = "Female" if code[1].lower() == "f" else "Male"
                        
                        # Map language codes
                        lang_map = {
                            "af": "African English",
                            "am": "African English",
                            "bf": "British English",
                            "bm": "British English",
                            "ef": "European English",
                            "em": "European English",
                            "ff": "French",
                            "hf": "Hindi",
                            "hm": "Hindi",
                            "if": "Italian",
                            "im": "Italian",
                            "jf": "Japanese",
                            "jm": "Japanese",
                            "pf": "Portuguese",
                            "pm": "Portuguese",
                            "zf": "Chinese",
                            "zm": "Chinese",
                        }
                        language = lang_map.get(code, "Unknown")
                        
                        voices[voice_id] = {
                            "id": voice_id,
                            "name": name.title(),
                            "language": language,
                            "gender": gender,
                        }
            
            logger.info(f"Found {len(voices)} available voices")
        except Exception as e:
            logger.error(f"Failed to load voices: {e}")
        
        return voices
    
    @staticmethod
    def cleanup_old_audio(max_age_hours: int = 24) -> int:
        """
        Clean up old audio files.
        
        Args:
            max_age_hours: Maximum age in hours before deletion
        
        Returns:
            Number of files deleted
        """
        try:
            deleted_count = 0
            now = datetime.now().timestamp()
            max_age_seconds = max_age_hours * 3600
            
            if AUDIO_OUTPUT_DIR.exists():
                for audio_file in AUDIO_OUTPUT_DIR.glob("*.wav"):
                    file_age = now - audio_file.stat().st_mtime
                    if file_age > max_age_seconds:
                        audio_file.unlink()
                        deleted_count += 1
            
            if deleted_count > 0:
                logger.info(f"Cleaned up {deleted_count} old audio files")
            
            return deleted_count
        except Exception as e:
            logger.error(f"Failed to cleanup audio files: {e}")
            return 0
