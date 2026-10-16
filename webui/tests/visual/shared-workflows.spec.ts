import { expect, test, type Page } from '@playwright/test';
import { http, HttpResponse, type RequestHandler } from 'msw';

import { routeHandlers, shellHandlers } from './fixtures';
import { installShell, ORIGIN } from './harness';

async function open(page: Page, path: string, handlers: RequestHandler[] = []) {
  await page.addInitScript(() => {
    localStorage.setItem('soulsync_setup_welcome_dismissed', '1');
    localStorage.setItem('soulsync_helper_discovered', '1');
  });
  await page.clock.setFixedTime(new Date('2025-01-13T10:00:00Z'));
  const missing = await installShell(page, [...handlers, ...shellHandlers]);
  await page.goto(`${ORIGIN}${path}`);
  await expect(page.locator('#webui-react-root')).toBeAttached();
  return missing;
}

test.afterEach(async ({ page }) => {
  expect(await page.pageErrors()).toEqual([]);
});

test('dashboard Auto Sync stays React-owned after running from playlist details', async ({ page }) => {
  let runs = 0;
  let statusReads = 0;
  const playlist = {
    id: 42,
    name: 'Evening mix',
    source: 'tidal',
    source_playlist_id: 'evening-1',
    track_count: 1,
    pipeline_state: { status: 'finished', progress: 100 },
    tracks: [{ track_name: 'Windowlicker', artist_name: 'Aphex Twin', duration_ms: 367000 }],
  };
  const missing = await open(page, '/', [
    http.get('*/api/mirrored-playlists', () => HttpResponse.json([playlist])),
    http.get('*/api/mirrored-playlists/42', () => HttpResponse.json(playlist)),
    http.get('*/api/automations', () => HttpResponse.json([])),
    http.get('*/api/playlist-pipeline/history', () => HttpResponse.json({ history: [], total: 0 })),
    http.post('*/api/mirrored-playlists/42/pipeline/run', async ({ request }) => {
      expect(await request.json()).toEqual({ skip_wishlist: false });
      runs += 1;
      return HttpResponse.json({ state: { status: 'running', progress: 0 } });
    }),
    http.get('*/api/mirrored-playlists/42/pipeline/status', () => {
      statusReads += 1;
      return HttpResponse.json({ status: 'running', progress: 25, phase: 'Discovering' });
    }),
  ]);
  await page.locator('article').filter({ hasText: 'Playlist sync' })
    .getByRole('button', { name: 'Manage', exact: true }).click();
  const manager = page.locator('#auto-sync-schedule-modal');
  await expect(manager.locator('.auto-sync-eyebrow')).toHaveCount(0);
  await manager.getByRole('button', { name: 'Details', exact: true }).click();
  const details = page.locator('#mirrored-track-modal');
  await expect(details.getByText('Windowlicker', { exact: true })).toBeVisible();
  await details.getByRole('button', { name: 'Auto-Sync', exact: true }).click();
  await expect.poll(() => runs).toBe(1);
  await expect.poll(() => statusReads).toBeGreaterThan(0);
  await expect(manager.locator('.auto-sync-eyebrow')).toHaveCount(0);
  await details.getByRole('button', { name: 'Close', exact: true }).last().click();
  await manager.locator('.auto-sync-close').click();
  await expect(manager).not.toBeVisible();
  expect(missing).toEqual([]);
});

