/**
 * The single source of truth for online/offline.
 *
 * Everything that needs to know whether the network is usable asks here, so the
 * app has one definition of "online" rather than several that disagree.
 */

import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

export type Connectivity = {
  /** Usable for Drive calls: connected AND the internet is actually reachable. */
  online: boolean;
  /** Cellular — triggers the download confirmation (FR-006a). */
  cellular: boolean;
};

/**
 * `isInternetReachable` can be null while NetInfo is still deciding. Treating
 * null as offline is the safe read: the cost of a wrong "offline" is that a save
 * queues and publishes a moment later, which is the designed path anyway. The
 * cost of a wrong "online" is a failure surfaced to the user for no reason.
 */
const fromState = (state: NetInfoState): Connectivity => ({
  online: Boolean(state.isConnected) && state.isInternetReachable !== false,
  cellular: state.type === 'cellular',
});

export async function current(): Promise<Connectivity> {
  return fromState(await NetInfo.fetch());
}

export function subscribe(listener: (c: Connectivity) => void): () => void {
  return NetInfo.addEventListener((state) => listener(fromState(state)));
}

/**
 * Fire `listener` on each offline -> online transition.
 *
 * The sync engine's trigger (FR-035). Edge-triggered, not level-triggered: a
 * listener that fired on every NetInfo event would re-drain the queue on every
 * signal-strength change.
 */
export function onReconnect(listener: () => void): () => void {
  let wasOnline: boolean | null = null;

  return subscribe(({ online }) => {
    if (wasOnline === false && online) listener();
    wasOnline = online;
  });
}
