/**
 * The editor. Player + metadata + markers + the checkmark.
 * FR-006…FR-009, FR-013…FR-019a, FR-022…FR-029a.
 */

import { Stack, useLocalSearchParams } from 'expo-router';
import * as React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FramePlayer, FramePlayerView, toDomainProbe } from '@/modules/frame-player/src/index';
import type { Marker, Probe } from '@/domain/canonical';
import { framesToTimecode } from '@/domain/timecode';
import { videos, type VideoRow } from '@/data/db/repositories';
import { MarkerList } from '@/features/editor/MarkerList';
import { MetadataEditor } from '@/features/editor/MetadataEditor';
import { addMarker, deleteMarker, updateMarker } from '@/features/editor/markerActions';
import { loadVideo, type LoadedMetadata } from '@/features/editor/loadVideo';
import { markerGate } from '@/features/editor/rateGate';
import { rememberProbe, saveVideo } from '@/features/editor/saveVideo';
import {
  formatBytes,
  inspect,
  startDownload,
  type OpenState,
} from '@/features/library/openVideo';
import { useConnectivity, useDatabase, useDatabaseReady, useDrive } from '@/ui/AppProviders';
import { Banner, Button, Loading } from '@/ui/components';
import { spacing, theme } from '@/ui/theme';

export default function VideoScreen(): React.ReactElement {
  const ready = useDatabaseReady();
  if (!ready) return <Loading />;
  return <Screen />;
}

type SaveState = 'clean' | 'dirty' | 'saving';

