import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppProviders } from '@/ui/AppProviders';
import { DownloadHost } from '@/ui/DownloadHost';
import { SyncEngineHost } from '@/ui/SyncEngineHost';

export default function RootLayout(): React.ReactElement {
  return (
    // Without this provider every `useSafeAreaInsets()` reads zero and every
    // SafeAreaView is a plain View — which is how the folder picker's Cancel
    // button ended up sitting under the status bar clock.
    <SafeAreaProvider>
      <AppProviders>
        {/* Drains the pending-save queue on reconnect. Mounted once, at the root,
            so it keeps running as the user moves between screens (FR-035). */}
        <SyncEngineHost>
          {/* Keeps background downloads running and reporting across navigation,
              and fires the "ready" notification when one lands (FR-006e). */}
          <DownloadHost>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: '#111' },
                headerTintColor: '#fff',
                contentStyle: { backgroundColor: '#111' },
              }}
            >
              <Stack.Screen name="index" options={{ title: 'Rushmark' }} />
              <Stack.Screen name="folder/[folderId]" options={{ title: 'Videos' }} />
              <Stack.Screen name="video/[videoId]" options={{ title: '' }} />
            </Stack>
          </DownloadHost>
        </SyncEngineHost>
      </AppProviders>
    </SafeAreaProvider>
  );
}
