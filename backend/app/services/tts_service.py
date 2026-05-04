"""
TTS (Text-to-Speech) Service for Kokoro Voice Generation
Handles voice model loading, audio generation, and storage.
"""

import logging
import math
import os
import warnings
from threading import Event
from io import BytesIO
from pathlib import Path
from typing import Callable, Optional, Tuple
import uuid

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
    logger.warning(f"Kokoro package not available. TTS generation is disabled: {kokoro_import_error}")

try:
    import imageio_ffmpeg
    IMAGEIO_FFMPEG_AVAILABLE = True
    bundled_ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
    bundled_ffmpeg_dir = str(Path(bundled_ffmpeg_path).parent)
    os.environ["PATH"] = (
        f"{bundled_ffmpeg_dir}{os.pathsep}{os.environ.get('PATH', '')}"
        if bundled_ffmpeg_dir not in os.environ.get("PATH", "")
        else os.environ.get("PATH", "")
    )
except ImportError as imageio_ffmpeg_import_error:
    imageio_ffmpeg = None  # type: ignore[assignment]
    IMAGEIO_FFMPEG_AVAILABLE = False
    bundled_ffmpeg_path = None
    logger.warning(
        "imageio-ffmpeg not available. Bundled ffmpeg conversion will be disabled: %s",
        imageio_ffmpeg_import_error,
    )

warnings.filterwarnings(
    "ignore",
    message="Couldn't find ffmpeg or avconv - defaulting to ffmpeg, but may not work",
    category=RuntimeWarning,
    module="pydub.utils",
)

try:
    from pydub import AudioSegment
    PYDUB_AVAILABLE = True
except ImportError as pydub_import_error:
    PYDUB_AVAILABLE = False
    AudioSegment = None  # type: ignore[assignment]
    logger.warning(f"pydub not available. MP3/OGG conversion will be disabled: {pydub_import_error}")

# Kokoro model paths
MODEL_DIR = Path(__file__).parent.parent.parent / "models" / "kokoro"
VOICES_DIR = MODEL_DIR / "voices"
KOKORO_CONFIG_PATH = MODEL_DIR / "config.json"
KOKORO_MODEL_PATH = MODEL_DIR / "kokoro-v1_0.pth"
AUDIO_SAMPLE_RATE = 24000
KOKORO_REPO_ID = "hexgrad/Kokoro-82M"
AUDIO_CONTENT_TYPES = {
    "wav": "audio/wav",
    "mp3": "audio/mpeg",
    "ogg": "audio/ogg",
}


