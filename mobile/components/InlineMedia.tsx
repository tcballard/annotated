// Inline playback in native lists, players-on-demand: cards render the
// cheap form (poster frame, peak waveform) and only mount a real player
// when tapped, so a feed of clips costs nothing until someone presses
// play. Video uses expo-video with native controls; audio uses expo-audio
// with the played portion painted over the peaks — the same visual the
// web draws.

import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type ColorValue } from 'react-native';
import Icon from './Icon';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { formatTime } from '../lib/core/feed-item';
import { ink, meta, tokens } from '../lib/tokens';

// Bars from the server-extracted peaks (0..100); `progress` (0..1) paints
// the played portion in ink. The played copy is clipped by a window sized
// from the measured wave width, so bars line up exactly underneath.
export const Waveform = ({ peaks, progress = 0 }: { peaks: number[] | null; progress?: number }) => {
  const [width, setWidth] = useState(0);
  if (!Array.isArray(peaks) || !peaks.length) return null;
  const bars = (color: ColorValue | string) => peaks.map((peak, index) => (
    <View key={index} style={[styles.waveBar, { backgroundColor: color, height: `${Math.max(8, Math.min(100, Number(peak) || 0))}%` }]} />
  ));
  return (
    <View style={styles.wave} accessibilityElementsHidden onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <View style={styles.waveRow}>{bars(tokens.border)}</View>
      {progress > 0 && width > 0 ? (
        <View style={[styles.wavePlayed, { width: Math.min(width, progress * width) }]}>
          <View style={[styles.waveRow, styles.waveRowClipped, { width }]}>{bars(tokens['ink-soft'])}</View>
        </View>
      ) : null}
    </View>
  );
};

const PlayingVideo = ({ uri }: { uri: string }) => {
  const player = useVideoPlayer(uri, (instance) => {
    instance.play();
  });
  return <VideoView player={player} style={styles.video} nativeControls contentFit="contain" />;
};

// Poster + CLIP badge until tapped; then the real player, playing.
export const InlineClip = ({ uri, posterUri, seconds }: { uri: string; posterUri: string; seconds: number }) => {
  const [playing, setPlaying] = useState(false);
  if (playing) {
    return <View style={styles.media}><PlayingVideo uri={uri} /></View>;
  }
  return (
    <Pressable style={styles.media} onPress={() => setPlaying(true)} accessibilityLabel="Play clip">
      {posterUri ? <Image source={{ uri: posterUri }} style={styles.poster} resizeMode="cover" /> : <View style={[styles.poster, styles.posterEmpty]} />}
      <View style={styles.playButton}><Icon name="play" size={22} color="#fff" /></View>
      <Text style={styles.cliptag}>CLIP</Text>
      <Text style={styles.badge}>{formatTime(seconds)} · 240p</Text>
    </Pressable>
  );
};

const PlayingAudio = ({ uri, peaks }: { uri: string; peaks: number[] | null }) => {
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);
  const progress = status.duration > 0 ? status.currentTime / status.duration : 0;
  const toggle = () => {
    if (status.playing) player.pause();
    else {
      // Replay from the top once a run finished.
      if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) player.seekTo(0);
      player.play();
    }
  };
  return (
    <>
      <Pressable onPress={toggle} hitSlop={8} style={styles.playToggle} accessibilityLabel={status.playing ? 'Pause' : 'Play'}>
        <Icon name={status.playing ? 'pause' : 'play'} size={15} color="#fff" />
      </Pressable>
      <Waveform peaks={peaks} progress={progress} />
      <Text style={styles.audioTime}>{formatTime(status.duration > 0 ? Math.max(0, status.duration - status.currentTime) : 0)}</Text>
    </>
  );
};

// Waveform + duration until tapped; then a live player with the played
// portion painted across the peaks.
export const InlineAudio = ({ uri, peaks, seconds, icon }: { uri: string; peaks: number[] | null; seconds: number; icon?: 'mic' }) => {
  const [started, setStarted] = useState(false);
  if (started) {
    return (
      <View style={styles.audioRow}>
        <PlayingAudio uri={uri} peaks={peaks} />
      </View>
    );
  }
  return (
    <Pressable style={styles.audioRow} onPress={() => setStarted(true)} accessibilityLabel="Play audio">
      <View style={styles.playToggle}><Icon name="play" size={15} color="#fff" /></View>
      {icon === 'mic' ? <Icon name="mic" size={14} color={meta} /> : null}
      <Waveform peaks={peaks} />
      {seconds ? <Text style={styles.audioTime}>{formatTime(seconds)}</Text> : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  media: { marginTop: 8, borderRadius: 10, overflow: 'hidden', position: 'relative', backgroundColor: tokens.soft },
  poster: { width: '100%', aspectRatio: 16 / 10 },
  posterEmpty: { backgroundColor: tokens['chrome-dark'] },
  video: { width: '100%', aspectRatio: 16 / 10, backgroundColor: '#000' },
  playButton: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -24,
    marginTop: -24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(38,41,47,.78)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cliptag: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(38,41,47,.82)', color: '#fff', fontSize: 10, fontWeight: '700', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, overflow: 'hidden' },
  badge: { position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(38,41,47,.82)', color: '#fff', fontSize: 11, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, overflow: 'hidden' },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  playToggle: { width: 28, height: 28, borderRadius: 14, backgroundColor: ink, alignItems: 'center', justifyContent: 'center' },
  wave: { flex: 1, height: 34, position: 'relative', overflow: 'hidden' },
  waveRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 1.5, height: '100%', width: '100%' },
  waveRowClipped: { position: 'absolute', top: 0, left: 0 },
  wavePlayed: { position: 'absolute', top: 0, left: 0, bottom: 0, overflow: 'hidden' },
  waveBar: { flex: 1, minWidth: 1.5, borderRadius: 1 },
  audioTime: { fontSize: 11, color: meta, fontVariant: ['tabular-nums'] },
});
