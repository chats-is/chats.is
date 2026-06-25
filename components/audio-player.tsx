'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Pause, Play } from 'lucide-react';

import { cn, formatMediaTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface AudioPlayerProps {
  src: string;
  className?: string;
}

export function AudioPlayer({ src, className }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => setDuration(audio.duration);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      if (audio) audio.currentTime = 0;
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
  }, [isPlaying]);

  const handleSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      if (!audio || !duration) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = x / rect.width;
      const newTime = percentage * duration;

      audio.currentTime = newTime;
      setCurrentTime(newTime);
    },
    [duration]
  );

  const handleDownload = useCallback(() => {
    const link = document.createElement('a');
    link.href = src;
    link.download = 'audio.mp3';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [src]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-full bg-muted/50 py-2 pr-4 pl-2',
        className
      )}
    >
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Play/Pause Button */}
      <Button
        variant="secondary"
        size="icon"
        onClick={togglePlay}
        className="size-10 shrink-0 rounded-full"
      >
        {isPlaying ? (
          <Pause className="size-4 fill-current" />
        ) : (
          <Play className="size-4 fill-current" />
        )}
      </Button>

      {/* Progress Bar & Time */}
      <div className="flex flex-1 flex-col gap-1">
        <div
          className="group relative h-1.5 cursor-pointer rounded-full bg-muted-foreground/20"
          onClick={handleSeek}
        >
          <div
            className="absolute top-0 left-0 h-full rounded-full bg-foreground transition-all"
            style={{ width: `${progress}%` }}
          />
          <div
            className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
            style={{ left: `calc(${progress}% - 6px)` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{formatMediaTime(currentTime)}</span>
          <span>{formatMediaTime(duration)}</span>
        </div>
      </div>

      {/* Download Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={handleDownload}
        className="size-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
      >
        <Download className="size-4" />
      </Button>
    </div>
  );
}
