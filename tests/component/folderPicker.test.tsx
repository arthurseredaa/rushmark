import { fireEvent, render } from '@testing-library/react-native';
import * as React from 'react';

import { listFolders } from '@/data/drive/files';
import { FolderPicker } from '@/features/folders/folderPicker';
import { useDrive } from '@/ui/AppProviders';

jest.mock('react-native-safe-area-context', () => {
  const safeAreaMock = jest.requireActual('react-native-safe-area-context/jest/mock');
  return safeAreaMock.default;
});

jest.mock('@/data/drive/files', () => ({
  listFolders: jest.fn(),
}));

jest.mock('@/ui/AppProviders', () => ({
  useDrive: jest.fn(),
}));

const mockListFolders = jest.mocked(listFolders);
const mockUseDrive = jest.mocked(useDrive);
const drive = {} as ReturnType<typeof useDrive>;

const shootFolder = {
  id: 'shoot-folder',
  name: 'Shoot folder',
  mimeType: 'application/vnd.google-apps.folder',
};

const takesFolder = {
  id: 'takes-folder',
  name: 'Takes',
  mimeType: 'application/vnd.google-apps.folder',
};

describe('Drive folder picker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDrive.mockReturnValue(drive);
    mockListFolders.mockResolvedValue([]);
  });

  it('shows Add when the current non-root folder has no subfolders', async () => {
    mockListFolders.mockResolvedValueOnce([shootFolder]).mockResolvedValueOnce([]);

    const view = await render(
      <FolderPicker visible onCancel={jest.fn()} onPick={jest.fn()} />,
    );
    await fireEvent.press(await view.findByText('Shoot folder'));

    expect(await view.findByText('No subfolders here')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Add' })).toBeTruthy();
  });

  it('expands the Add touch target through the header padding', async () => {
    mockListFolders.mockResolvedValueOnce([shootFolder]).mockResolvedValueOnce([]);

    const view = await render(
      <FolderPicker visible onCancel={jest.fn()} onPick={jest.fn()} />,
    );
    await fireEvent.press(await view.findByText('Shoot folder'));

    expect(view.getByRole('button', { name: 'Add' }).props.hitSlop).toEqual({
      top: 16,
      bottom: 16,
    });
  });

  it('does not offer Add for My Drive', async () => {
    mockListFolders.mockResolvedValueOnce([]);

    const view = await render(
      <FolderPicker visible onCancel={jest.fn()} onPick={jest.fn()} />,
    );

    expect(await view.findByText('No subfolders here')).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Add' })).toBeNull();
  });

  it('adds the current folder exactly once', async () => {
    mockListFolders.mockResolvedValueOnce([shootFolder]).mockResolvedValueOnce([]);
    const onPick = jest.fn();

    const view = await render(
      <FolderPicker visible onCancel={jest.fn()} onPick={onPick} />,
    );
    await fireEvent.press(await view.findByText('Shoot folder'));
    await fireEvent.press(await view.findByRole('button', { name: 'Add' }));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith({ id: 'shoot-folder', name: 'Shoot folder' });
  });

  it('does not render the former footer Connect action', async () => {
    const view = await render(
      <FolderPicker visible onCancel={jest.fn()} onPick={jest.fn()} />,
    );

    expect(await view.findByText('No subfolders here')).toBeTruthy();
    expect(view.queryByText('Connect “My Drive”')).toBeNull();
  });

  it('keeps Add available when listing the current folder fails', async () => {
    mockListFolders
      .mockResolvedValueOnce([shootFolder])
      .mockRejectedValueOnce(new Error('Access denied'));

    const view = await render(
      <FolderPicker visible onCancel={jest.fn()} onPick={jest.fn()} />,
    );
    await fireEvent.press(await view.findByText('Shoot folder'));

    expect(await view.findByText('Could not read Drive')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Add' })).toBeTruthy();
  });

  it('keeps Add available when the current folder has subfolders', async () => {
    mockListFolders
      .mockResolvedValueOnce([shootFolder])
      .mockResolvedValueOnce([takesFolder]);

    const view = await render(
      <FolderPicker visible onCancel={jest.fn()} onPick={jest.fn()} />,
    );
    await fireEvent.press(await view.findByText('Shoot folder'));

    expect(await view.findByText('Takes')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Add' })).toBeTruthy();
  });

  it('keeps Add available while the current folder is loading', async () => {
    const pendingFolders = new Promise<Awaited<ReturnType<typeof listFolders>>>(() => {});
    mockListFolders
      .mockResolvedValueOnce([shootFolder])
      .mockReturnValueOnce(pendingFolders);

    const view = await render(
      <FolderPicker visible onCancel={jest.fn()} onPick={jest.fn()} />,
    );
    await fireEvent.press(await view.findByText('Shoot folder'));

    expect(await view.findByText('Reading Drive…')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Add' })).toBeTruthy();
  });
});
