/**
 * usePodcastPlayer
 *
 * Custom hook for managing podcast player state.
 * Handles audio playback, timing, segment tracking, and avatar synchronization.
 *
 * Features:
 * - Content-based camera transitions (close-ups, dynamic speeds)
 * - Listener reactions for non-speaking host
 * - Mood and gesture synchronization
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GestureName } from 'ugly-app/three/client';
import {
  NewsPodcast,
  PodcastArticleReference,
  PodcastListenerReaction,
  PodcastSegment,
  PodcastSubtitle,
} from '../../shared/news/NewsPodcast';
import { MIN_SEGMENT_DURATION_FOR_CAMERA_SWITCH } from '../../shared/podcast';
import { CameraFocus } from './PodcastCameraController';
import { PodcastSceneManager } from './PodcastSceneManager';

export interface PodcastPlayerState {
  // Playback state
  isPlaying: boolean;
  isLoaded: boolean;
  currentTimeMs: number;
  durationMs: number;

  // Current content
  currentSegment: PodcastSegment | null;
  currentSubtitle: PodcastSubtitle | null;
  currentArticle: PodcastArticleReference | null;

  // Controls
  togglePlayPause: () => void;
  seekTo: (timeMs: number) => void;
  seekToArticle: (index: number) => void;

  // Refs for external access
  audioRef: React.RefObject<HTMLAudioElement | null>;
}

export interface UsePodcastPlayerOptions {
  podcast: NewsPodcast;
  sceneManager: PodcastSceneManager | null;
  onSegmentChange?: (segment: PodcastSegment | null) => void;
}

export function usePodcastPlayer(
  options: UsePodcastPlayerOptions,
): PodcastPlayerState {
  const { podcast, sceneManager, onSegmentChange } = options;

  // Refs
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastSegmentIdRef = useRef<string | null>(null);
  const lastCameraFocusRef = useRef<CameraFocus>('wide');
  const gestureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Song mode refs
  const songModeStartedRef = useRef(false);

  // State
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);

  // Find current segment based on time
  const currentSegment = useMemo(() => {
    return (
      podcast.segments.find(
        (s) => s.startTimeMs <= currentTimeMs && s.endTimeMs > currentTimeMs,
      ) ?? null
    );
  }, [currentTimeMs, podcast.segments]);

  // Find current subtitle based on time.
  // Use the latest-starting active subtitle so that when Whisper timestamps produce
  // overlapping lines, the newer line takes priority over the old one.
  // In song mode also cap long gap-bridged subtitles (> 8s) at 4s so they don't
  // stick on screen during extended musical interludes.
  const currentSubtitle = useMemo(() => {
    // Walk the array keeping the last match — subtitles are ordered by startTimeMs,
    // so the last match is always the most recently started one.
    let sub: PodcastSubtitle | null = null;
    for (const s of podcast.subtitles) {
      if (s.startTimeMs <= currentTimeMs && s.endTimeMs > currentTimeMs) {
        sub = s;
      }
    }

    if (!sub || !podcast.songMode) {
      return sub;
    }

    // Only cap when the subtitle duration is unusually long (> 8s),
    // which indicates gap-bridging across a musical interlude.
    const LONG_SUBTITLE_MS = 8000;
    const SONG_SUBTITLE_HOLD_MS = 4000;
    const naturalDuration = sub.endTimeMs - sub.startTimeMs;
    if (
      naturalDuration > LONG_SUBTITLE_MS &&
      currentTimeMs - sub.startTimeMs > SONG_SUBTITLE_HOLD_MS
    ) {
      return null;
    }

    return sub;
  }, [currentTimeMs, podcast.subtitles, podcast.songMode]);

  // Find current article overlay based on time
  const currentArticle = useMemo(() => {
    return (
      podcast.articles.find(
        (a) => a.startTimeMs <= currentTimeMs && a.endTimeMs > currentTimeMs,
      ) ?? null
    );
  }, [currentTimeMs, podcast.articles]);

  // Find current visemes for each host
  const host1Viseme = useMemo(() => {
    return podcast.visemes.find(
      (v) =>
        v.speakerId === podcast.host1BotId &&
        v.startMs <= currentTimeMs &&
        v.startMs + v.durationMs > currentTimeMs,
    );
  }, [currentTimeMs, podcast.visemes, podcast.host1BotId]);

  const host2Viseme = useMemo(() => {
    return podcast.visemes.find(
      (v) =>
        v.speakerId === podcast.host2BotId &&
        v.startMs <= currentTimeMs &&
        v.startMs + v.durationMs > currentTimeMs,
    );
  }, [currentTimeMs, podcast.visemes, podcast.host2BotId]);

  // Start song mode when scene is ready: enable dance loops + beat nod + dynamic camera
  useEffect(() => {
    if (!sceneManager || !podcast.songMode || songModeStartedRef.current) {
      return;
    }
    songModeStartedRef.current = true;
    const bpm = podcast.songBpm ?? 120;
    const beatOffsetMs = podcast.beatOffsetMs ?? 0;
    sceneManager.startSongMode(
      bpm,
      beatOffsetMs,
      podcast.danceGroup,
      podcast.backgroundUri ?? undefined,
    );
    sceneManager.enableDynamicCamera();
  }, [
    sceneManager,
    podcast.songMode,
    podcast.songBpm,
    podcast.beatOffsetMs,
    podcast.danceGroup,
    podcast.backgroundUri,
  ]);

  // Song mode camera: auto-alternate between both models
  useEffect(() => {
    if (!podcast.songMode || !sceneManager) {
      return;
    }
    // Always pass null so DynamicCameraController auto-cycles between both avatars
    sceneManager.setDynamicCameraTarget(null);
  }, [podcast.songMode, sceneManager]);

  // Handle segment changes - update camera focus, mood, and listener reactions
  useEffect(() => {
    const segmentId = currentSegment
      ? `${currentSegment.speakerId}-${currentSegment.startTimeMs}`
      : null;

    if (segmentId === lastSegmentIdRef.current) {
      return;
    }
    lastSegmentIdRef.current = segmentId;

    // Debug: Log segment change with script directions
    if (currentSegment) {
      const segmentDuration =
        currentSegment.endTimeMs - currentSegment.startTimeMs;
      console.debug('[Podcast] Segment change', {
        segmentId,
        durationMs: segmentDuration,
        speakerId: currentSegment.speakerId,
        text: currentSegment.text.slice(0, 60) + '...',
        // Script directions from GPT-4
        cameraShot: currentSegment.cameraShot ?? 'normal',
        cameraEnergy: currentSegment.cameraEnergy ?? 'normal',
        listenerReaction: currentSegment.listenerReaction ?? 'nod',
        hasGestureHint: !!currentSegment.gestureHint,
      });
    } else {
      console.debug('[Podcast] Segment ended (no current segment)');
    }

    // Notify external listener
    onSegmentChange?.(currentSegment);

    if (!sceneManager || !currentSegment) {
      return;
    }

    // Determine speaker
    const isHost1 = currentSegment.speakerId === podcast.host1BotId;
    const speakerHost = isHost1 ? 'host1' : 'host2';
    const listenerHost = isHost1 ? 'host2' : 'host1';
    const segmentDuration =
      currentSegment.endTimeMs - currentSegment.startTimeMs;

    if (!podcast.songMode) {
      // Dialogue mode: script-directed camera
      const cameraShot = currentSegment.cameraShot ?? 'normal';
      const cameraEnergy = currentSegment.cameraEnergy ?? 'normal';

      // Don't switch camera for very short segments
      if (
        segmentDuration < MIN_SEGMENT_DURATION_FOR_CAMERA_SWITCH &&
        lastCameraFocusRef.current !== 'wide'
      ) {
        console.debug('[Podcast] Skipping camera switch for short segment', {
          segmentDuration,
          threshold: MIN_SEGMENT_DURATION_FOR_CAMERA_SWITCH,
          currentFocus: lastCameraFocusRef.current,
        });
      } else {
        console.debug('[Podcast] Setting camera focus from script', {
          speakerHost,
          cameraShot,
          cameraEnergy,
        });
        sceneManager.focusCameraFromScript(
          speakerHost,
          cameraShot,
          cameraEnergy,
        );
        lastCameraFocusRef.current = speakerHost;
      }
    }

    // Update speaker mood
    const activeAvatar = sceneManager.getAvatar(speakerHost);
    if (activeAvatar && !podcast.songMode) {
      // Dialogue: neutral mood, facial expressions come from visemes
      activeAvatar.setMood('neutral');
    }

    // Update listener with script-directed reaction (dialogue mode only)
    const listenerAvatar = sceneManager.getAvatar(listenerHost);
    if (listenerAvatar && !podcast.songMode) {
      const listenerReaction = currentSegment.listenerReaction ?? 'nod';
      // Set listener mood based on reaction type
      const listenerMood =
        listenerReaction === 'empathize'
          ? 'sad'
          : listenerReaction === 'shocked'
            ? 'fear'
            : listenerReaction === 'laugh'
              ? 'happy'
              : 'neutral';
      listenerAvatar.setMood(listenerMood);

      // Trigger listener reaction gesture from script direction
      const reactionGesture = mapReactionToGesture(listenerReaction);
      if (reactionGesture) {
        // Delay reaction to ~30% into the segment
        const reactionDelay = segmentDuration * 0.3;
        console.debug('[Podcast] Triggering listener reaction', {
          listenerHost,
          reaction: listenerReaction,
          gesture: reactionGesture,
          delayMs: reactionDelay,
        });
        setTimeout(() => {
          listenerAvatar.playGesture(reactionGesture);
        }, reactionDelay);
      } else {
        console.debug('[Podcast] No listener reaction gesture', {
          listenerHost,
          reaction: listenerReaction,
        });
      }
    }

    // Trigger expression animation if segment has an animation hint (dialogue mode only).
    // In song mode the dance loop handles all animation — gestures would interrupt it.
    if (!podcast.songMode && currentSegment.gestureHint && activeAvatar) {
      // Clear any pending animation timeout
      if (gestureTimeoutRef.current) {
        clearTimeout(gestureTimeoutRef.current);
        gestureTimeoutRef.current = null;
      }

      const animationDelay = (() => {
        switch (currentSegment.gestureHint.timing) {
          case 'start':
            return 200; // 200ms after segment starts
          case 'mid':
            return segmentDuration / 2; // Midpoint of segment
          case 'end':
            return segmentDuration - 500; // 500ms before segment ends
          default:
            return 200;
        }
      })();

      console.debug('[Podcast] Triggering gesture hint animation', {
        speakerHost,
        gesture: currentSegment.gestureHint.gesture,
        timing: currentSegment.gestureHint.timing,
        animationDelayMs: animationDelay,
      });

      gestureTimeoutRef.current = setTimeout(() => {
        // Use expression animations instead of pose-based gestures
        // Pick randomly between Dance and Expression categories for variety
        const category = Math.random() > 0.7 ? 'Dance' : 'Expression';
        console.debug('[Podcast] Playing gesture animation', {
          speakerHost,
          category,
        });
        void activeAvatar.playRandomAnimation(category);
        gestureTimeoutRef.current = null;
      }, animationDelay);
    } else if (!podcast.songMode && !currentSegment.gestureHint) {
      console.debug('[Podcast] No gesture hint for segment');
    }
  }, [
    currentSegment,
    sceneManager,
    podcast.host1BotId,
    podcast.songMode,
    onSegmentChange,
  ]);

  // Update avatar lip sync based on visemes
  useEffect(() => {
    if (!sceneManager) {
      return;
    }

    const host1Avatar = sceneManager.getAvatar('host1');
    const host2Avatar = sceneManager.getAvatar('host2');

    // Update host1 viseme
    if (host1Viseme && host1Avatar) {
      host1Avatar.showViseme({
        name: host1Viseme.name,
        durationMs: host1Viseme.durationMs,
        intensity: host1Viseme.intensity,
      });
    } else if (host1Avatar) {
      host1Avatar.resetLips();
    }

    // Update host2 viseme
    if (host2Viseme && host2Avatar) {
      host2Avatar.showViseme({
        name: host2Viseme.name,
        durationMs: host2Viseme.durationMs,
        intensity: host2Viseme.intensity,
      });
    } else if (host2Avatar) {
      host2Avatar.resetLips();
    }
  }, [host1Viseme, host2Viseme, sceneManager]);

  // RAF-based time tracking for smooth lip sync (60fps updates instead of ~250ms timeupdate)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isPlaying) {
      return;
    }

    let animFrameId: number;

    const tick = () => {
      setCurrentTimeMs(audio.currentTime * 1000);
      animFrameId = requestAnimationFrame(tick);
    };

    animFrameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animFrameId);
    };
  }, [isPlaying]);

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    // Timeupdate as fallback (RAF handles smooth updates when playing)
    const handleTimeUpdate = () => {
      setCurrentTimeMs(audio.currentTime * 1000);
    };

    const handlePlay = () => {
      setIsPlaying(true);
    };

    const handlePause = () => {
      setIsPlaying(false);
    };

    const handleCanPlay = () => {
      setIsLoaded(true);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTimeMs(0);
      // Clear browser media session indicator
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none';
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('ended', handleEnded);

    // Check if audio is already playable (event may have fired before listener attached)
    // readyState >= 3 means HAVE_FUTURE_DATA or HAVE_ENOUGH_DATA
    if (audio.readyState >= 3) {
      setIsLoaded(true);
    }

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  // Media Session API - sync browser media controls with playback state
  useEffect(() => {
    if (!('mediaSession' in navigator)) {
      return;
    }

    if (isPlaying) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: podcast.title,
        artist: 'Ugly News',
      });
      navigator.mediaSession.playbackState = 'playing';
    } else {
      navigator.mediaSession.playbackState = 'paused';
    }

    return () => {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.metadata = null;
    };
  }, [isPlaying, podcast.title]);

  // Toggle play/pause
  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (isPlaying) {
      audio.pause();
    } else {
      void audio.play();
    }
  }, [isPlaying]);

  // Seek to specific time
  const seekTo = useCallback((timeMs: number) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.currentTime = timeMs / 1000;
  }, []);

  // Seek to article by index
  const seekToArticle = useCallback(
    (index: number) => {
      const article = podcast.articles[index];
      if (article) {
        seekTo(article.startTimeMs);
      }
    },
    [podcast.articles, seekTo],
  );

  return {
    // Playback state
    isPlaying,
    isLoaded,
    currentTimeMs,
    durationMs: podcast.durationMs,

    // Current content
    currentSegment,
    currentSubtitle,
    currentArticle,

    // Controls
    togglePlayPause,
    seekTo,
    seekToArticle,

    // Refs
    audioRef,
  };
}

/**
 * Map listener reaction type to gesture name
 */
function mapReactionToGesture(
  reaction: PodcastListenerReaction,
): GestureName | null {
  switch (reaction) {
    case 'agree':
      return Math.random() > 0.5 ? 'thumbup-left' : 'thumbup-right';
    case 'shocked':
      return 'shrug';
    case 'laugh':
      // No specific laugh gesture, but could use ok or thumbup
      return Math.random() > 0.5 ? 'ok-left' : 'ok-right';
    case 'empathize':
      // Sympathetic nod
      return 'namaste';
    case 'nod':
      return Math.random() > 0.5 ? 'ok-left' : 'ok-right';
    case 'bored':
      // Bored shrug
      return 'shrug';
    default:
      return null;
  }
}
