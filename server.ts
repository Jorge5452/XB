import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  CURRENCY_METADATA,
  EXCHANGE_RATES_PER_USD,
  XBOX_REGIONS,
} from './src/data/xboxCatalogData';
import { LIVE_DEALS_SNAPSHOT } from './src/data/liveDealsSnapshot';
import {
  buildRegionalComparison,
  calculatePriceAnalytics,
  evaluateWatchlistAlerts,
  expandXboxSearchQuery,
  fuzzyMatchScore,
  rankSearchResults,
} from './src/utils/pricingEngine';
import {
  batchHydrateProductsFromDisplayCatalog,
  convertEmeraldSummaryToXboxProduct,
  detectPriceDeltaAndUpdateHistory,
  extractBigIdFromQuery,
  extractMsProductFromNode,
} from './src/utils/msCatalogScraper';
import {
  buildEnrichedWatchlistResponse,
  buildPaginatedProductsResponse,
  filterHistoryByTimeframe,
  validateWatchlistPayload,
} from './src/utils/restApiController';
import {
  buildWeeklyDealsWaveNotification,
  runNotificationWorkerCycle,
} from './src/utils/notificationWorker';
import {
  ExplorerTab,
  FilterState,
  ProductType,
  SortOption,
  WatchlistItem,
  WatchlistSortOption,
  XboxPlatform,
  XboxProduct,
} from './src/types/xbox';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_REGION_CODES = new Set(XBOX_REGIONS.map((r) => r.code));
const VALID_CURRENCY_CODES = new Set(Object.keys(CURRENCY_METADATA));
const BIG_ID_REGEX = /^[A-Z0-9]{12}$/;

function sanitizeRegionCode(raw: unknown, fallback = 'MX'): string {
  const code = String(raw || fallback).trim().toUpperCase();
  return VALID_REGION_CODES.has(code) ? code : fallback;
}

function sanitizeCurrencyCode(raw: unknown, fallback = 'MXN'): string {
  const code = String(raw || fallback).trim().toUpperCase();
  return VALID_CURRENCY_CODES.has(code) ? code : fallback;
}

function sanitizeSearchQuery(raw: unknown): string {
  return String(raw || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 80);
}

// In-memory store initialized with pre-synced 75+ real Xbox Store deals across regions
const catalogProducts: XboxProduct[] = [...LIVE_DEALS_SNAPSHOT];
const exchangeRates: Record<string, number> = { ...EXCHANGE_RATES_PER_USD };
const hydratedMultiRegionTimestamps = new Map<string, number>();
const syncedRegionsSet = new Set<string>();

// Sliding-window rate limiter state per IP
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

let serverWatchlist: WatchlistItem[] = [
  {
    bigId: '9NXVC0482QS5',
    addedAt: '2026-10-25T10:00:00Z',
    targetPrice: 300,
    targetCurrency: 'MXN',
    notifyOnAnyDrop: true,
    preferredRegion: 'MX',
  },
  {
    bigId: 'BWTTW53M5B98',
    addedAt: '2026-10-28T15:30:00Z',
    targetPrice: 60,
    targetCurrency: 'MXN',
    notifyOnAnyDrop: true,
    preferredRegion: 'MX',
  },
];

const EMERALD_HEADERS = {
  'Content-Type': 'application/json',
  'X-MS-API-Version': '1.1',
  'MS-CV': 'DGU1mcuYo0WMMp+F.1',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
};

function upsertCatalogProduct(
  incoming: XboxProduct,
  prepend = true
): XboxProduct {
  const existingIdx = catalogProducts.findIndex(
    (p) => p.bigId.toUpperCase() === incoming.bigId.toUpperCase()
  );
  if (existingIdx >= 0) {
    const existing = catalogProducts[existingIdx];
    const merged: XboxProduct = {
      ...existing,
      title: incoming.title || existing.title,
      description: incoming.description || existing.description,
      developer: incoming.developer || existing.developer,
      publisher: incoming.publisher || existing.publisher,
      coverImage: incoming.coverImage || existing.coverImage,
      screenshots:
        incoming.screenshots.length > 0
          ? incoming.screenshots
          : existing.screenshots,
      featuredDeal: incoming.featuredDeal || existing.featuredDeal,
      pricesByRegion: {
        ...incoming.pricesByRegion,
        ...existing.pricesByRegion,
        ...Object.fromEntries(
          Object.entries(incoming.pricesByRegion).filter(
            ([regCode, rPrice]) =>
              rPrice.discountPct > 0 || !existing.pricesByRegion[regCode]
          )
        ),
      },
      historyByRegion: {
        ...incoming.historyByRegion,
        ...existing.historyByRegion,
      },
    };
    catalogProducts[existingIdx] = merged;
    return merged;
  }

  if (prepend) {
    catalogProducts.unshift(incoming);
  } else {
    catalogProducts.push(incoming);
  }
  return incoming;
}

