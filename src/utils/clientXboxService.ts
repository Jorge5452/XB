import {
  EXCHANGE_RATES_PER_USD,
  XBOX_REGIONS,
} from '../data/xboxCatalogData';
import { LIVE_DEALS_SNAPSHOT } from '../data/liveDealsSnapshot';
import { WatchlistItem, XboxProduct } from '../types/xbox';
import {
  batchHydrateProductsFromDisplayCatalog,
  convertEmeraldSummaryToXboxProduct,
  extractBigIdFromQuery,
  extractMsProductFromNode,
} from './msCatalogScraper';
import { runNotificationWorkerCycle } from './notificationWorker';
import {
  expandXboxSearchQuery,
  fuzzyMatchScore,
  rankSearchResults,
} from './pricingEngine';

const BIG_ID_REGEX = /^[A-Z0-9]{12}$/;

/**
 * Tracks whether the backend API is available.
 * If hosted on GitHub Pages (`*.github.io`), starts in static mode immediately
 * so the browser console stays 100% clean without 404 requests to `/api/*`.
 */
let backendMode: 'UNKNOWN' | 'SERVER' | 'STATIC_GH_PAGES' =
  typeof window !== 'undefined' &&
  (window.location.hostname.endsWith('.github.io') ||
    window.location.protocol === 'file:')
    ? 'STATIC_GH_PAGES'
    : 'UNKNOWN';

async function tryApiFetchJson<T>(
  url: string,
  options?: RequestInit
): Promise<T | null> {
  if (backendMode === 'STATIC_GH_PAGES') {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      if (res.status === 404 || !contentType.includes('application/json')) {
        backendMode = 'STATIC_GH_PAGES';
      }
      return null;
    }

    backendMode = 'SERVER';
    return (await res.json()) as T;
  } catch {
    backendMode = 'STATIC_GH_PAGES';
    return null;
  }
}

/**
 * Fetches live USD-based exchange rates from open.er-api.com (CORS-enabled)
 * and updates EXCHANGE_RATES_PER_USD in-place so all currency conversions are accurate.
 */
export async function fetchLiveExchangeRates(): Promise<Record<string, number>> {
  const apiData = await tryApiFetchJson<{
    exchangeRates?: Record<string, number>;
  }>('/api/regions');
  if (apiData?.exchangeRates) {
    Object.assign(EXCHANGE_RATES_PER_USD, apiData.exchangeRates);
    return { ...EXCHANGE_RATES_PER_USD };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = (await res.json()) as { rates?: Record<string, number> };
      if (data?.rates) {
        for (const key of Object.keys(EXCHANGE_RATES_PER_USD)) {
          const liveRate = data.rates[key];
          if (typeof liveRate === 'number' && liveRate > 0) {
            EXCHANGE_RATES_PER_USD[key] = Number(liveRate.toFixed(4));
          }
        }
      }
    }
  } catch {
    // Fallback to pre-loaded EXCHANGE_RATES_PER_USD
  }

  return { ...EXCHANGE_RATES_PER_USD };
}

/**
 * Fetches static `./catalog-snapshot.json` when running on GitHub Pages
 * and falls back to bundled `LIVE_DEALS_SNAPSHOT`.
 */
async function loadStaticCatalogSnapshot(): Promise<XboxProduct[]> {
  try {
    const res = await fetch(`./catalog-snapshot.json`, {
      cache: 'no-cache',
    });
    if (res.ok) {
      const data = (await res.json()) as { products?: XboxProduct[] };
      if (Array.isArray(data?.products) && data.products.length > 0) {
        return data.products;
      }
    }
  } catch {
    // Fallback to bundled snapshot
  }
  return LIVE_DEALS_SNAPSHOT;
}

/**
 * Converts a DisplayCatalog node into an XboxProduct.
 */
function buildProductFromDisplayCatalogNode(
  node: Record<string, unknown>,
  regionCode: string,
  currency: string
): XboxProduct | null {
  const quote = extractMsProductFromNode(node, regionCode, currency);
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
    images: { poster: { url: quote.coverUrl } },
    specificPrices: {
      purchaseable: [
        {
          msrp: quote.listPrice,
          listPrice: quote.salePrice ?? quote.gamePassPrice ?? quote.listPrice,
          discountPercentage: quote.discountPct,
          currency: quote.currency,
          endDateUtc: quote.endDate,
          hasXPriceOffer:
            quote.gamePassPrice !== null && quote.salePrice === null,
        },
      ],
    },
  };

  return convertEmeraldSummaryToXboxProduct(
    syntheticSummary,
    regionCode,
    currency,
    EXCHANGE_RATES_PER_USD
  );
}

