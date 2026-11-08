import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXCHANGE_RATES_PER_USD,
  INITIAL_XBOX_PRODUCTS,
  XBOX_REGIONS,
} from '../data/xboxCatalogData';
import { WatchlistItem } from '../types/xbox';
import {
  buildMultiChannelWatchlistAlert,
  buildWeeklyDealsWaveNotification,
  runNotificationWorkerCycle,
  shouldDispatchWatchlistAlert,
} from './notificationWorker';

test('shouldDispatchWatchlistAlert respects targetPrice, notifyOnAnyDrop, and lastNotifiedPrice deduplication', () => {
  // 1. Target price reached (e.g., current = 250, target = 300)
  const hitTarget = shouldDispatchWatchlistAlert(250, 300, false, 75, null);
  assert.equal(hitTarget.shouldTrigger, true);
  assert.equal(hitTarget.reason, 'TARGET_REACHED');

  // 2. Deduplication prevents re-alerting if lastNotifiedPrice was already 250
  const deduplicated = shouldDispatchWatchlistAlert(250, 300, true, 75, 250);
  assert.equal(deduplicated.shouldTrigger, false);
  assert.equal(deduplicated.reason, 'NONE');

  // 3. Further drop below lastNotifiedPrice triggers again
  const furtherDrop = shouldDispatchWatchlistAlert(199, 300, true, 80, 250);
  assert.equal(furtherDrop.shouldTrigger, true);
});

test('buildMultiChannelWatchlistAlert creates FCM Android, Discord Embed, Telegram HTML, and Web Push payloads', () => {
  const product = INITIAL_XBOX_PRODUCTS[0]; // Cyber Odyssey 2099
  const watchlistItem: WatchlistItem = {
    bigId: product.bigId,
    addedAt: '2026-10-01T00:00:00Z',
    targetPrice: 450,
    targetCurrency: 'MXN',
    notifyOnAnyDrop: true,
    preferredRegion: 'MX',
  };

  const dispatch = buildMultiChannelWatchlistAlert(
    product,
    watchlistItem,
    XBOX_REGIONS,
    'MX',
    'MXN',
    EXCHANGE_RATES_PER_USD
  );
  assert.ok(dispatch);
  assert.equal(dispatch.triggerType, 'WATCHLIST_PRICE_DROP');
  assert.equal(dispatch.bigId, product.bigId);
  assert.equal(
    dispatch.channels.fcmAndroid.message.android.notification.channel_id,
    'xbox_price_drops'
  );
  assert.ok(
    dispatch.channels.discordWebhook.embeds[0].title.includes(product.title)
  );
  assert.equal(dispatch.channels.telegramBot.parse_mode, 'HTML');
  assert.ok(
    dispatch.channels.webPush.data.url.includes('https://www.xbox.com/es-mx')
  );
});

test('buildWeeklyDealsWaveNotification summarizes active deals and historical lows', () => {
  const wave = buildWeeklyDealsWaveNotification(
    INITIAL_XBOX_PRODUCTS,
    XBOX_REGIONS,
    'MX',
    'MXN',
    EXCHANGE_RATES_PER_USD
  );
  assert.equal(wave.triggerType, 'WEEKLY_DEALS_WAVE');
  assert.equal(
    wave.channels.fcmAndroid.message.android.notification.channel_id,
    'xbox_weekly_waves'
  );
  assert.equal(wave.channels.discordWebhook.embeds.length, 1);
  assert.ok(wave.discountPct > 0);
});

test('runNotificationWorkerCycle evaluates all watchlist items and returns alerts + weekly wave', () => {
  const watchlist: WatchlistItem[] = [
    {
      bigId: '9NXVC0482QS5',
      addedAt: '2026-10-05T12:00:00Z',
      targetPrice: 500,
      targetCurrency: 'MXN',
      notifyOnAnyDrop: true,
      preferredRegion: 'MX',
    },
  ];
  const cycle = runNotificationWorkerCycle(
    INITIAL_XBOX_PRODUCTS,
    watchlist,
    XBOX_REGIONS,
    'MX',
    'MXN',
    EXCHANGE_RATES_PER_USD
  );
  assert.equal(cycle.watchlistAlerts.length, 1);
  assert.equal(cycle.weeklyWaveAlert.triggerType, 'WEEKLY_DEALS_WAVE');
});
