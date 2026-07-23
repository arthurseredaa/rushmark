/**
 * The editor. Player + metadata + markers + the checkmark.
 * FR-006…FR-009, FR-013…FR-019a, FR-022…FR-029a.
 */

import { Stack, useLocalSearchParams } from 'expo-router';
import * as React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  FramePlayer,
  FramePlayerView,
  onFrameChanged,
  toDomainProbe,
} from '@/modules/frame-player/src/index';
import type { Marker, Probe } from '@/domain/canonical';
import { framesToClock, framesToTimecode } from '@/domain/timecode';
import { videos, type VideoRow } from '@/data/db/repositories';
import { MarkerList } from '@/features/editor/MarkerList';
import { Scrubber } from '@/features/editor/Scrubber';
import { MetadataEditor } from '@/features/editor/MetadataEditor';
import { addMarker, deleteMarker, updateMarker } from '@/features/editor/markerActions';
import { loadVideo, type LoadedMetadata } from '@/features/editor/loadVideo';
import { markerGate, type MarkerGate } from '@/features/editor/rateGate';
import { rememberProbe, saveVideo } from '@/features/editor/saveVideo';
import {
  formatBytes,
  inspect,
  streamSource,
  type OpenState,
} from '@/features/library/openVideo';
import {
  useConnectivity,
  useDatabase,
  useDatabaseReady,
  useDrive,
} from '@/ui/AppProviders';
import { Banner, Button, Loading } from '@/ui/components';
import { useDownload, useDownloads } from '@/ui/DownloadHost';
import { spacing, theme } from '@/ui/theme';

export default function VideoScreen(): React.ReactElement {
  const ready = useDatabaseReady();
  if (!ready) return <Loading />;
  return <Screen />;
}

type SaveState = 'clean' | 'dirty' | 'saving';

type PlayerSource =
  { kind: 'file'; path: string } | { kind: 'stream'; driveFileId: string };