/**
 * Queries Microsoft Display Catalog v7.0 autosuggest + products directly from the browser (CORS-enabled).
 * Prioritizes Games over Add-ons.
 */
async function searchDirectDisplayCatalogFromBrowser(
  query: string,
  regionCode: string
): Promise<XboxProduct[]> {
  const regionMeta =
    XBOX_REGIONS.find((r) => r.code === regionCode.toUpperCase()) ||
    XBOX_REGIONS[0];

  const candidateBigIds: string[] = [];
  const extractedBigId = extractBigIdFromQuery(query);
  if (extractedBigId && BIG_ID_REGEX.test(extractedBigId)) {
    candidateBigIds.push(extractedBigId);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const apiQuery = expandXboxSearchQuery(query);
    const autosuggestUrl = `https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/autosuggest?market=${encodeURIComponent(
      regionMeta.code
    )}&languages=${encodeURIComponent(
      regionMeta.locale
    )}&query=${encodeURIComponent(apiQuery)}&productFamilyNames=Games&$top=20`;

    const res = await fetch(autosuggestUrl, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = (await res.json()) as {
        Results?: Array<{
          Products?: Array<{ ProductId?: string; Type?: string; Title?: string }>;
        }>;
      };
      const gameIds: string[] = [];
      const addonIds: string[] = [];

      for (const fam of data.Results || []) {
        for (const p of fam.Products || []) {
          const pid = String(p.ProductId || '').trim().toUpperCase();
          if (!BIG_ID_REGEX.test(pid)) continue;
          const pType = String(p.Type || 'Game').toLowerCase();
          if (pType.includes('consumable')) continue;
          if (pType === 'game' || pType.includes('bundle')) {
            gameIds.push(pid);
          } else {
            addonIds.push(pid);
          }
        }
      }

      for (const id of [...gameIds, ...addonIds]) {
        if (!candidateBigIds.includes(id) && candidateBigIds.length < 20) {
          candidateBigIds.push(id);
        }
      }
    }
  } catch {
    // Ignore network error
  }

  if (candidateBigIds.length === 0) return [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const url = `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${encodeURIComponent(
      candidateBigIds.join(',')
    )}&market=${encodeURIComponent(
      regionMeta.code
    )}&languages=${encodeURIComponent(regionMeta.locale)}`;

    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return [];

    const data = (await res.json()) as Record<string, unknown>;
    const nodes = Array.isArray(data.Products)
      ? (data.Products as Array<Record<string, unknown>>)
      : [];

    const builtProducts: XboxProduct[] = [];
    for (const node of nodes) {
      const prod = buildProductFromDisplayCatalogNode(
        node,
        regionMeta.code,
        regionMeta.currency
      );
      if (prod) {
        builtProducts.push(prod);
      }
    }

    // Also hydrate key comparison regions (TR, AR, US, BR, MX) in parallel so regional prices are 100% real
    const priorityCompareRegions = XBOX_REGIONS.filter((r) =>
      ['MX', 'US', 'TR', 'AR', 'BR', 'CO', 'CL', 'ES', 'EG'].includes(r.code) &&
      r.code !== regionMeta.code
    );
    await batchHydrateProductsFromDisplayCatalog(
      builtProducts.slice(0, 12),
      priorityCompareRegions
    );

    return builtProducts;
  } catch {
    return [];
  }
}

/**
 * Loads the Xbox deals catalog for the selected region (works in both Server and GitHub Pages modes).
 */
export async function loadCatalogForRegion(
  regionCode: string
): Promise<XboxProduct[]> {
  const apiData = await tryApiFetchJson<{ products?: XboxProduct[] }>(
    `/api/catalog/all?region=${encodeURIComponent(regionCode)}`
  );
  if (Array.isArray(apiData?.products) && apiData.products.length > 0) {
    return apiData.products;
  }

  return loadStaticCatalogSnapshot();
}

