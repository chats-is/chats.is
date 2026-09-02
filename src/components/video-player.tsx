import React, { useEffect, useRef, useState } from 'react'
import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from 'lucide-react'

import { formatMediaTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface VideoPlayerProps {
  src: string
}

export function VideoPlayer({ src }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const updateTime = () => {
      const current = video.currentTime
      const total = video.duration

      // If close to end (gap less than 0.1 seconds), set to full duration
      if (total - current < 0.1) {
        setCurrentTime(total)
      } else {
        setCurrentTime(current)
      }
    }

    const updateDuration = () => setDuration(video.duration)

    const handleEnded = () => {
      setIsPlaying(false)
      // Ensure progress bar shows 100%
      setCurrentTime(video.duration)
    }

    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }

    video.addEventListener('timeupdate', updateTime)
    video.addEventListener('loadedmetadata', updateDuration)
    video.addEventListener('ended', handleEnded)
    document.addEventListener('fullscreenchange', handleFullscreenChange)

    return () => {
      video.removeEventListener('timeupdate', updateTime)
      video.removeEventListener('loadedmetadata', updateDuration)
      video.removeEventListener('ended', handleEnded)
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return

    if (isPlaying) {
      video.pause()
    } else {
      video.play()
    }
    setIsPlaying(!isPlaying)
  }

  const toggleMute = () => {
    const video = videoRef.current
    if (!video) return

    video.muted = !isMuted
    setIsMuted(!isMuted)
  }

  const toggleFullscreen = async () => {
    const container = containerRef.current
    if (!container) return

    try {
      if (!document.fullscreenElement) {
        await container.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch (err) {
      console.error('Failed to toggle fullscreen:', err)
    }
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current
    if (!video) return

    const newTime = parseFloat(e.target.value)
    video.currentTime = newTime
    setCurrentTime(newTime)
  }

  // Calculate progress percentage
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div
      ref={containerRef}
      className="group relative overflow-hidden rounded-lg border bg-black shadow-sm"
    >
      <video
        ref={videoRef}
        src={src}
        preload="metadata"
        className="w-full cursor-pointer"
        onClick={togglePlay}
      />

      {/* Control bar */}
      <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent p-4 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="flex items-center gap-3">
          {/* Play/Pause Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={togglePlay}
            className="size-8 shrink-0 text-white hover:bg-white/20 hover:text-white"
          >
            {isPlaying ? (
              <Pause className="size-6" />
            ) : (
              <Play className="size-6" />
            )}
          </Button>

          {/* Progress Bar */}
          <div className="flex flex-1 flex-col gap-2">
            <div className="relative h-1 w-full">
              {/* Background track */}
              <div className="absolute inset-0 rounded-full bg-white/30" />
              {/* Progress track */}
              <div
                className="absolute top-0 left-0 h-full rounded-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
              {/* Input slider */}
              <input
                type="range"
                min="0"
                max={duration || 0}
                step="0.01"
                value={currentTime}
                onChange={handleSeek}
                className="absolute inset-0 size-full cursor-pointer appearance-none bg-transparent outline-hidden [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-lg [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-lg"
              />
            </div>
            <div className="flex justify-between text-xs text-white">
              <span>{formatMediaTime(currentTime)}</span>
              <span>{formatMediaTime(duration)}</span>
            </div>
          </div>

          {/* Mute Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleMute}
            className="size-8 shrink-0 text-white hover:bg-white/20 hover:text-white"
          >
            {isMuted ? (
              <VolumeX className="size-6" />
            ) : (
              <Volume2 className="size-6" />
            )}
          </Button>

          {/* Fullscreen Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleFullscreen}
            className="size-8 shrink-0 text-white hover:bg-white/20 hover:text-white"
          >
            {isFullscreen ? (
              <Minimize className="size-6" />
            ) : (
              <Maximize className="size-6" />
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
