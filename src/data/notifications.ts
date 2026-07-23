/**
 * Local notifications for finished background downloads (FR-006e).
 *
 * Only local notifications — no push server, no tokens, consistent with the
 * client-only constitution (NFR-2). Because the download runs in-app (a full
 * quit stops it), the notification is usually delivered while Rushmark is
 * foregrounded, so the handler below must opt in to showing a banner even then;
 * iOS suppresses foreground notifications by default.
 */

import * as Notifications from 'expo-notifications';

let configured = false;

/** Show finished-download banners even while the app is in the foreground. */
function configureHandler(): void {
  if (configured) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  configured = true;
}

/**
 * Ask for permission once, up front. A refusal is not fatal: downloads still
 * work, the user just won't get the "it's ready" nudge. Returns whether granted.
 */
export async function ensurePermission(): Promise<boolean> {
  configureHandler();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/** Present the "your clip is ready" notification. `videoId` rides along for taps. */
export async function notifyDownloadComplete(input: {
  videoId: string;
  filename: string;
}): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Download ready',
        body: `${input.filename} is downloaded — markers are ready.`,
        data: { videoId: input.videoId },
      },
      trigger: null, // deliver now
    });
  } catch {
    // A notification is a courtesy; never let its failure surface as an error on
    // a download that actually succeeded.
  }
}

/**
 * Route a tapped notification to its video. Returns an unsubscribe function.
 * `onOpen` receives the videoId carried in the notification's data.
 */
export function onNotificationOpened(onOpen: (videoId: string) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const videoId = response.notification.request.content.data?.videoId;
    if (typeof videoId === 'string') onOpen(videoId);
  });
  return () => sub.remove();
}
