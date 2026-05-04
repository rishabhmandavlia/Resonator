import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "./ui/button";

interface AudioWaveformPlayerProps {
  audioUrl: string;
  voiceName?: string;
  fileFormat?: string;
  durationSeconds?: number;
  onDownload?: () => void;
}

const BAR_WIDTH = 3;
const BAR_GAP = 2;
const BAR_MIN_HEIGHT = 2;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioWaveformPlayer({
  audioUrl,
  voiceName,
  fileFormat,
  durationSeconds,
  onDownload,
}: AudioWaveformPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const animationRef = useRef<number>(0);
  const waveformDataRef = useRef<number[]>([]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds || 0);
  const [isDecoding, setIsDecoding] = useState(true);
  const [hasEnded, setHasEnded] = useState(false);

  // Decode audio and extract waveform peaks
  const decodeAudio = useCallback(async (url: string, barCount: number) => {
    try {
      setIsDecoding(true);
      const audioContext = new AudioContext();
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const channelData = audioBuffer.getChannelData(0);
      const samplesPerBar = Math.floor(channelData.length / barCount);
      const peaks: number[] = [];

      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        const start = i * samplesPerBar;
        const end = Math.min(start + samplesPerBar, channelData.length);
        for (let j = start; j < end; j++) {
          sum += Math.abs(channelData[j]);
        }
        peaks.push(sum / (end - start));
      }

      // Normalize peaks to 0..1
      const max = Math.max(...peaks, 0.001);
      const normalized = peaks.map((p) => p / max);

      waveformDataRef.current = normalized;
      await audioContext.close();
      setIsDecoding(false);
    } catch {
      // Fallback: generate a placeholder waveform
      const placeholder = Array.from(
        { length: barCount },
        () => 0.15 + Math.random() * 0.7,
      );
      waveformDataRef.current = placeholder;
      setIsDecoding(false);
    }
  }, []);

  // Draw the waveform on the canvas
  const drawWaveform = useCallback((progress: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const peaks = waveformDataRef.current;
    if (peaks.length === 0) return;

    ctx.clearRect(0, 0, width, height);

    const totalBarWidth = BAR_WIDTH + BAR_GAP;
    const centerY = height / 2;
    const maxBarHeight = height * 0.82;

    for (let i = 0; i < peaks.length; i++) {
      const x = i * totalBarWidth;
      const barHeight = Math.max(peaks[i] * maxBarHeight, BAR_MIN_HEIGHT);
      const barProgress = (i + 1) / peaks.length;

      // Top half
      const topY = centerY - barHeight / 2;
      // Bottom half (mirror)
      const mirrorHeight = barHeight * 0.35;
      const mirrorY = centerY + 4;

      if (barProgress <= progress) {
        // Played portion — vibrant green gradient
        const grad = ctx.createLinearGradient(x, topY, x, topY + barHeight);
        grad.addColorStop(0, "#22c55e");
        grad.addColorStop(0.5, "#16a34a");
        grad.addColorStop(1, "#15803d");
        ctx.fillStyle = grad;
      } else {
        // Unplayed portion — muted
        ctx.fillStyle = "rgba(148, 163, 184, 0.35)";
      }

      // Main bar
      ctx.beginPath();
      ctx.roundRect(x, topY, BAR_WIDTH, barHeight, 1.5);
      ctx.fill();

      // Mirror / reflection
      if (barProgress <= progress) {
        ctx.fillStyle = "rgba(34, 197, 94, 0.15)";
      } else {
        ctx.fillStyle = "rgba(148, 163, 184, 0.12)";
      }
      ctx.beginPath();
      ctx.roundRect(x, mirrorY, BAR_WIDTH, mirrorHeight, 1);
      ctx.fill();
    }
  }, []);

  // Animation loop for live progress
  const animate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    setCurrentTime(audio.currentTime);
    const progress = audio.duration ? audio.currentTime / audio.duration : 0;
    drawWaveform(progress);

    if (!audio.paused && !audio.ended) {
      animationRef.current = requestAnimationFrame(animate);
    }
  }, [drawWaveform]);

  // Initialize: decode audio and compute bar count from container width
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = entry.contentRect.width;
      const barCount = Math.max(20, Math.floor(width / (BAR_WIDTH + BAR_GAP)));
      decodeAudio(audioUrl, barCount);
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [audioUrl, decodeAudio]);

  // Draw initial static waveform once decoding is done
  useEffect(() => {
    if (!isDecoding) {
      drawWaveform(0);
    }
  }, [isDecoding, drawWaveform]);

  // Audio element event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => {
      setIsPlaying(true);
      setHasEnded(false);
      animationRef.current = requestAnimationFrame(animate);
    };
    const onPause = () => {
      setIsPlaying(false);
      cancelAnimationFrame(animationRef.current);
      // Draw final state
      const progress = audio.duration ? audio.currentTime / audio.duration : 0;
      drawWaveform(progress);
    };
    const onEnded = () => {
      setIsPlaying(false);
      setHasEnded(true);
      cancelAnimationFrame(animationRef.current);
      drawWaveform(1);
    };
    const onLoaded = () => {
      setDuration(audio.duration);
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadedmetadata", onLoaded);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadedmetadata", onLoaded);
      cancelAnimationFrame(animationRef.current);
    };
  }, [animate, drawWaveform]);

  const handlePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (hasEnded) {
      audio.currentTime = 0;
      setHasEnded(false);
    }

    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  };

  const handleRestart = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setCurrentTime(0);
    setHasEnded(false);
    drawWaveform(0);
    audio.play();
  };

  // Seek on canvas click
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio || !audio.duration) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    audio.currentTime = ratio * audio.duration;
    setCurrentTime(audio.currentTime);
    setHasEnded(false);
    drawWaveform(ratio);
  };

  const displayDuration = duration || durationSeconds || 0;
  const progress = displayDuration > 0 ? currentTime / displayDuration : 0;
  const downloadFormat = (fileFormat || "wav").toUpperCase();

  return (
    <div className="rounded-2xl border border-border/50 bg-gradient-to-b from-card via-card to-secondary/30 shadow-lg overflow-hidden">
      {/* Hidden audio element */}
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      {/* Top bar - metadata */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-600 shadow-md shadow-emerald-500/10">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M9 18V5l12-2v13"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="6" cy="18" r="3" fill="currentColor" opacity="0.9" />
              <circle cx="18" cy="16" r="3" fill="currentColor" opacity="0.9" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground leading-tight">
              Generated Audio
            </p>
            {voiceName && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {voiceName}
              </p>
            )}
          </div>
        </div>
        <div className="text-xs font-mono text-muted-foreground tabular-nums bg-secondary/50 px-2.5 py-1 rounded-lg">
          {formatTime(currentTime)}{" "}
          <span className="text-muted-foreground/50">/</span>{" "}
          {formatTime(displayDuration)}
        </div>
      </div>

      {/* Waveform */}
      <div ref={containerRef} className="px-5 py-3">
        {isDecoding ? (
          <div className="h-[88px] flex items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="flex gap-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="w-1 bg-green-500/40 rounded-full animate-pulse"
                    style={{
                      height: `${16 + Math.random() * 32}px`,
                      animationDelay: `${i * 150}ms`,
                    }}
                  />
                ))}
              </div>
              Analyzing audio...
            </div>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="w-full h-[88px] cursor-pointer"
            onClick={handleCanvasClick}
          />
        )}

        {/* Progress bar (thin) */}
        <div className="mt-2 h-0.5 rounded-full bg-secondary/60 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-100 ease-linear rounded-full"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between border-t border-emerald-100 bg-gradient-to-r from-emerald-50/80 via-white to-emerald-50/50 px-5 pb-4 pt-3">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            className="h-11 w-11 rounded-full border border-emerald-200 bg-white text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 shadow-lg shadow-emerald-500/10 transition-all duration-200 hover:shadow-emerald-500/20 hover:scale-105 active:scale-95"
            onClick={handlePlayPause}
          >
            {isPlaying ? (
              <Pause className="h-5 w-5 text-current" strokeWidth={2.4} />
            ) : (
              <Play
                className="ml-0.5 h-5 w-5 text-current"
                fill="currentColor"
                strokeWidth={2.2}
              />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9 rounded-full border border-emerald-200 bg-white text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
            onClick={handleRestart}
            title="Restart"
          >
            <RotateCcw className="h-4 w-4 text-current" strokeWidth={2.2} />
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2 rounded-xl border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 text-xs font-medium"
          onClick={onDownload}
        >
          <Download className="h-3.5 w-3.5 text-current" strokeWidth={2.2} />
          Download {downloadFormat}
        </Button>
      </div>
    </div>
  );
}