function Screen(): React.ReactElement {
  const { videoId } = useLocalSearchParams<{ videoId: string }>();
  const db = useDatabase();
  const drive = useDrive();
  const { online } = useConnectivity();

  const [video, setVideo] = React.useState<VideoRow | null>(null);
  const [open, setOpen] = React.useState<OpenState | null>(null);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [downloader, setDownloader] = React.useState<{ cancel: () => Promise<void> } | null>(null);

  const [player, setPlayer] = React.useState<FramePlayer | null>(null);
  const [probe, setProbe] = React.useState<Probe | null>(null);
  const [frame, setFrame] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);

  const [loaded, setLoaded] = React.useState<LoadedMetadata | null>(null);
  const [comments, setComments] = React.useState('');
  const [keywords, setKeywords] = React.useState<string[]>([]);
  const [markers, setMarkers] = React.useState<Marker[]>([]);
  const [saveState, setSaveState] = React.useState<SaveState>('clean');

  // -- load the video row + its metadata ------------------------------------

  React.useEffect(() => {
    if (!videoId) return;
    let cancelled = false;

    void (async () => {
      const row = await videos.get(db, videoId);
      if (cancelled || !row) return;
      setVideo(row);
      if (row.probe) setProbe(row.probe);

      const state = await inspect(db, {
        videoId: row.id,
        folderId: row.folderId,
        filename: row.filename,
        sizeBytes: row.sizeBytes,
      });
      if (!cancelled) setOpen(state);

      const meta = await loadVideo(db, drive, {
        videoId: row.id,
        folderId: row.folderId,
        filename: row.filename,
      });
      if (cancelled) return;
      setLoaded(meta);
      setComments(meta.comments);
      setKeywords(meta.keywords);
      setMarkers(meta.markers);
      setSaveState('clean');
    })();

    return () => {
      cancelled = true;
    };
  }, [db, drive, videoId]);

  // -- attach the player once the file is on disk ---------------------------

  React.useEffect(() => {
    if (open?.kind !== 'cached') return;
    let cancelled = false;
    let handle: FramePlayer | null = null;

    void (async () => {
      try {
        const p = await FramePlayer.load(open.path);
        if (cancelled) {
          void p.unload();
          return;
        }
        handle = p;
        setPlayer(p);
        const domainProbe = toDomainProbe(p.probeResult);
        setProbe(domainProbe);
        if (video) void rememberProbe(db, video.id, domainProbe);
      } catch (err) {
        Alert.alert('Could not open video', err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      void handle?.unload();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.kind, open?.kind === 'cached' ? open.path : null]);

  const markDirty = (): void => setSaveState('dirty');

  // -- frame transport ------------------------------------------------------

  /**
   * Every one of these takes the frame the native side reports it LANDED on,
   * never the frame we asked for. Principle I: the request is a request.
   */
  const seek = async (target: number): Promise<void> => {
    if (!player || !probe) return;
    const clamped = Math.max(0, Math.min(target, probe.durationFrames - 1));
    const landed = await player.seekToFrame(clamped);
    setFrame(landed);
  };

  const step = async (count: number): Promise<void> => {
    if (!player) return;
    const landed = await player.stepByFrames(count);
    setFrame(landed);
  };

  const togglePlay = async (): Promise<void> => {
    if (!player) return;
    if (playing) {
      await player.pause();
      setPlaying(false);
      setFrame(await player.currentFrame());
    } else {
      await player.play();
      setPlaying(true);
    }
  };

  // -- download -------------------------------------------------------------

  const beginDownload = (): void => {
    if (!video) return;

    const go = (): void => {
      setProgress(0);
      const handle = startDownload(db, {
        videoId: video.id,
        folderId: video.folderId,
        filename: video.filename,
        driveFileId: video.driveFileId,
        onProgress: (p) => setProgress(p.fraction),
      });
      setDownloader(handle);

      handle.promise
        .then((path) => setOpen({ kind: 'cached', path }))
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          if (!/cancelled/i.test(message)) Alert.alert('Download failed', message);
        })
        .finally(() => {
          setProgress(null);
          setDownloader(null);
        });
    };

    if (open?.kind === 'needs-download' && open.onCellular) {
      // FR-006a: ask BEFORE spending their data, not after.
      Alert.alert(
        'Download over cellular?',
        `This video is ${formatBytes(open.sizeBytes)} and you are not on Wi-Fi.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Download', onPress: go },
        ],
      );
      return;
    }
    go();
  };

  // -- save -----------------------------------------------------------------

  const handleSave = async (): Promise<void> => {
    if (!video || !probe) return;
    setSaveState('saving');

    try {
      const outcome = await saveVideo(db, drive, {
        videoId: video.id,
        filename: video.filename,
        folderId: video.folderId,
        driveFileId: video.driveFileId,
        probe,
        comments,
        keywords,
        markers,
        unknownFields: loaded?.unknownFields ?? {},
      });

      setSaveState('clean');

      switch (outcome.status) {
        case 'queued':
          Alert.alert(
            'Saved — will publish when you reconnect',
            "You're offline, so this is queued on the device. It publishes automatically and " +
              "won't ask you again.",
          );
          break;
        case 'cleared-queued':
          Alert.alert(
            'Cleared — will publish when you reconnect',
            'The sidecars will be removed from Drive once you are back online.',
          );
          break;
        case 'cleared':
          Alert.alert('Metadata cleared', 'The sidecars have been removed from Drive.');
          break;
        default:
          break;
      }
    } catch (err) {
      setSaveState('dirty');
      Alert.alert(
        'Could not publish to Drive',
        `${err instanceof Error ? err.message : String(err)}\n\nYour work is saved on this device ` +
          'and stays queued — it will retry automatically.',
      );
    }
  };

  // -- render ---------------------------------------------------------------

  if (!video) return <Loading />;

  const gate = markerGate(probe);
  const rate = probe?.frameRate ?? { num: 24, den: 1 };
  const tcBase = probe?.sourceTimecodeFrames ?? 0;

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: video.filename,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save metadata"
              accessibilityState={{ disabled: saveState !== 'dirty' }}
              disabled={saveState !== 'dirty'}
              onPress={() => void handleSave()}
              hitSlop={10}
            >
              <Text
                style={[
                  styles.check,
                  saveState === 'dirty' ? styles.checkActive : styles.checkIdle,
                ]}
              >
                {saveState === 'saving' ? '…' : '✓'}
              </Text>
            </Pressable>
          ),
        }}
      />

      <View style={styles.playerBox}>
        {open?.kind === 'cached' && player ? (
          <FramePlayerView handleId={player.handleId} style={styles.player} />
        ) : open?.kind === 'needs-download' ? (
          <View style={styles.placeholder}>
            {progress !== null ? (
              <>
                <Text style={styles.placeholderText}>
                  Downloading… {Math.round((progress ?? 0) * 100)}%
                </Text>
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={() => void downloader?.cancel()}
                />
              </>
            ) : (
              <>
                <Text style={styles.placeholderText}>
                  {formatBytes(open.sizeBytes)} — download to play and mark up
                </Text>
                <Button label="Download" onPress={beginDownload} />
              </>
            )}
          </View>
        ) : open?.kind === 'unavailable' ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>{open.reason}</Text>
          </View>
        ) : (
          <Loading />
        )}
      </View>

      {open?.kind === 'cached' && probe ? (
        <View style={styles.transport}>
          <Text style={styles.timecode}>{framesToTimecode(tcBase + frame, rate)}</Text>
          <View style={styles.transportButtons}>
            <TransportButton label="-10" onPress={() => void step(-10)} />
            <TransportButton label="◀︎" onPress={() => void step(-1)} />
            <TransportButton label={playing ? '❚❚' : '▶'} onPress={() => void togglePlay()} wide />
            <TransportButton label="▶︎" onPress={() => void step(1)} />
            <TransportButton label="+10" onPress={() => void step(10)} />
          </View>
          <Text style={styles.frameLabel}>
            Frame {frame} of {probe.durationFrames - 1}
          </Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {loaded?.warnings.length ? (
          <Banner
            tone="warning"
            title="This sidecar was read with warnings"
            detail={loaded.warnings.map((w) => `${w.field}: ${w.message}`).join('\n')}
          />
        ) : null}

        {loaded?.pending ? (
          <Banner
            tone="info"
            title="A save for this video is waiting to publish"
            detail="Showing your unpublished version. It publishes automatically when you reconnect."
          />
        ) : null}

        {!online ? <Banner tone="info" title="Offline — your edits are saved on the device" /> : null}

        <MetadataEditor
          comments={comments}
          keywords={keywords}
          onCommentsChange={(v) => {
            setComments(v);
            markDirty();
          }}
          onKeywordsChange={(v) => {
            setKeywords(v);
            markDirty();
          }}
        />

        <View style={styles.markerHeader}>
          <Text style={styles.sectionTitle}>Markers</Text>
          {gate.allowed && open?.kind === 'cached' ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMarkers((m) => addMarker(m, { frame }));
                markDirty();
              }}
            >
              <Text style={styles.addMarker}>+ Add at {framesToTimecode(tcBase + frame, rate)}</Text>
            </Pressable>
          ) : null}
        </View>

        {!gate.allowed ? (
          <Banner tone="warning" title={gate.reason} detail={gate.detail} />
        ) : (
          <MarkerList
            markers={markers}
            rate={rate}
            sourceTimecodeFrames={probe?.sourceTimecodeFrames ?? null}
            currentFrame={frame}
            onSeek={(f) => void seek(f)}
            onChange={(id, patch) => {
              setMarkers((m) => updateMarker(m, id, patch));
              markDirty();
            }}
            onDelete={(id) => {
              setMarkers((m) => deleteMarker(m, id));
              markDirty();
            }}
          />
        )}

        {probe ? (
          <Text style={styles.tech}>
            {probe.codec.toUpperCase()} · {probe.width}×{probe.height} ·{' '}
            {probe.frameRate.num}/{probe.frameRate.den} fps · {probe.durationFrames} frames
            {probe.sourceTimecodeFrames !== null
              ? ` · starts ${framesToTimecode(probe.sourceTimecodeFrames, rate)}`
              : ' · no source timecode'}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function TransportButton({
  label,
  onPress,
  wide = false,
}: {
  label: string;
  onPress: () => void;
  wide?: boolean;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.transportButton,
        wide && styles.transportButtonWide,
        pressed && styles.transportPressed,
      ]}
    >
      <Text style={styles.transportLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  playerBox: { aspectRatio: 16 / 9, backgroundColor: '#000' },
  player: { flex: 1 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  placeholderText: { color: theme.textDim, fontSize: 14, textAlign: 'center' },
  transport: {
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  timecode: { color: theme.text, fontSize: 22, fontWeight: '600', fontVariant: ['tabular-nums'] },
  transportButtons: { flexDirection: 'row', gap: spacing.sm },
  transportButton: {
    backgroundColor: theme.surfaceRaised,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    minWidth: 52,
    alignItems: 'center',
  },
  transportButtonWide: { minWidth: 72, backgroundColor: theme.accent },
  transportPressed: { opacity: 0.6 },
  transportLabel: { color: theme.text, fontSize: 15, fontWeight: '600' },
  frameLabel: { color: theme.textDim, fontSize: 12, fontVariant: ['tabular-nums'] },
  body: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  sectionTitle: { color: theme.text, fontSize: 17, fontWeight: '700' },
  markerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  addMarker: { color: theme.accent, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  check: { fontSize: 26, fontWeight: '700', paddingHorizontal: spacing.sm },
  checkActive: { color: theme.accent },
  checkIdle: { color: theme.border },
  tech: {
    color: theme.textDim,
    fontSize: 11,
    marginTop: spacing.xl,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
});