test('imports a CSV through the Sync file picker', async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  const missing = await open(page, '/sync', [
    http.get('*/api/mirrored-playlists', () => HttpResponse.json([])),
    http.post('*/api/mirror-playlist', async ({ request }) => {
      payload = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ success: true, playlist_id: 41 });
    }),
  ]);
  await page.getByRole('button', { name: '+ Add playlist', exact: true }).click();
  await page.getByRole('button', { name: /Import CSV, TSV, TXT or M3U/ }).click();
  await page.locator('#import-file-input').setInputFiles({
    name: 'evening.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'track_name,artist_name,album_name,duration\nWindowlicker,Aphex Twin,Windowlicker,6:07\nRoygbiv,Boards of Canada,Music Has the Right to Children,2:31',
    ),
  });
  await expect(page.locator('#import-file-preview-tbody tr')).toHaveCount(2);
  await expect(page.locator('#import-file-playlist-name')).toHaveValue('evening');
  await page.locator('#import-file-playlist-name').fill('Evening mix');
  await page.getByRole('button', { name: 'Import as Mirrored Playlist' }).click();
  await expect
    .poll(() => payload)
    .toMatchObject({
      source: 'file',
      name: 'Evening mix',
      tracks: [
        {
          track_name: 'Windowlicker',
          artist_name: 'Aphex Twin',
          album_name: 'Windowlicker',
          duration_ms: 367000,
        },
        {
          track_name: 'Roygbiv',
          artist_name: 'Boards of Canada',
          album_name: 'Music Has the Right to Children',
          duration_ms: 151000,
        },
      ],
    });
  expect(missing).toEqual([]);
});