function Screen(): React.ReactElement {
  const { videoId } = useLocalSearchParams<{ videoId: string }>();
  const db = useDatabase();
  const drive = useDrive();
  const { online } = useConnectivity();
  const insets = useSafeAreaInsets();

  const [video, setVideo] = React.useState<VideoRow | null>(null);
  const [open, setOpen] = React.useState<OpenState | null>(null);

  // Downloads live in a root-level manager so they survive leaving this screen
  // and report back with a notification (FR-006e). `progress` is just a view of
  // this video's entry in that manager.
  const downloads = useDownloads();
  const download = useDownload(video?.id);
  const progress = download?.phase === 'downloading' ? download.fraction : null;

  const [player, setPlayer] = React.useState<FramePlayer | null>(null);
  const [probe, setProbe] = React.useState<Probe | null>(null);
  const [frame, setFrame] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [streamError, setStreamError] = React.useState<string | null>(null);

  const [loaded, setLoaded] = React.useState<LoadedMetadata | null>(null);
  const [comments, setComments] = React.useState('');
  const [keywords, setKeywords] = React.useState<string[]>([]);
  const [description, setDescription] = React.useState('');
  const [people, setPeople] = React.useState<string[]>([]);
  const [goodTake, setGoodTake] = React.useState(false);
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
      setDescription(meta.description);
      setPeople(meta.people);
      setGoodTake(meta.goodTake);
      setMarkers(meta.markers);
      setSaveState('clean');
    })();

    return () => {
      cancelled = true;
    };
  }, [db, drive, videoId]);

  // -- attach the player ----------------------------------------------------

  /**
   * A downloaded copy is preferred, but not required to watch (FR-006c).
   * Streaming gets the user to a picture immediately; downloading is what
   * unlocks markers, because only a local file can be probed exactly.
   */
  const source: PlayerSource | null =
    open?.kind === 'cached'
      ? { kind: 'file', path: open.path }
      : open?.kind === 'needs-download' && online && video && !streamError
        ? { kind: 'stream', driveFileId: video.driveFileId }
        : null;

  const sourceKey = source
    ? `${source.kind}:${source.kind === 'file' ? source.path : source.driveFileId}`
    : null;

  React.useEffect(() => {
    if (!source) return;
    let cancelled = false;
    let handle: FramePlayer | null = null;
    const local = source;

    void (async () => {
      try {
        let p: FramePlayer;
        if (local.kind === 'file') {
          p = await FramePlayer.load(local.path);
        } else {
          const { url, headers } = await streamSource(local.driveFileId);
          p = await FramePlayer.loadRemote(url, headers);
        }
        if (cancelled) {
          void p.unload();
          return;
        }
        handle = p;
        setPlayer(p);
        setFrame(0);

        const domainProbe = toDomainProbe(p.probeResult);
        if (local.kind === 'file') {
          setProbe(domainProbe);
          if (video) void rememberProbe(db, video.id, domainProbe);
        } else {
          // A shallow probe is worse evidence than one we already have. It must
          // never overwrite the stored technical record, and is never persisted:
          // its rateMode is "unknown" by construction, not by measurement.
          setProbe((prev) => prev ?? domainProbe);
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        if (local.kind === 'stream') {
          // Fall back to the download path rather than dead-ending the screen.
          setStreamError(message);
        } else {
          Alert.alert('Could not open video', message);
        }
      }
    })();

    return () => {
      cancelled = true;
      setPlayer(null);
      setPlaying(false);
      void handle?.unload();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  const markDirty = (): void => setSaveState('dirty');

  const streaming = player?.streaming ?? false;

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

  // -- timeline -------------------------------------------------------------

  /**
   * One scrub in flight at a time. A drag emits move events far faster than a
   * seek completes, and queuing them all makes the picture lag the finger by
   * seconds — dropping the intermediate ones is what makes it feel attached.
   */
  const scrubbing = React.useRef(false);
  const dragging = React.useRef(false);

  const handleScrub = (target: number): void => {
    dragging.current = true;
    if (!player || scrubbing.current) return;
    scrubbing.current = true;
    void player
      .scrubToFrame(target)
      .catch(() => {})
      .finally(() => {
        scrubbing.current = false;
      });
  };

  /**
   * Settle the drag. On a downloaded file this is an exact, zero-tolerance seek,
   * so the frame the user ends on is one they can place a marker at. A streamed
   * handle has no such guarantee to offer and does not pretend to — markers are
   * gated for it anyway.
   */
  const handleCommit = (target: number): void => {
    dragging.current = false;
    if (!player) return;
    void (async () => {
      try {
        const landed = streaming
          ? await player.scrubToFrame(target)
          : await player.seekToFrame(target);
        setFrame(landed);
      } catch {
        /* the position simply stays where it was */
      }
    })();
  };

  /** Keep the timeline moving during playback, without fighting a drag. */
  React.useEffect(() => {
    if (!player) return;
    const sub = onFrameChanged((payload) => {
      if (payload.handleId !== player.handleId) return;
      if (dragging.current || scrubbing.current) return;
      setFrame(payload.frame);
    });
    return () => sub.remove();
  }, [player]);

  // -- download -------------------------------------------------------------

  const beginDownload = (): void => {
    if (!video) return;

    const go = (): void => {
      // Hand off to the root manager; it keeps running if the user leaves.
      downloads.start({
        videoId: video.id,
        folderId: video.folderId,
        filename: video.filename,
        driveFileId: video.driveFileId,
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

  /**
   * React to a download that finished — whether it finished while this screen
   * was open or while the user was elsewhere (in which case the notification
   * brought them back here). Flip to the cached source and clear the manager
   * entry so a later re-open starts fresh.
   */
  React.useEffect(() => {
    if (!video || !download) return;
    if (download.phase === 'done' && download.path) {
      setOpen({ kind: 'cached', path: download.path });
      downloads.dismiss(video.id);
    } else if (download.phase === 'failed') {
      Alert.alert('Download failed', download.error ?? 'The download could not finish.');
      downloads.dismiss(video.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [download?.phase, download?.path, video?.id]);

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
        description,
        people,
        goodTake,
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

  /**
   * Markers need the original on disk. A streamed handle is probed shallowly on
   * purpose, so its rate is unconfirmed by construction — saying "frame rate
   * could not be confirmed" would be technically true and completely unhelpful.
   * Name the actual condition and the actual remedy.
   */
  const gate: MarkerGate =
    open?.kind === 'cached'
      ? markerGate(probe)
      : {
          allowed: false,
          reason: 'Download this video to place markers',
          detail:
            'The preview streams straight from Drive, which is enough to watch and to write ' +
            'comments and keywords. Placing a marker means guaranteeing the exact frame, and ' +
            'that needs the original file on this device.',
        };

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
        {player ? (
          <FramePlayerView handleId={player.handleId} style={styles.player} />
        ) : open?.kind === 'needs-download' ? (
          <View style={styles.placeholder}>
            {progress !== null ? (
              <>
                <Text style={styles.placeholderText}>
                  Downloading… {Math.round((progress ?? 0) * 100)}%
                  {'\n'}You can leave — we’ll notify you when it’s ready.
                </Text>
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={() => void downloads.cancel(video.id)}
                />
              </>
            ) : streamError ? (
              <>
                <Text style={styles.placeholderText}>
                  Could not stream this video ({streamError}). Download it to play and
                  mark up — {formatBytes(open.sizeBytes)}.
                </Text>
                <Button label="Download" onPress={beginDownload} />
              </>
            ) : (
              <Loading label="Starting preview…" />
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

      {player && probe ? (
        <View style={styles.transport}>
          <Scrubber
            frame={frame}
            durationFrames={probe.durationFrames}
            onScrub={handleScrub}
            onCommit={handleCommit}
          />

          {/* One compact status line replaces the old stacked timecode + clocks
              + frame label, so the pinned transport eats far less height. */}
          <View style={styles.statusRow}>
            <Text style={styles.status} numberOfLines={1}>
              {streaming
                ? 'Streaming preview — not downloaded'
                : `TC ${framesToTimecode(tcBase + frame, rate)} · Frame ${frame}/${
                    probe.durationFrames - 1
                  }`}
            </Text>
            <Text style={styles.clock}>
              {framesToClock(frame, rate)} / {framesToClock(Math.max(0, probe.durationFrames - 1), rate)}
            </Text>
          </View>

          <View style={styles.transportButtons}>
            {/* Frame stepping is withheld while streaming — not to nag, but
                because a zero-tolerance seek over the network takes seconds and
                the result cannot be trusted to a frame anyway. */}
            {streaming ? null : (
              <>
                <TransportButton label="-10" onPress={() => void step(-10)} />
                <TransportButton label="◀︎" onPress={() => void step(-1)} />
              </>
            )}
            <TransportButton
              label={playing ? '❚❚' : '▶'}
              onPress={() => void togglePlay()}
              wide
            />
            {streaming ? null : (
              <>
                <TransportButton label="▶︎" onPress={() => void step(1)} />
                <TransportButton label="+10" onPress={() => void step(10)} />
              </>
            )}
          </View>

          {streaming && open?.kind === 'needs-download' ? (
            <View style={styles.streamBar}>
              <Text style={styles.streamBarText} numberOfLines={1}>
                {progress !== null
                  ? `Downloading… ${Math.round(progress * 100)}%`
                  : `Download ${formatBytes(open.sizeBytes)} to step frames and mark up.`}
              </Text>
              {progress !== null ? (
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={() => void downloads.cancel(video.id)}
                />
              ) : (
                <Button label="Download" variant="secondary" onPress={beginDownload} />
              )}
            </View>
          ) : null}
        </View>
      ) : null}

      <ScrollView
        style={styles.bodyScroll}
        contentContainerStyle={[styles.body, { paddingBottom: spacing.xl + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
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

        {!online ? (
          <Banner tone="info" title="Offline — your edits are saved on the device" />
        ) : null}

        <MetadataEditor
          comments={comments}
          keywords={keywords}
          description={description}
          people={people}
          goodTake={goodTake}
          onCommentsChange={(v) => {
            setComments(v);
            markDirty();
          }}
          onKeywordsChange={(v) => {
            setKeywords(v);
            markDirty();
          }}
          onDescriptionChange={(v) => {
            setDescription(v);
            markDirty();
          }}
          onPeopleChange={(v) => {
            setPeople(v);
            markDirty();
          }}
          onGoodTakeChange={(v) => {
            setGoodTake(v);
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
              <Text style={styles.addMarker}>
                + Add at {framesToTimecode(tcBase + frame, rate)}
              </Text>
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
            {probe.frameRate.num}/{probe.frameRate.den} fps · {probe.durationFrames}{' '}
            frames
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
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  placeholderText: { color: theme.textDim, fontSize: 14, textAlign: 'center' },
  transport: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: 'stretch',
    gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  status: {
    flex: 1,
    color: theme.textDim,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  clock: { color: theme.textDim, fontSize: 12, fontVariant: ['tabular-nums'] },
  transportButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  transportButton: {
    backgroundColor: theme.surfaceRaised,
    borderRadius: 8,
    paddingVertical: spacing.xs,
    minWidth: 44,
    alignItems: 'center',
  },
  transportButtonWide: { minWidth: 64, backgroundColor: theme.accent },
  transportPressed: { opacity: 0.6 },
  transportLabel: { color: theme.text, fontSize: 15, fontWeight: '600' },
  streamBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  streamBarText: { flex: 1, color: theme.textDim, fontSize: 12, lineHeight: 16 },
  bodyScroll: { flex: 1 },
  body: { padding: spacing.lg },
  sectionTitle: { color: theme.text, fontSize: 17, fontWeight: '700' },
  markerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  addMarker: {
    color: theme.accent,
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
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
