import { WatchlistItem, XboxProduct, XboxRegion } from '../types/xbox';
import {
  buildRegionalComparison,
  buildXboxStoreDeepLink,
  calculatePriceAnalytics,
  convertCurrency,
  getEffectiveRegionalPrice,
} from './pricingEngine';

export interface FcmAndroidNotificationPayload {
  message: {
    token: string;
    notification: {
      title: string;
      body: string;
      image?: string;
    };
    android: {
      priority: 'HIGH';
      notification: {
        channel_id: 'xbox_price_drops' | 'xbox_weekly_waves';
        color: '#107C10';
        click_action: 'OPEN_PRODUCT_DETAIL' | 'OPEN_DEALS_EXPLORER';
      };
    };
    data: Record<string, string>;
  };
}

export interface DiscordWebhookEmbedPayload {
  username: string;
  embeds: Array<{
    title: string;
    url: string;
    description: string;
    color: number;
    thumbnail?: { url: string };
    fields: Array<{
      name: string;
      value: string;
      inline: boolean;
    }>;
    footer: { text: string };
    timestamp: string;
  }>;
}

export interface TelegramBotMessagePayload {
  chat_id: string;
  parse_mode: 'HTML';
  text: string;
  reply_markup: {
    inline_keyboard: Array<
      Array<{
        text: string;
        url: string;
      }>
    >;
  };
}

export interface WebPushNotificationPayload {
  title: string;
  body: string;
  icon: string;
  badge: string;
  tag: string;
  data: {
    url: string;
    bigId?: string;
    regionCode: string;
  };
}

export interface MultiChannelAlertDispatch {
  alertId: string;
  triggerType: 'WATCHLIST_PRICE_DROP' | 'WEEKLY_DEALS_WAVE';
  bigId: string;
  productTitle: string;
  regionCode: string;
  currency: string;
  currentPriceFormatted: string;
  listPriceFormatted: string;
  targetPriceFormatted: string;
  discountPct: number;
  cheapestRegionName: string;
  cheapestPriceFormatted: string;
  savingsVsLocalPct: number;
  verdict: string;
  deepLinkUrl: string;
  dispatchedAt: string;
  channels: {
    fcmAndroid: FcmAndroidNotificationPayload;
    discordWebhook: DiscordWebhookEmbedPayload;
    telegramBot: TelegramBotMessagePayload;
    webPush: WebPushNotificationPayload;
  };
}