async function syncLiveXboxDealsForRegion(
  regionCode: string,
  maxPages = 3
): Promise<{ syncedCount: number; totalChannelItems: number }> {
  const mkt = sanitizeRegionCode(regionCode);
  const regionMeta =
    XBOX_REGIONS.find((r) => r.code === mkt) || XBOX_REGIONS[0];

  let encodedCT: string | undefined = undefined;
  let syncedCount = 0;
  let totalChannelItems = 0;
  const collectedProducts: XboxProduct[] = [];
  const boundedPages = Math.min(Math.max(1, maxPages), 4);

  for (let page = 0; page < boundedPages; page++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const bodyPayload: Record<string, unknown> = {
        Filters: 'e30=',
        ReturnFilters: false,
        ChannelKeyToBeUsedInResponse: 'DEALS',
        ChannelId: 'DYNAMICCHANNEL.GAMEDEALS',
      };
      if (encodedCT) {
        bodyPayload.EncodedCT = encodedCT;
      }

      const response = await fetch(
        `https://emerald.xboxservices.com/xboxcomfd/browse?locale=${encodeURIComponent(
          regionMeta.locale
        )}`,
        {
          method: 'POST',
          headers: EMERALD_HEADERS,
          body: JSON.stringify(bodyPayload),
          signal: controller.signal,
        }
      );
      clearTimeout(timeout);

      if (!response.ok) break;
      const data = (await response.json()) as Record<string, unknown>;
      const channels = (data.channels as Record<string, unknown>) || {};
      const dealsChannel = (channels.DEALS as Record<string, unknown>) || {};
      if (typeof dealsChannel.totalItems === 'number') {
        totalChannelItems = dealsChannel.totalItems;
      }
      encodedCT =
        typeof dealsChannel.encodedCT === 'string' && dealsChannel.encodedCT
          ? dealsChannel.encodedCT
          : undefined;

      const summaries = Array.isArray(data.productSummaries)
        ? (data.productSummaries as Array<Record<string, unknown>>)
        : [];

      for (const summary of summaries) {
        const converted = convertEmeraldSummaryToXboxProduct(
          summary,
          mkt,
          regionMeta.currency,
          exchangeRates
        );
        if (converted) {
          collectedProducts.push(converted);
          syncedCount++;
        }
      }

      if (!encodedCT || summaries.length === 0) break;
    } catch {
      break;
    }
  }

  for (let i = collectedProducts.length - 1; i >= 0; i--) {
    const prod = collectedProducts[i];
    const existingIdx = catalogProducts.findIndex(
      (p) => p.bigId.toUpperCase() === prod.bigId.toUpperCase()
    );
    if (existingIdx >= 0) {
      catalogProducts[existingIdx].pricesByRegion[mkt] =
        prod.pricesByRegion[mkt];
      catalogProducts[existingIdx].historyByRegion[mkt] =
        prod.historyByRegion[mkt];
    } else {
      upsertCatalogProduct(prod, true);
    }
  }

  if (syncedCount > 0) {
    syncedRegionsSet.add(mkt);
  }

  return { syncedCount, totalChannelItems };
}

