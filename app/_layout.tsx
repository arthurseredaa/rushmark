import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as React from 'react';

import { AppProviders } from '@/ui/AppProviders';
import { SyncEngineHost } from '@/ui/SyncEngineHost';

export default function RootLayout(): React.ReactElement {
  return (
    <AppProviders>
      {/* Drains the pending-save queue on reconnect. Mounted once, at the root,
          so it keeps running as the user moves between screens (FR-035). */}
      <SyncEngineHost>
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
      </SyncEngineHost>
    </AppProviders>
  );
}