export function formatMoney(amount: number, currency: string): string {
  const symbols: Record<string, string> = {
    MXN: 'MX$',
    USD: 'US$',
    ARS: 'ARS$',
    TRY: '₺',
    BRL: 'R$',
    COP: 'COL$',
    CLP: 'CLP$',
    EUR: '€',
    JPY: '¥',
    GBP: '£',
    CAD: 'CA$',
    INR: '₹',
    ZAR: 'R',
    PLN: 'zł',
    KRW: '₩',
    EGP: 'E£',
  };
  const prefix = symbols[currency] || `${currency} `;
  return `${prefix}${amount.toLocaleString('es-MX', {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Deduplication & Cooldown logic:
 * Prevents duplicate push notifications if the user was already notified at the same or lower price.
 */
export function shouldDispatchWatchlistAlert(
  currentEffectivePriceConverted: number,
  targetPrice: number | null,
  notifyOnAnyDrop: boolean,
  discountPct: number,
  lastNotifiedPrice?: number | null
): { shouldTrigger: boolean; reason: 'TARGET_REACHED' | 'PRICE_DROP' | 'NONE' } {
  if (
    typeof lastNotifiedPrice === 'number' &&
    currentEffectivePriceConverted >= lastNotifiedPrice - 0.009
  ) {
    return { shouldTrigger: false, reason: 'NONE' };
  }

  const targetReached =
    targetPrice !== null &&
    targetPrice > 0 &&
    currentEffectivePriceConverted <= targetPrice + 0.009;
  if (targetReached) {
    return { shouldTrigger: true, reason: 'TARGET_REACHED' };
  }

  if (notifyOnAnyDrop && discountPct > 0) {
    return { shouldTrigger: true, reason: 'PRICE_DROP' };
  }

  return { shouldTrigger: false, reason: 'NONE' };
}

/**
 * Generates multi-channel notification payloads (FCM Android, Discord Embed, Telegram HTML, Web Push)
 * when a Watchlist item drops in price or hits the user's Target Price.
 */
export function buildMultiChannelWatchlistAlert(
  product: XboxProduct,
  watchlistItem: WatchlistItem,
  regions: XboxRegion[],
  userRegion: string,
  targetCurrency: string,
  ratesPerUsd: Record<string, number>,
  lastNotifiedPrice?: number | null
): MultiChannelAlertDispatch | null {
  const monitoredRegion = watchlistItem.preferredRegion || userRegion;
  const rPrice =
    product.pricesByRegion[monitoredRegion] ||
    product.pricesByRegion[userRegion] ||
    product.pricesByRegion['US'];
  if (!rPrice) return null;

  const history =
    product.historyByRegion[monitoredRegion] ||
    product.historyByRegion[userRegion] ||
    product.historyByRegion['US'] ||
    [];
  const analytics = calculatePriceAnalytics(history, rPrice);

  const currentConverted = convertCurrency(
    getEffectiveRegionalPrice(rPrice),
    rPrice.currency,
    targetCurrency,
    ratesPerUsd
  );
  const listConverted = convertCurrency(
    rPrice.listPrice,
    rPrice.currency,
    targetCurrency,
    ratesPerUsd
  );

  const comparison = buildRegionalComparison(
    product,
    regions,
    userRegion,
    targetCurrency,
    ratesPerUsd
  );
  const cheapest = comparison[0];

  const decision = shouldDispatchWatchlistAlert(
    currentConverted,
    watchlistItem.targetPrice,
    watchlistItem.notifyOnAnyDrop,
    analytics.discountPct,
    lastNotifiedPrice
  );

  if (!decision.shouldTrigger) {
    return null;
  }

  const currentFormatted = formatMoney(currentConverted, targetCurrency);
  const listFormatted = formatMoney(listConverted, targetCurrency);
  const targetFormatted =
    watchlistItem.targetPrice !== null
      ? formatMoney(watchlistItem.targetPrice, watchlistItem.targetCurrency)
      : 'Cualquier rebaja';
  const cheapestFormatted = cheapest
    ? formatMoney(cheapest.convertedPrice, targetCurrency)
    : currentFormatted;
  const cheapestRegionName = cheapest ? cheapest.regionName : monitoredRegion;
  const savingsVsLocalPct = cheapest ? cheapest.savingsPctVsLocal : 0;

  const regionMeta = regions.find((r) => r.code === monitoredRegion);
  const locale = regionMeta ? regionMeta.locale : 'es-mx';
  const deepLinkUrl = buildXboxStoreDeepLink(
    locale,
    product.slug,
    product.bigId
  );

  const headlinePrefix =
    decision.reason === 'TARGET_REACHED'
      ? '¡Precio Objetivo Alcanzado!'
      : '¡Nueva Rebaja en tu Watchlist!';

  const title = `${headlinePrefix} ${product.title} (-${analytics.discountPct}%)`;
  const body = `Ahora a ${currentFormatted} en Xbox Store (${monitoredRegion}) · Mínimo global en ${cheapestRegionName}: ${cheapestFormatted} (-${savingsVsLocalPct}% vs tienda local).`;

  const nowIso = new Date().toISOString();

  return {
    alertId: `alert-${product.bigId}-${monitoredRegion}`,
    triggerType: 'WATCHLIST_PRICE_DROP',
    bigId: product.bigId,
    productTitle: product.title,
    regionCode: monitoredRegion,
    currency: targetCurrency,
    currentPriceFormatted: currentFormatted,
    listPriceFormatted: listFormatted,
    targetPriceFormatted: targetFormatted,
    discountPct: analytics.discountPct,
    cheapestRegionName,
    cheapestPriceFormatted: cheapestFormatted,
    savingsVsLocalPct,
    verdict: analytics.verdict,
    deepLinkUrl,
    dispatchedAt: nowIso,
    channels: {
      fcmAndroid: {
        message: {
          token: 'fcm_device_token_xbox_android_client',
          notification: {
            title,
            body,
            image: product.coverImage,
          },
          android: {
            priority: 'HIGH',
            notification: {
              channel_id: 'xbox_price_drops',
              color: '#107C10',
              click_action: 'OPEN_PRODUCT_DETAIL',
            },
          },
          data: {
            bigId: product.bigId,
            region: monitoredRegion,
            currency: targetCurrency,
            effectivePrice: String(currentConverted),
            discountPct: String(analytics.discountPct),
            deepLink: `xbpulse://product/${product.bigId}?region=${monitoredRegion}`,
          },
        },
      },
      discordWebhook: {
        username: 'XB Pulse — Alertas Xbox Store',
        embeds: [
          {
            title: `${product.title} (-${analytics.discountPct}%) — ${analytics.verdict}`,
            url: deepLinkUrl,
            description: `${headlinePrefix} El título en tu lista de seguimiento acaba de bajar de **${listFormatted}** a **${currentFormatted}**.`,
            color: 0x107c10,
            thumbnail: { url: product.coverImage },
            fields: [
              {
                name: `Precio Tienda ${monitoredRegion}`,
                value: `**${currentFormatted}** ~~${listFormatted}~~ (-${analytics.discountPct}%)`,
                inline: true,
              },
              {
                name: 'Tu Precio Objetivo',
                value: `${targetFormatted}`,
                inline: true,
              },
              {
                name: `Región Más Barata (${cheapestRegionName})`,
                value: `**${cheapestFormatted}** (${savingsVsLocalPct > 0 ? `-${savingsVsLocalPct}% vs local` : 'Mejor precio'})`,
                inline: true,
              },
            ],
            footer: {
              text: `BigId: ${product.bigId} · DisplayCatalog v7.0 · XB Pulse`,
            },
            timestamp: nowIso,
          },
        ],
      },
      telegramBot: {
        chat_id: '@xbpulse_deals_alerts',
        parse_mode: 'HTML',
        text: [
          `🟢 <b>${headlinePrefix}</b>`,
          `🎮 <b>${product.title}</b> (${product.productType})`,
          `💰 Precio ${monitoredRegion}: <b>${currentFormatted}</b> (<s>${listFormatted}</s> · <b>-${analytics.discountPct}%</b>)`,
          `🎯 Tu Precio Objetivo: <code>${targetFormatted}</code>`,
          `🌍 Región más barata: <b>${cheapestRegionName}</b> a <b>${cheapestFormatted}</b> (-${savingsVsLocalPct}% extra)`,
          `📊 Veredicto: <b>${analytics.verdict}</b>`,
        ].join('\n'),
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: `🛒 Comprar en Xbox Store (${monitoredRegion})`,
                url: deepLinkUrl,
              },
            ],
          ],
        },
      },
      webPush: {
        title,
        body,
        icon: product.coverImage,
        badge: '/favicon.ico',
        tag: `xbpulse-drop-${product.bigId}`,
        data: {
          url: deepLinkUrl,
          bigId: product.bigId,
          regionCode: monitoredRegion,
        },
      },
    },
  };
}