async function fetchProductByBigIdFromDisplayCatalog(
  rawBigId: string,
  regionCode: string
): Promise<XboxProduct | null> {
  const bigId = rawBigId.trim().toUpperCase();
  if (!BIG_ID_REGEX.test(bigId)) return null;

  const mkt = sanitizeRegionCode(regionCode);
  const regionMeta =
    XBOX_REGIONS.find((r) => r.code === mkt) || XBOX_REGIONS[0];

  const msEndpoint = `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${encodeURIComponent(
    bigId
  )}&market=${encodeURIComponent(mkt)}&languages=${encodeURIComponent(
    regionMeta.locale
  )}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const response = await fetch(msEndpoint, {
      headers: { Accept: 'application/json', 'MS-CV': 'DGU1mcuYo0WMMp+F.1' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return null;

    const data = (await response.json()) as Record<string, unknown>;
    const products = Array.isArray(data.Products)
      ? (data.Products as Array<Record<string, unknown>>)
      : [];
    if (products.length === 0) return null;

    const quote = extractMsProductFromNode(
      products[0],
      mkt,
      regionMeta.currency
    );
    if (quote.listPrice <= 0 && quote.salePrice === null) return null;

    const syntheticSummary: Record<string, unknown> = {
      productId: quote.bigId,
      title: quote.title,
      shortDescription: quote.description,
      developerName: quote.developer,
      publisherName: quote.publisher,
      releaseDate: quote.releaseDate,
      productKind: quote.productType,
      availableOn: quote.platforms,
      includedWithPassesProductIds: quote.includedInGamePass
        ? ['CFQ7TTC0K6L8']
        : [],
      images: {
        poster: { url: quote.coverUrl },
      },
      specificPrices: {
        purchaseable: [
          {
            msrp: quote.listPrice,
            listPrice:
              quote.salePrice ?? quote.gamePassPrice ?? quote.listPrice,
            discountPercentage: quote.discountPct,
            currency: quote.currency,
            endDateUtc: quote.endDate,
            hasXPriceOffer:
              quote.gamePassPrice !== null && quote.salePrice === null,
          },
        ],
      },
    };

    const built = convertEmeraldSummaryToXboxProduct(
      syntheticSummary,
      mkt,
      regionMeta.currency,
      exchangeRates
    );
    if (built) {
      return upsertCatalogProduct(built, true);
    }
  } catch {
    // ignore network error
  }
  return null;
}

async function refreshLiveExchangeRates(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return;
    const data = (await res.json()) as { rates?: Record<string, number> };
    if (data?.rates) {
      for (const code of Object.keys(exchangeRates)) {
        const liveVal = data.rates[code];
        if (typeof liveVal === 'number' && liveVal > 0) {
          const rounded = Number(liveVal.toFixed(4));
          exchangeRates[code] = rounded;
          EXCHANGE_RATES_PER_USD[code] = rounded;
        }
      }
    }
  } catch {
    // Keep accurate fallback exchangeRates
  }
}

async function searchLiveXboxStore(
  rawQuery: string,
  regionCode: string
): Promise<XboxProduct[]> {
  const q = sanitizeSearchQuery(rawQuery);
  if (!q) return [];

  const mkt = sanitizeRegionCode(regionCode);
  const regionMeta =
    XBOX_REGIONS.find((r) => r.code === mkt) || XBOX_REGIONS[0];

  const gameProducts: XboxProduct[] = [];
  const addonProducts: XboxProduct[] = [];

  const extractedBigId = extractBigIdFromQuery(q);
  if (extractedBigId && BIG_ID_REGEX.test(extractedBigId)) {
    const fromBigId = await fetchProductByBigIdFromDisplayCatalog(
      extractedBigId,
      mkt
    );
    if (fromBigId) {
      gameProducts.push(fromBigId);
    }
  }

  const wantsDlcExplicitly =
    /\b(dlc|add-on|addon|pase|pass|pack|complemento|expansion|expansión|season)\b/i.test(
      q
    );

  const apiQuery = expandXboxSearchQuery(q);

  // 1. Fetch Games channel, DisplayCatalog Autosuggest Games, and Addons channel in parallel,
  //    keeping Games and Addons in separate buckets so Addons never jump ahead of Games.
  const fetchEmeraldChannel = async (
    url: string,
    key: string,
    id: string
  ): Promise<XboxProduct[]> => {
    const bucket: XboxProduct[] = [];
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500);
      const response = await fetch(url, {
        method: 'POST',
        headers: EMERALD_HEADERS,
        body: JSON.stringify({
          Filters: 'e30=',
          ReturnFilters: false,
          ChannelKeyToBeUsedInResponse: key,
          ChannelId: id,
          Query: apiQuery,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) return bucket;

      const data = (await response.json()) as Record<string, unknown>;
      const summaries = Array.isArray(data.productSummaries)
        ? (data.productSummaries as Array<Record<string, unknown>>)
        : [];

      for (const summary of summaries) {
        const converted = convertEmeraldSummaryToXboxProduct(
          summary,
          mkt,
          regionMeta.currency,
          exchangeRates
        );
        if (converted) {
          const merged = upsertCatalogProduct(converted, false);
          bucket.push(merged);
        }
      }
    } catch {
      // ignore timeout
    }
    return bucket;
  };

  const fetchAutosuggestGames = async (): Promise<XboxProduct[]> => {
    const bucket: XboxProduct[] = [];
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const autosuggestUrl = `https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/autosuggest?market=${encodeURIComponent(
        regionMeta.code
      )}&languages=${encodeURIComponent(
        regionMeta.locale
      )}&query=${encodeURIComponent(apiQuery)}&productFamilyNames=Games&$top=15`;

      const res = await fetch(autosuggestUrl, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) return bucket;

      const data = (await res.json()) as {
        Results?: Array<{
          Products?: Array<{ ProductId?: string; Type?: string }>;
        }>;
      };
      const ids: string[] = [];
      for (const fam of data.Results || []) {
        for (const p of fam.Products || []) {
          const pid = String(p.ProductId || '').trim().toUpperCase();
          const pType = String(p.Type || 'Game').toLowerCase();
          if (BIG_ID_REGEX.test(pid) && !pType.includes('consumable')) {
            if (!ids.includes(pid) && ids.length < 15) {
              ids.push(pid);
            }
          }
        }
      }
      if (ids.length === 0) return bucket;

      const dcUrl = `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${encodeURIComponent(
        ids.join(',')
      )}&market=${encodeURIComponent(
        regionMeta.code
      )}&languages=${encodeURIComponent(regionMeta.locale)}`;
      const dcRes = await fetch(dcUrl, {
        headers: { Accept: 'application/json' },
      });
      if (!dcRes.ok) return bucket;

      const dcData = (await dcRes.json()) as Record<string, unknown>;
      const nodes = Array.isArray(dcData.Products)
        ? (dcData.Products as Array<Record<string, unknown>>)
        : [];
      for (const node of nodes) {
        const quote = extractMsProductFromNode(
          node,
          regionMeta.code,
          regionMeta.currency
        );
        if (quote.listPrice <= 0 && quote.salePrice === null) continue;
        const syntheticSummary: Record<string, unknown> = {
          productId: quote.bigId,
          title: quote.title,
          shortDescription: quote.description,
          developerName: quote.developer,
          publisherName: quote.publisher,
          releaseDate: quote.releaseDate,
          productKind: quote.productType,
          availableOn: quote.platforms,
          includedWithPassesProductIds: quote.includedInGamePass
            ? ['CFQ7TTC0K6L8']
            : [],
          images: { poster: { url: quote.coverUrl } },
          specificPrices: {
            purchaseable: [
              {
                msrp: quote.listPrice,
                listPrice:
                  quote.salePrice ?? quote.gamePassPrice ?? quote.listPrice,
                discountPercentage: quote.discountPct,
                currency: quote.currency,
                endDateUtc: quote.endDate,
                hasXPriceOffer:
                  quote.gamePassPrice !== null && quote.salePrice === null,
              },
            ],
          },
        };
        const built = convertEmeraldSummaryToXboxProduct(
          syntheticSummary,
          regionMeta.code,
          regionMeta.currency,
          exchangeRates
        );
        if (built) {
          bucket.push(upsertCatalogProduct(built, false));
        }
      }
    } catch {
      // ignore timeout
    }
    return bucket;
  };

  const [emeraldGames, autosuggestGames, emeraldAddons] = await Promise.all([
    fetchEmeraldChannel(
      `https://emerald.xboxservices.com/xboxcomfd/search/games?locale=${encodeURIComponent(
        regionMeta.locale
      )}`,
      'SEARCH_GAMES',
      'games'
    ),
    fetchAutosuggestGames(),
    fetchEmeraldChannel(
      `https://emerald.xboxservices.com/xboxcomfd/search/addons?locale=${encodeURIComponent(
        regionMeta.locale
      )}`,
      'SEARCH_ADDONS',
      'addons'
    ),
  ]);

  gameProducts.push(...emeraldGames, ...autosuggestGames);
  addonProducts.push(...emeraldAddons);

  const byBigId = new Map<string, XboxProduct>();
  for (const prod of gameProducts) {
    byBigId.set(prod.bigId, prod);
  }
  // Only include up to 8 addons unless the user explicitly searched for DLCs
  const maxAddons = wantsDlcExplicitly ? 25 : 6;
  let addedAddons = 0;
  for (const prod of addonProducts) {
    if (byBigId.has(prod.bigId)) continue;
    if (prod.productType === 'Add-on') {
      if (addedAddons >= maxAddons) continue;
      addedAddons++;
    }
    byBigId.set(prod.bigId, prod);
  }

  for (const prod of catalogProducts) {
    if (byBigId.has(prod.bigId)) continue;
    const titleScore = fuzzyMatchScore(q, prod.title);
    const devScore = fuzzyMatchScore(q, `${prod.publisher} ${prod.developer}`);
    if (
      (extractedBigId && prod.bigId === extractedBigId) ||
      titleScore >= 65 ||
      devScore >= 85
    ) {
      byBigId.set(prod.bigId, prod);
    }
  }

  return rankSearchResults(Array.from(byBigId.values()), q, mkt);
}

async function hydrateMultiRegionPricesFromMsCatalog(
  product: XboxProduct,
  forceRefresh = false
): Promise<number> {
  if (!BIG_ID_REGEX.test(product.bigId)) return 0;

  const lastHydrated = hydratedMultiRegionTimestamps.get(product.bigId) || 0;
  if (!forceRefresh && Date.now() - lastHydrated < 10 * 60 * 1000) {
    return Object.keys(product.pricesByRegion).length;
  }

  let updatedMarkets = 0;

  await Promise.all(
    XBOX_REGIONS.map(async (region) => {
      const url = `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${encodeURIComponent(
        product.bigId
      )}&market=${encodeURIComponent(
        region.code
      )}&languages=${encodeURIComponent(region.locale)}`;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(url, {
          headers: { Accept: 'application/json', 'MS-CV': 'DGU1mcuYo0WMMp+F.1' },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) return;

        const data = (await res.json()) as Record<string, unknown>;
        const nodes = Array.isArray(data.Products)
          ? (data.Products as Array<Record<string, unknown>>)
          : [];
        if (nodes.length === 0) return;

        const quote = extractMsProductFromNode(
          nodes[0],
          region.code,
          region.currency
        );
        if (quote.listPrice <= 0 && quote.salePrice === null) return;

        const prevPrice = product.pricesByRegion[region.code];
        const prevHistory = product.historyByRegion[region.code] || [];
        const delta = detectPriceDeltaAndUpdateHistory(
          prevPrice,
          quote,
          prevHistory,
          '2026-11-05'
        );

        product.pricesByRegion[region.code] = delta.updatedRegionalPrice;
        product.historyByRegion[region.code] = delta.updatedHistory;
        updatedMarkets++;
      } catch {
        // Keep baseline regional price if a specific market times out
      }
    })
  );

  if (updatedMarkets > 0) {
    hydratedMultiRegionTimestamps.set(product.bigId, Date.now());
  }

  return updatedMarkets;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Security Hardening: Remove Express fingerprint & enforce strict JSON payload limit
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  // Security Headers Middleware
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=()'
    );
    next();
  });

  // Per-IP Sliding Window Rate Limiter for /api/* routes (120 req/min)
  app.use('/api', (req, res, next) => {
    const clientIp = String(req.ip || req.socket.remoteAddress || 'local');
    const now = Date.now();
    const bucket = rateLimitBuckets.get(clientIp);
    if (!bucket || now > bucket.resetAt) {
      rateLimitBuckets.set(clientIp, { count: 1, resetAt: now + 60_000 });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > 120) {
      res
        .status(429)
        .json({ error: 'Demasiadas solicitudes. Intenta de nuevo en unos segundos.' });
      return;
    }
    next();
  });

  // Initial background sync of live exchange rates & real Xbox Store deals
  refreshLiveExchangeRates().catch(() => {});
  syncLiveXboxDealsForRegion('MX', 3).catch(() => {});

  // 1. GET /api/regions
  app.get('/api/regions', (_req, res) => {
    res.json({
      regions: XBOX_REGIONS,
      exchangeRates,
      updatedAt: new Date().toISOString(),
    });
  });

  // 2. GET /api/catalog/all
  app.get('/api/catalog/all', async (req, res) => {
    const regionCode = sanitizeRegionCode(req.query.region);
    if (!syncedRegionsSet.has(regionCode)) {
      await syncLiveXboxDealsForRegion(regionCode, 3);
    }
    res.json({
      regionCode,
      totalProducts: catalogProducts.length,
      products: catalogProducts,
      updatedAt: new Date().toISOString(),
    });
  });

  // 3. GET /api/live/search
  app.get('/api/live/search', async (req, res) => {
    const query = sanitizeSearchQuery(req.query.q);
    const regionCode = sanitizeRegionCode(req.query.region);

    if (!query) {
      res.json({
        query: '',
        regionCode,
        count: 0,
        results: [],
      });
      return;
    }

    const results = await searchLiveXboxStore(query, regionCode);

    // Batch-hydrate the top 15 results across key comparison markets in a single batch per market
    const priorityMarkets = XBOX_REGIONS.filter((r) =>
      ['MX', 'US', 'TR', 'AR', 'BR', 'CO', 'CL', 'ES', 'EG'].includes(r.code)
    );
    await batchHydrateProductsFromDisplayCatalog(
      results.slice(0, 15),
      priorityMarkets
    );

    res.json({
      query,
      regionCode,
      count: results.length,
      results,
      timestamp: new Date().toISOString(),
    });
  });

  // 4. POST /api/scraper/sync-live-deals
  app.post('/api/scraper/sync-live-deals', async (req, res) => {
    const regionCode = sanitizeRegionCode(
      req.body?.region || req.query.region
    );
    const pages = Math.min(Math.max(1, Number(req.body?.pages || 3)), 4);

    const { syncedCount } = await syncLiveXboxDealsForRegion(
      regionCode,
      pages
    );

    res.json({
      status: 'OK',
      regionCode,
      syncedCount,
      products: catalogProducts,
      timestamp: new Date().toISOString(),
    });
  });

  // 5. GET /api/products
  app.get('/api/products', async (req, res) => {
    const regionCode = sanitizeRegionCode(req.query.region);
    const currency = sanitizeCurrencyCode(req.query.currency);
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 12)));
    const searchQuery = sanitizeSearchQuery(req.query.q);

    if (!syncedRegionsSet.has(regionCode) && catalogProducts.length <= 10) {
      await syncLiveXboxDealsForRegion(regionCode, 2);
    }

    if (searchQuery.length >= 2) {
      await searchLiveXboxStore(searchQuery, regionCode);
    }

    const filters: FilterState = {
      tab: (req.query.tab as ExplorerTab) || 'new_deals',
      searchQuery,
      productType: (req.query.type as 'ALL' | ProductType) || 'ALL',
      minDiscountPct: Math.min(100, Math.max(0, Number(req.query.minDiscount || 0))),
      maxPriceInLocal: req.query.maxPrice ? Number(req.query.maxPrice) : null,
      subscriptionFilter:
        (req.query.subscription as FilterState['subscriptionFilter']) || 'ALL',
      platformFilter:
        (req.query.platform as 'ALL' | XboxPlatform) || 'ALL',
      sortBy: (req.query.sort as SortOption) || 'discount_desc',
    };

    const paginated = buildPaginatedProductsResponse({
      products: catalogProducts,
      regions: XBOX_REGIONS,
      filters,
      regionCode,
      targetCurrency: currency,
      ratesPerUsd: exchangeRates,
      page,
      limit,
      referenceNowIso: '2026-11-04T22:00:00Z',
    });

    res.json(paginated);
  });

  // 6. GET /api/products/:bigId
  app.get('/api/products/:bigId', async (req, res) => {
    const bigId = String(req.params.bigId || '').trim().toUpperCase();
    if (!BIG_ID_REGEX.test(bigId)) {
      res.status(400).json({ error: 'Identificador de producto inválido.' });
      return;
    }

    const regionCode = sanitizeRegionCode(req.query.region);
    const currency = sanitizeCurrencyCode(req.query.currency);
    const rawTimeframe = String(req.query.timeframe || 'ALL').toUpperCase();
    const timeframe: '3M' | '6M' | '1Y' | 'ALL' =
      rawTimeframe === '3M' || rawTimeframe === '6M' || rawTimeframe === '1Y'
        ? rawTimeframe
        : 'ALL';

    let product = catalogProducts.find((p) => p.bigId.toUpperCase() === bigId);
    if (!product) {
      product =
        (await fetchProductByBigIdFromDisplayCatalog(bigId, regionCode)) ||
        undefined;
    }
    if (!product) {
      res.status(404).json({ error: 'Producto no encontrado.' });
      return;
    }

    const rPrice =
      product.pricesByRegion[regionCode] || product.pricesByRegion['US'];
    const fullHistory =
      product.historyByRegion[regionCode] ||
      product.historyByRegion['US'] ||
      [];
    const analytics = calculatePriceAnalytics(fullHistory, rPrice);
    const filteredHistory = filterHistoryByTimeframe(
      fullHistory,
      timeframe,
      '2026-11-05T00:00:00Z'
    );

    const relatedProducts = catalogProducts.filter(
      (p) =>
        p.bigId !== product!.bigId &&
        (p.parentBigId === product!.bigId ||
          (product!.parentBigId &&
            (p.bigId === product!.parentBigId ||
              p.parentBigId === product!.parentBigId)))
    );

    const comparison = buildRegionalComparison(
      product,
      XBOX_REGIONS,
      regionCode,
      currency,
      exchangeRates
    );

    res.json({
      bigId: product.bigId,
      title: product.title,
      regionCode,
      targetCurrency: currency,
      timeframe,
      regionalPrice: rPrice,
      analytics,
      priceHistory: filteredHistory,
      relatedProducts: relatedProducts.map((r) => ({
        bigId: r.bigId,
        title: r.title,
        productType: r.productType,
        priceInRegion: r.pricesByRegion[regionCode] || r.pricesByRegion['US'],
      })),
      cheapestRegionsPreview: comparison.slice(0, 5),
      product,
    });
  });

  // 7. GET /api/products/:bigId/compare
  app.get('/api/products/:bigId/compare', async (req, res) => {
    const bigId = String(req.params.bigId || '').trim().toUpperCase();
    if (!BIG_ID_REGEX.test(bigId)) {
      res.status(400).json({ error: 'Identificador de producto inválido.' });
      return;
    }

    const regionCode = sanitizeRegionCode(req.query.region);
    const currency = sanitizeCurrencyCode(req.query.currency);
    const liveHydrate = req.query.live !== 'false';

    let product = catalogProducts.find((p) => p.bigId.toUpperCase() === bigId);
    if (!product) {
      product =
        (await fetchProductByBigIdFromDisplayCatalog(bigId, regionCode)) ||
        undefined;
    }
    if (!product) {
      res.status(404).json({ error: 'Producto no encontrado.' });
      return;
    }

    if (liveHydrate) {
      await hydrateMultiRegionPricesFromMsCatalog(product, false);
    }

    const comparison = buildRegionalComparison(
      product,
      XBOX_REGIONS,
      regionCode,
      currency,
      exchangeRates
    );

    res.json({
      bigId: product.bigId,
      title: product.title,
      userRegion: regionCode,
      targetCurrency: currency,
      totalRegionsCompared: comparison.length,
      cheapestRegion: comparison[0] || null,
      comparison,
      product,
    });
  });

  // 8. Watchlist CRUD
  app.get('/api/watchlist', (req, res) => {
    const regionCode = sanitizeRegionCode(req.query.region);
    const currency = sanitizeCurrencyCode(req.query.currency);
    const sortBy =
      (req.query.sort as WatchlistSortOption) || 'on_sale_now';

    const enriched = buildEnrichedWatchlistResponse({
      watchlist: serverWatchlist,
      products: catalogProducts,
      sortBy,
      userRegionCode: regionCode,
      targetCurrency: currency,
      ratesPerUsd: exchangeRates,
    });

    res.json(enriched);
  });

  app.post('/api/watchlist', (req, res) => {
    const validBigIds = new Set(catalogProducts.map((p) => p.bigId));
    const validation = validateWatchlistPayload(
      (req.body || {}) as Record<string, unknown>,
      validBigIds
    );

    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const item = validation.item;
    const idx = serverWatchlist.findIndex((w) => w.bigId === item.bigId);
    if (idx >= 0) {
      serverWatchlist[idx] = item;
    } else {
      serverWatchlist.unshift(item);
    }

    res.status(201).json({
      status: idx >= 0 ? 'UPDATED' : 'CREATED',
      item,
      totalWatched: serverWatchlist.length,
    });
  });

  app.patch('/api/watchlist/:bigId', (req, res) => {
    const bigId = String(req.params.bigId || '').trim().toUpperCase();
    if (!BIG_ID_REGEX.test(bigId)) {
      res.status(400).json({ error: 'Identificador inválido.' });
      return;
    }

    const existing = serverWatchlist.find((w) => w.bigId === bigId);
    if (!existing) {
      res
        .status(404)
        .json({ error: 'El juego no está en tu lista de seguimiento.' });
      return;
    }

    const validBigIds = new Set(catalogProducts.map((p) => p.bigId));
    const validation = validateWatchlistPayload(
      {
        ...existing,
        ...(req.body || {}),
        bigId,
      },
      validBigIds
    );

    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    serverWatchlist = serverWatchlist.map((w) =>
      w.bigId === bigId ? validation.item : w
    );
    res.json({ status: 'UPDATED', item: validation.item });
  });

  app.delete('/api/watchlist/:bigId', (req, res) => {
    const bigId = String(req.params.bigId || '').trim().toUpperCase();
    const beforeLen = serverWatchlist.length;
    serverWatchlist = serverWatchlist.filter((w) => w.bigId !== bigId);
    res.json({
      status: serverWatchlist.length < beforeLen ? 'DELETED' : 'NOT_FOUND',
      bigId,
      totalWatched: serverWatchlist.length,
    });
  });

  // 9. POST /api/alerts/evaluate
  app.post('/api/alerts/evaluate', (req, res) => {
    const watchlist = Array.isArray(req.body?.watchlist)
      ? (req.body.watchlist as WatchlistItem[]).slice(0, 100)
      : [];
    const targetCurrency = sanitizeCurrencyCode(req.body?.currency);

    const productsMap: Record<string, XboxProduct> = {};
    for (const p of catalogProducts) {
      productsMap[p.bigId] = p;
    }

    const triggeredAlerts = evaluateWatchlistAlerts(
      watchlist,
      productsMap,
      targetCurrency,
      exchangeRates
    );

    res.json({
      evaluatedCount: watchlist.length,
      triggeredCount: triggeredAlerts.length,
      alerts: triggeredAlerts,
    });
  });

  // 10. POST /api/notifications/run-worker
  app.post('/api/notifications/run-worker', (req, res) => {
    const userRegion = sanitizeRegionCode(req.body?.region);
    const targetCurrency = sanitizeCurrencyCode(req.body?.currency);
    const customWatchlist = Array.isArray(req.body?.watchlist)
      ? (req.body.watchlist as WatchlistItem[]).slice(0, 100)
      : serverWatchlist;

    const cycle = runNotificationWorkerCycle(
      catalogProducts,
      customWatchlist,
      XBOX_REGIONS,
      userRegion,
      targetCurrency,
      exchangeRates
    );

    res.json({
      workerStatus: 'COMPLETED',
      evaluatedWatchlistCount: customWatchlist.length,
      triggeredWatchlistAlertsCount: cycle.watchlistAlerts.length,
      watchlistAlerts: cycle.watchlistAlerts,
      weeklyWaveAlert: cycle.weeklyWaveAlert,
      executedAt: new Date().toISOString(),
    });
  });

  // 11. POST /api/notifications/weekly-wave
  app.post('/api/notifications/weekly-wave', (req, res) => {
    const userRegion = sanitizeRegionCode(req.body?.region);
    const targetCurrency = sanitizeCurrencyCode(req.body?.currency);

    const wave = buildWeeklyDealsWaveNotification(
      catalogProducts,
      XBOX_REGIONS,
      userRegion,
      targetCurrency,
      exchangeRates
    );

    res.json({
      workerStatus: 'DISPATCHED_WEEKLY_WAVE',
      wave,
      executedAt: new Date().toISOString(),
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`XB Pulse Server running on http://localhost:${PORT}`);
  });
}

startServer();