class TTSService:
    """Service for Kokoro TTS voice generation."""
    
    # Class-level cache for model to avoid reloading
    _model = None
    _device = None
    _pipelines = {}
    _ffmpeg_binary: str | None = None

    @staticmethod
    def _report_progress(
        progress_callback: Callable[[str, int], None] | None,
        stage: str,
        percent: int,
    ) -> None:
        if progress_callback is not None:
            progress_callback(stage, percent)

    @staticmethod
    def _raise_if_cancelled(cancel_event: Event | None) -> None:
        if cancel_event is not None and cancel_event.is_set():
            raise RuntimeError("Generation cancelled")
    
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
    def _build_wav_bytes(
        waveform: "torch.Tensor",
        sample_rate: int = AUDIO_SAMPLE_RATE,
    ) -> bytes:
        """Encode a mono WAV file in memory using 16-bit PCM."""
        import wave

        waveform = waveform.detach().cpu().clamp(-1.0, 1.0)
        pcm_bytes = (waveform * 32767.0).to(torch.int16).numpy().tobytes()

        buffer = BytesIO()
        with wave.open(buffer, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(pcm_bytes)
        return buffer.getvalue()

    @staticmethod
    def _ensure_ffmpeg_binary() -> str:
        """Resolve and configure the ffmpeg binary used by pydub exports."""
        if TTSService._ffmpeg_binary:
            return TTSService._ffmpeg_binary

        if not PYDUB_AVAILABLE:
            raise RuntimeError("Audio conversion requires pydub to be installed")

        if IMAGEIO_FFMPEG_AVAILABLE and imageio_ffmpeg is not None:
            ffmpeg_binary = bundled_ffmpeg_path or imageio_ffmpeg.get_ffmpeg_exe()
            AudioSegment.converter = ffmpeg_binary
            AudioSegment.ffmpeg = ffmpeg_binary
            TTSService._ffmpeg_binary = ffmpeg_binary
            logger.info("Configured bundled ffmpeg binary for audio conversion: %s", ffmpeg_binary)
            return ffmpeg_binary

        raise RuntimeError(
            "MP3/OGG export requires ffmpeg. Install imageio-ffmpeg or configure ffmpeg on PATH."
        )

    @staticmethod
    def _convert_audio_format(
        input_bytes: bytes,
        target_format: str,
    ) -> Tuple[bytes, str]:
        """Convert WAV bytes to the requested format in memory."""
        normalized_format = target_format.lower()

        if normalized_format == "wav":
            return input_bytes, "wav"

        if not PYDUB_AVAILABLE:
            raise RuntimeError("MP3/OGG export requires pydub to be installed")

        try:
            TTSService._ensure_ffmpeg_binary()
            audio = AudioSegment.from_file(BytesIO(input_bytes), format="wav")
            output_buffer = BytesIO()

            if normalized_format == "mp3":
                audio.export(output_buffer, format="mp3", bitrate="192k")
                return output_buffer.getvalue(), "mp3"

            if normalized_format == "ogg":
                audio.export(output_buffer, format="ogg", codec="libvorbis")
                return output_buffer.getvalue(), "ogg"

            raise RuntimeError(f"Unsupported audio format requested: {target_format}")

        except Exception as e:
            raise RuntimeError(
                f"Failed to convert generated audio to {normalized_format.upper()}: {e}"
            ) from e

    @staticmethod
    def _get_audio_content_type(audio_format: str) -> str:
        """Map an audio file format to a content type for upload and proxying."""
        return AUDIO_CONTENT_TYPES.get(audio_format.lower(), "application/octet-stream")

    @staticmethod
    def _store_generated_audio(
        audio_bytes: bytes,
        *,
        audio_id: str,
        project_id: Optional[str],
        voice_id: str,
        audio_format: str,
    ) -> Tuple[str, str]:
        """Store generated audio directly in Supabase Storage without local files."""
        if not STORAGE_AVAILABLE:
            raise RuntimeError("Supabase storage is not available")

        return SupabaseStorageService.store_audio_bytes(
            audio_bytes,
            file_stem=audio_id,
            project_id=project_id,
            voice_id=voice_id,
            extension=audio_format,
            content_type=TTSService._get_audio_content_type(audio_format),
        )

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
        progress_callback: Callable[[str, int], None] | None = None,
        cancel_event: Event | None = None,
    ) -> Tuple[str, float, str, str]:
        """
        Generate mock audio data for testing when PyTorch is not available.
        Creates a simple WAV payload with dummy audio.
        """
        try:
            import wave
            import struct
            
            audio_id = str(uuid.uuid4())
            TTSService._report_progress(progress_callback, "Synthesizing audio", 30)
            TTSService._raise_if_cancelled(cancel_event)
            
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
            
            buffer = BytesIO()
            with wave.open(buffer, 'wb') as wav_file:
                wav_file.setnchannels(1)  # Mono
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(sample_rate)
                wav_file.writeframes(b''.join(frames))
            audio_bytes = buffer.getvalue()
            
            logger.info("Mock audio generated in memory (duration: %.2fs)", duration)
            TTSService._report_progress(progress_callback, "Encoding audio", 75)
            TTSService._raise_if_cancelled(cancel_event)

            storage_path, audio_url = TTSService._store_generated_audio(
                audio_bytes,
                audio_id=audio_id,
                project_id=project_id,
                voice_id=voice_id,
                audio_format="wav",
            )
            TTSService._report_progress(progress_callback, "Uploading audio", 95)
            return storage_path, duration, audio_url, "wav"
            
        except Exception as e:
            logger.error(f"Failed to generate mock audio: {e}")
            raise RuntimeError(f"Failed to generate audio: {str(e)}")
    
    @staticmethod
    def generate_audio(
        text: str,
        voice_id: str,
        speed: float = 1.0,
        pitch: float = 1.0,
        sample_rate: int = 22050,
        audio_format: str = "wav",
        project_id: Optional[str] = None,
        progress_callback: Callable[[str, int], None] | None = None,
        cancel_event: Event | None = None,
    ) -> Tuple[str, float, str, str]:
        """
        Generate audio from text using Kokoro TTS.
        
        Args:
            text: Text to synthesize
            voice_id: Voice model identifier (e.g., 'af_bella')
            speed: Speech speed multiplier (0.5 - 2.0)
            pitch: Pitch multiplier (0.5 - 2.0)
        
        Returns:
            Tuple of (storage_object_path, duration_seconds, signed_audio_url, actual_file_format)
        
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
            TTSService._report_progress(progress_callback, "Loading model", 10)
            model = TTSService._load_model()
            TTSService._raise_if_cancelled(cancel_event)

            if not voice_id:
                raise ValueError("Voice ID cannot be empty")

            voice_path = TTSService._get_voice_path(voice_id)
            language_code = voice_id[0].lower()
            pipeline = TTSService._load_pipeline(language_code)
            TTSService._report_progress(progress_callback, "Synthesizing audio", 25)

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
                    TTSService._raise_if_cancelled(cancel_event)

            if not audio_chunks:
                raise RuntimeError("Kokoro did not return any audio")

            waveform = torch.cat(audio_chunks)

            if abs(pitch - 1.0) > 1e-6:
                TTSService._report_progress(progress_callback, "Processing audio", 45)
                waveform = TTSService._apply_pitch_shift(waveform, pitch)

            waveform = waveform.clamp(-1.0, 1.0)

            # Handle sample rate conversion
            if sample_rate != AUDIO_SAMPLE_RATE:
                if TORCHAUDIO_AVAILABLE:
                    TTSService._report_progress(progress_callback, "Processing audio", 55)
                    waveform = torchaudio.functional.resample(
                        waveform.unsqueeze(0),
                        orig_freq=AUDIO_SAMPLE_RATE,
                        new_freq=sample_rate,
                    ).squeeze(0)
                else:
                    logger.warning("Sample rate conversion requested but torchaudio not available, using native rate")

            audio_id = str(uuid.uuid4())
            requested_format = audio_format.lower()
            TTSService._report_progress(progress_callback, "Encoding audio", 70)
            wav_bytes = TTSService._build_wav_bytes(waveform, sample_rate)
            audio_bytes, resolved_audio_format = TTSService._convert_audio_format(
                wav_bytes,
                requested_format,
            )
            TTSService._raise_if_cancelled(cancel_event)

            duration = waveform.numel() / sample_rate

            TTSService._report_progress(progress_callback, "Uploading audio", 90)
            storage_path, audio_url = TTSService._store_generated_audio(
                audio_bytes,
                audio_id=audio_id,
                project_id=project_id,
                voice_id=voice_id,
                audio_format=resolved_audio_format,
            )
            
            logger.info(f"Audio generated successfully: {storage_path} (duration: {duration:.2f}s)")
            TTSService._report_progress(progress_callback, "Complete", 100)
            
            return storage_path, duration, audio_url, resolved_audio_format
            
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
    