for (const account of [
  {
    name: 'Spotify',
    id: 'account-1',
    playlistId: 'account-1',
    list: '/api/spotify/playlists',
    detail: '/api/spotify/playlist/account-1',
    container: '#spotify-playlist-container',
    modal: '#playlist-details-modal',
  },
  {
    name: 'Deezer',
    id: 7,
    playlistId: 'deezer_arl_7',
    list: '/api/deezer/arl-playlists',
    detail: '/api/deezer/arl-playlist/7',
    container: '#deezer-arl-playlist-container',
    modal: '#deezer-arl-playlist-details-modal',
  },
]) {
  for (const running of [false, true]) {
    test(`${account.name} download handoff reopens with a running job: ${running}`, async ({
      page,
    }) => {
      let starts = 0;
      const tracks = [
        {
          id: 'track-1',
          name: 'Windowlicker',
          artists: [{ name: 'Aphex Twin' }],
          album: { name: 'Windowlicker' },
          duration_ms: 367000,
        },
      ];
      const playlist = {
        id: account.id,
        name: 'Evening playlist',
        owner: 'Admin',
        track_count: 1,
        tracks,
      };
      const missing = await open(page, '/sync', [
        http.get(`*${account.list}`, () => HttpResponse.json([playlist])),
        http.get(`*${account.detail}`, () => HttpResponse.json(playlist)),
        http.get('*/api/deezer/arl-status', () => HttpResponse.json({ authenticated: true })),
        http.post(`*/api/playlists/${account.playlistId}/start-missing-process`, () => {
          starts += 1;
          return HttpResponse.json({ success: true, batch_id: 'batch-1' });
        }),
        http.get('*/api/download_status/batch', () =>
          HttpResponse.json({
            batches: { 'batch-1': { phase: 'queued', analysis_progress: { total: 1 }, tasks: [] } },
          }),
        ),
      ]);
      await page.getByRole('button', { name: '+ Add playlist', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Add a playlist' })
        .getByRole('button', { name: account.name, exact: true })
        .click();
      await page
        .locator(account.container)
        .getByRole('button', { name: 'Sync / Download', exact: true })
        .click();
      await expect(page.locator(account.modal)).toBeVisible();
      await page
        .locator(account.modal)
        .getByRole('button', { name: /Download Missing Tracks/ })
        .click();
      const modal = page.locator(`#download-missing-modal-${account.playlistId}`);
      await expect(modal).toBeVisible();
      await expect(modal.getByRole('row').filter({ hasText: 'Windowlicker' })).toBeVisible();
      if (running) {
        await modal.getByRole('button', { name: 'Begin Analysis', exact: true }).click();
        await expect.poll(() => starts).toBe(1);
        await expect(modal.getByRole('button', { name: 'Cancel All', exact: true })).toBeVisible();
        await expect(modal.locator(`#analysis-progress-text-${account.playlistId}`)).toHaveText(
          /Queued.*waiting for worker/,
        );
      }
      await modal.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(modal).not.toBeVisible();
      if (running) {
        await page
          .locator(account.container)
          .getByRole('button', { name: 'View Progress', exact: true })
          .click();
        await expect(modal.getByRole('button', { name: 'Cancel All', exact: true })).toBeVisible();
        expect(starts).toBe(1);
      } else {
        await page
          .locator(account.container)
          .getByRole('button', { name: 'Sync / Download', exact: true })
          .click();
        await page
          .locator(account.modal)
          .getByRole('button', { name: /Download Missing Tracks/ })
          .click();
      }
      await expect(modal).toBeVisible();
      expect(missing).toEqual([]);
    });
  }
}

for (const source of ['tidal', 'qobuz']) {
  test(`${source} account refresh mirrors tracks and reopens discovery`, async ({ page }) => {
    let mirrored: Record<string, unknown> | undefined;
    const playlist = {
      id: 'account-2',
      name: 'Evening selection',
      track_count: 1,
      tracks: [
        {
          id: 'track-1',
          name: 'Windowlicker',
          artists: ['Aphex Twin'],
          album: 'Windowlicker',
          duration_ms: 367000,
        },
      ],
    };
    const missing = await open(page, '/sync', [
      http.get(`*/api/${source}/playlists`, () => HttpResponse.json([playlist])),
      http.get(`*/api/${source}/playlists/states`, () => HttpResponse.json({ states: [] })),
      http.post('*/api/mirror-playlist', async ({ request }) => {
        mirrored = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ success: true, playlist_id: 42 });
      }),
    ]);
    await page.getByRole('button', { name: '+ Add playlist', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Add a playlist' })
      .getByRole('button', {
        name: source === 'tidal' ? 'Tidal' : 'Qobuz',
        exact: true,
      })
      .click();
    await page.locator(`#${source}-refresh-btn`).click();
    await expect
      .poll(() => mirrored)
      .toMatchObject({
        source,
        name: playlist.name,
        tracks: [
          {
            track_name: 'Windowlicker',
            artist_name: 'Aphex Twin',
            duration_ms: 367000,
          },
        ],
      });
    const card = page.locator(`#${source}-card-account-2`);
    await card.click();
    const modal = page.locator(`.youtube-discovery-modal[data-source="${source}"]`);
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('row').filter({ hasText: 'Windowlicker' })).toBeVisible();
    await modal.getByRole('button', { name: /Close/, exact: false }).last().click();
    await expect(modal).not.toBeVisible();
    await card.click();
    await expect(modal).toBeVisible();
    expect(missing).toEqual([]);
  });
}

for (const account of ['ListenBrainz', 'Last.fm', 'SoulSync Discovery']) {
  test(`browses ${account} account playlists`, async ({ page }) => {
    const title = `${account} selection`;
    const missing = await open(page, '/sync', [
      http.get('*/api/discover/listenbrainz/:category', () =>
        HttpResponse.json({
          success: true,
          playlists: [
            {
              playlist: {
                identifier: 'https://listenbrainz.org/playlist/mbid-1',
                title,
                creator: 'Admin',
                track_count: 2,
              },
            },
          ],
        }),
      ),
      http.get('*/api/personalized/playlists', () =>
        HttpResponse.json({
          success: true,
          playlists: [{ kind: 'hidden_gems', name: title, track_count: 2 }],
        }),
      ),
      http.get('*/api/personalized/kinds', () => HttpResponse.json({ success: true, kinds: [] })),
    ]);
    await page.getByRole('button', { name: '+ Add playlist', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Add a playlist' })
      .getByRole('button', { name: account, exact: true })
      .click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    expect(missing).toEqual([]);
  });
}

test('Beatport genre browsing survives search, navigation and reopening', async ({ page }) => {
  const release = {
    title: 'Windowlicker',
    artists_string: 'Aphex Twin',
    label: 'Warp',
    url: '/release/windowlicker/1234',
  };
  const missing = await open(page, '/sync', [
    http.get('*/api/beatport/genre/tech-house/11/hero', () =>
      HttpResponse.json({ success: true, releases: [release] }),
    ),
    http.get('*/api/beatport/genre/tech-house/11/top-10-lists', () =>
      HttpResponse.json({ success: true, beatport_top10: [], hype_top10: [] }),
    ),
    http.get('*/api/beatport/genre/tech-house/11/top-10-releases', () =>
      HttpResponse.json({ success: true, releases: [release] }),
    ),
    http.get('*/api/beatport/genres', () =>
      HttpResponse.json({
        genres: [
          { id: 11, slug: 'tech-house', name: 'Tech House' },
          { id: 6, slug: 'techno', name: 'Techno' },
        ],
      }),
    ),
  ]);
  await page.getByRole('tab', { name: 'Beatport', exact: true }).click();
  await page.getByRole('button', { name: 'Browse by Genre' }).click();
  const browser = page.locator('#genre-browser-modal');
  await expect(browser.getByText('Tech House', { exact: true })).toBeVisible();
  await browser.getByPlaceholder('Search genres...').fill('house');
  await expect(browser.getByText('Techno', { exact: true })).not.toBeVisible();
  await browser.getByText('Tech House', { exact: true }).click();
  await expect(browser.getByRole('heading', { name: 'Tech House', exact: true })).toBeVisible();
  await expect(browser.locator('#genre-hero-slider-container')).toContainText('Windowlicker');
  await expect(browser.locator('#genre-top10-lists-container')).toContainText('Tech House Top 10 Lists');
  await expect(browser.locator('#genre-top10-releases-container')).toContainText('Windowlicker');
  await browser.getByRole('button', { name: 'Back to Genres' }).click();
  await page.keyboard.press('Escape');
  await expect(browser).not.toBeVisible();
  await page.getByRole('button', { name: 'Browse by Genre' }).click();
  await expect(browser.getByPlaceholder('Search genres...')).toBeVisible();
  expect(missing).toEqual([]);
});

test('Tools help dismisses and the database updater starts', async ({ page }) => {
  let started = false;
  const missing = await open(page, '/tools', [
    http.get('*/api/database/stats', () =>
      HttpResponse.json({
        total_artists: 2,
        total_albums: 3,
        total_tracks: 8,
        database_size_mb: 1,
      }),
    ),
    http.get('*/api/database/update/status', () =>
      HttpResponse.json(
        started
          ? {
              status: 'running',
              progress: 25,
              current_artist: 'Aphex Twin',
              total: 8,
              processed: 2,
            }
          : { status: 'idle' },
      ),
    ),
    http.post('*/api/database/update', () => {
      started = true;
      return HttpResponse.json({ success: true });
    }),
  ]);
  await page.getByRole('tab', { name: 'Tools', exact: true }).click();
  await page.getByTitle('Learn more about this tool').first().click();
  await expect(page.locator('#tool-help-modal')).toBeVisible();
  await page.locator('#tool-help-modal .tool-help-modal-close').click();
  await expect(page.locator('#tool-help-modal')).not.toBeVisible();
  await page.getByRole('button', { name: 'Update Database', exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await expect(page.getByRole('button', { name: 'Stop Update', exact: true })).toBeVisible();
  expect(missing).toEqual([]);
});

test('the video automation builder retains its separate context', async ({ page }) => {
  const missing = await open(page, '/video-automations', [
    http.get('*/api/automations', () => HttpResponse.json([])),
    http.get('*/api/video/automations/blocks', () =>
      HttpResponse.json({ triggers: [], actions: [], notifications: [] }),
    ),
  ]);
  await expect(page.locator('#vauto-list-view')).toBeVisible();
  await page
    .locator('#vauto-list-view')
    .getByRole('button', { name: /New Automation/ })
    .first()
    .click();
  await expect(page.locator('#vauto-builder-view')).toBeVisible();
  await expect(page.locator('#automations-builder-view')).not.toBeVisible();
  await page
    .locator('#vauto-builder-view')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(page.locator('#vauto-list-view')).toBeVisible();
  expect(missing).toEqual([]);
});

test('the shared music automation builder returns to React on cancel', async ({ page }) => {
  const missing = await open(page, '/automations', routeHandlers.automations);
  await expect(page.locator('#automations-page')).not.toHaveClass(/\bactive\b/);
  await page
    .getByRole('button', { name: /New Automation/i })
    .first()
    .click();
  await expect(page.locator('#automations-builder-view')).toBeVisible();
  await page
    .locator('#automations-builder-view')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(page.locator('#automations-page')).not.toHaveClass(/\bactive\b/);
  await expect(page.getByRole('button', { name: /New Automation/i }).first()).toBeVisible();
  expect(missing).toEqual([]);
});