/**
 * Generates a Weekly Deals Wave summary notification when Microsoft Store publishes
 * Tuesday's weekly deals ("Deals with Game Pass" / "Publisher Spotlight Series").
 */
export function buildWeeklyDealsWaveNotification(
  products: XboxProduct[],
  regions: XboxRegion[],
  userRegion: string,
  targetCurrency: string,
  ratesPerUsd: Record<string, number>
): MultiChannelAlertDispatch {
  const enriched = products
    .map((p) => {
      const rPrice = p.pricesByRegion[userRegion] || p.pricesByRegion['US'];
      const history =
        p.historyByRegion[userRegion] || p.historyByRegion['US'] || [];
      const analytics = calculatePriceAnalytics(history, rPrice);
      const comparison = buildRegionalComparison(
        p,
        regions,
        userRegion,
        targetCurrency,
        ratesPerUsd
      );
      const effectiveConverted = convertCurrency(
        getEffectiveRegionalPrice(rPrice),
        rPrice.currency,
        targetCurrency,
        ratesPerUsd
      );
      return {
        product: p,
        analytics,
        cheapest: comparison[0],
        discountPct: rPrice ? rPrice.discountPct : 0,
        effectiveConverted,
      };
    })
    .filter((item) => item.discountPct > 0)
    .sort((a, b) => b.discountPct - a.discountPct);

  const historicalLowsCount = enriched.filter(
    (e) => e.analytics.verdict === 'Mínimo histórico'
  ).length;
  const avgDiscount =
    enriched.length > 0
      ? Math.round(
          enriched.reduce((acc, e) => acc + e.discountPct, 0) / enriched.length
        )
      : 0;

  const topDeals = enriched.slice(0, 3);
  const topDeal = topDeals[0];
  const nowIso = new Date().toISOString();

  const title = `Nueva Oleada Semanal Xbox Store: ${enriched.length} ofertas activas (${historicalLowsCount} Mínimos Históricos)`;
  const summaryLines = topDeals.map((d) => {
    const priceStr = formatMoney(d.effectiveConverted, targetCurrency);
    const cheapStr = d.cheapest
      ? `${d.cheapest.regionName}: ${formatMoney(d.cheapest.convertedPrice, targetCurrency)}`
      : priceStr;
    return `• ${d.product.title}: ${priceStr} (-${d.discountPct}%) | Más barato en ${cheapStr}`;
  });

  const deepLinkUrl = `https://www.xbox.com/es-mx/games/all-games`;

  return {
    alertId: `weekly-wave-${userRegion}-${nowIso.slice(0, 10)}`,
    triggerType: 'WEEKLY_DEALS_WAVE',
    bigId: topDeal ? topDeal.product.bigId : 'WEEKLY_WAVE',
    productTitle: `Oleada Semanal Xbox Store (${enriched.length} Ofertas)`,
    regionCode: userRegion,
    currency: targetCurrency,
    currentPriceFormatted: topDeal
      ? formatMoney(topDeal.effectiveConverted, targetCurrency)
      : '$0',
    listPriceFormatted: `${historicalLowsCount} mínimos históricos`,
    targetPriceFormatted: `Promedio -${avgDiscount}%`,
    discountPct: avgDiscount,
    cheapestRegionName: topDeal?.cheapest?.regionName || userRegion,
    cheapestPriceFormatted: topDeal?.cheapest
      ? formatMoney(topDeal.cheapest.convertedPrice, targetCurrency)
      : '$0',
    savingsVsLocalPct: topDeal?.cheapest?.savingsPctVsLocal || 0,
    verdict: 'Mínimo histórico',
    deepLinkUrl,
    dispatchedAt: nowIso,
    channels: {
      fcmAndroid: {
        message: {
          token: 'topic_weekly_xbox_deals_wave',
          notification: {
            title,
            body: summaryLines.join(' · '),
            image: topDeal?.product.coverImage,
          },
          android: {
            priority: 'HIGH',
            notification: {
              channel_id: 'xbox_weekly_waves',
              color: '#107C10',
              click_action: 'OPEN_DEALS_EXPLORER',
            },
          },
          data: {
            waveType: 'TUESDAY_WEEKLY_REFRESH',
            totalDeals: String(enriched.length),
            historicalLows: String(historicalLowsCount),
            avgDiscountPct: String(avgDiscount),
          },
        },
      },
      discordWebhook: {
        username: 'XB Pulse — Radar Semanal Xbox Store',
        embeds: [
          {
            title,
            url: deepLinkUrl,
            description: [
              'Se ha detectado una nueva actualización semanal de precios en `displaycatalog.mp.microsoft.com`.',
              '',
              ...summaryLines,
            ].join('\n'),
            color: 0x22c55e,
            thumbnail: topDeal ? { url: topDeal.product.coverImage } : undefined,
            fields: [
              {
                name: 'Ofertas Detectadas',
                value: `${enriched.length} títulos`,
                inline: true,
              },
              {
                name: 'Mínimos Históricos',
                value: `${historicalLowsCount} juegos/DLCs`,
                inline: true,
              },
              {
                name: 'Descuento Promedio',
                value: `-${avgDiscount}%`,
                inline: true,
              },
            ],
            footer: {
              text: 'Worker Cron Martes 00:15 UTC · XB Pulse',
            },
            timestamp: nowIso,
          },
        ],
      },
      telegramBot: {
        chat_id: '@xbpulse_deals_alerts',
        parse_mode: 'HTML',
        text: [
          `🔥 <b>${title}</b>`,
          '',
          ...topDeals.map(
            (d) =>
              `• <b>${d.product.title}</b>: <code>${formatMoney(d.effectiveConverted, targetCurrency)}</code> (<b>-${d.discountPct}%</b>) — <i>${d.analytics.verdict}</i>`
          ),
        ].join('\n'),
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🔎 Explorar Todas las Ofertas en XB Pulse',
                url: deepLinkUrl,
              },
            ],
          ],
        },
      },
      webPush: {
        title,
        body: summaryLines[0] || 'Nuevas rebajas disponibles en Xbox Store.',
        icon: topDeal?.product.coverImage || '/favicon.ico',
        badge: '/favicon.ico',
        tag: 'xbpulse-weekly-wave',
        data: {
          url: deepLinkUrl,
          regionCode: userRegion,
        },
      },
    },
  };
}

/**
 * Evaluates all Watchlist items and returns all triggered multi-channel alerts + Weekly Wave digest.
 */
export function runNotificationWorkerCycle(
  products: XboxProduct[],
  watchlist: WatchlistItem[],
  regions: XboxRegion[],
  userRegion: string,
  targetCurrency: string,
  ratesPerUsd: Record<string, number>
): {
  watchlistAlerts: MultiChannelAlertDispatch[];
  weeklyWaveAlert: MultiChannelAlertDispatch;
} {
  const watchlistAlerts: MultiChannelAlertDispatch[] = [];

  for (const item of watchlist) {
    const product = products.find((p) => p.bigId === item.bigId);
    if (!product) continue;

    const alert = buildMultiChannelWatchlistAlert(
      product,
      item,
      regions,
      userRegion,
      targetCurrency,
      ratesPerUsd
    );
    if (alert) {
      watchlistAlerts.push(alert);
    }
  }

  const weeklyWaveAlert = buildWeeklyDealsWaveNotification(
    products,
    regions,
    userRegion,
    targetCurrency,
    ratesPerUsd
  );

  return {
    watchlistAlerts,
    weeklyWaveAlert,
  };
}