/**
 * Manually refreshes deals for the active region (works in both Server and GitHub Pages modes).
 */
export async function syncCatalogDealsForRegion(
  regionCode: string
): Promise<XboxProduct[]> {
  const apiData = await tryApiFetchJson<{ products?: XboxProduct[] }>(
    `/api/scraper/sync-live-deals`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ region: regionCode, pages: 3 }),
    }
  );
  if (Array.isArray(apiData?.products) && apiData.products.length > 0) {
    return apiData.products;
  }

  return loadStaticCatalogSnapshot();
}

/**
 * Searches the Xbox Store catalog by title, publisher, or 12-char BigId / Xbox URL.
 * Prioritizes base Games and Editions ahead of DLCs (Add-ons).
 */
export async function searchXboxCatalog(
  query: string,
  regionCode: string,
  existingProducts: XboxProduct[]
): Promise<XboxProduct[]> {
  const cleanQuery = query.trim().slice(0, 80);
  if (cleanQuery.length < 2) return [];

  const apiData = await tryApiFetchJson<{ results?: XboxProduct[] }>(
    `/api/live/search?q=${encodeURIComponent(
      cleanQuery
    )}&region=${encodeURIComponent(regionCode)}`
  );
  if (Array.isArray(apiData?.results) && apiData.results.length > 0) {
    return rankSearchResults(apiData.results, cleanQuery, regionCode);
  }

  // Client-side direct Microsoft DisplayCatalog search + local catalog search for GitHub Pages
  const resultsMap = new Map<string, XboxProduct>();

  const directLiveProducts = await searchDirectDisplayCatalogFromBrowser(
    cleanQuery,
    regionCode
  );
  for (const prod of directLiveProducts) {
    resultsMap.set(prod.bigId, prod);
  }

  const extractedBigId = extractBigIdFromQuery(cleanQuery);
  const pool =
    existingProducts.length > 0 ? existingProducts : LIVE_DEALS_SNAPSHOT;
  for (const prod of pool) {
    if (resultsMap.has(prod.bigId)) continue;
    const titleScore = fuzzyMatchScore(cleanQuery, prod.title);
    const pubScore = fuzzyMatchScore(
      cleanQuery,
      `${prod.publisher} ${prod.developer}`
    );
    if (
      (extractedBigId && prod.bigId.toUpperCase() === extractedBigId) ||
      titleScore >= 60 ||
      pubScore >= 82
    ) {
      resultsMap.set(prod.bigId, prod);
    }
  }

  return rankSearchResults(
    Array.from(resultsMap.values()),
    cleanQuery,
    regionCode
  );
}

/**
 * Hydrates 16-country pricing for a specific product.
 */
export async function hydrateProductMultiRegion(
  product: XboxProduct,
  regionCode: string,
  targetCurrency: string
): Promise<XboxProduct> {
  const apiData = await tryApiFetchJson<{ product?: XboxProduct }>(
    `/api/products/${encodeURIComponent(
      product.bigId
    )}/compare?region=${encodeURIComponent(
      regionCode
    )}&currency=${encodeURIComponent(targetCurrency)}`
  );
  if (apiData?.product) {
    return apiData.product;
  }

  // In GitHub Pages static mode, query DisplayCatalog directly across all 16 regions (CORS-enabled)
  const cloned: XboxProduct = {
    ...product,
    pricesByRegion: { ...product.pricesByRegion },
    historyByRegion: { ...product.historyByRegion },
  };
  await batchHydrateProductsFromDisplayCatalog([cloned], XBOX_REGIONS);
  return cloned;
}

/**
 * Evaluates watchlist alerts (works in both Server and GitHub Pages modes).
 */
export async function checkWatchlistPriceAlerts(
  products: XboxProduct[],
  watchlist: WatchlistItem[],
  regionCode: string,
  targetCurrency: string
) {
  await tryApiFetchJson(`/api/notifications/run-worker`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      region: regionCode,
      currency: targetCurrency,
      watchlist,
    }),
  });

  return runNotificationWorkerCycle(
    products,
    watchlist,
    XBOX_REGIONS,
    regionCode,
    targetCurrency,
    EXCHANGE_RATES_PER_USD
  );
}
