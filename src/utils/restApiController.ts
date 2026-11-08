import {
  ExplorerTab,
  FilterState,
  PriceAnalytics,
  PriceHistoryPoint,
  ProductType,
  RegionalComparisonRow,
  SortOption,
  WatchlistItem,
  WatchlistSortOption,
  XboxPlatform,
  XboxProduct,
  XboxRegion,
} from '../types/xbox';
import {
  buildRegionalComparison,
  buildXboxStoreDeepLink,
  calculatePriceAnalytics,
  convertCurrency,
  filterAndSortProducts,
  getEffectiveRegionalPrice,
  sortWatchlistItems,
} from './pricingEngine';

export interface PaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface ProductListItemDto {
  bigId: string;
  slug: string;
  title: string;
  subtitle?: string;
  productType: ProductType;
  platforms: XboxPlatform[];
  coverImage: string;
  regionCode: string;
  nativeCurrency: string;
  listPrice: number;
  effectivePrice: number;
  gamePassPrice: number | null;
  includedInGamePass: boolean;
  discountPct: number;
  endDate: string | null;
  convertedEffectivePrice: number;
  targetCurrency: string;
  lowestPriceEver: number;
  verdict: PriceAnalytics['verdict'];
  cheapestRegion: {
    regionCode: string;
    regionName: string;
    convertedPrice: number;
    savingsPctVsLocal: number;
  } | null;
  storeDeepLink: string;
}

export interface PaginatedProductsResponse {
  pagination: PaginationMeta;
  appliedFilters: FilterState & { regionCode: string; targetCurrency: string };
  items: ProductListItemDto[];
}

/**
 * Builds a paginated, filtered, fuzzy-searched product listing response with enriched regional & arbitrage metadata.
 */
export function buildPaginatedProductsResponse(params: {
  products: XboxProduct[];
  regions: XboxRegion[];
  filters: FilterState;
  regionCode: string;
  targetCurrency: string;
  ratesPerUsd: Record<string, number>;
  page?: number;
  limit?: number;
  referenceNowIso?: string;
}): PaginatedProductsResponse {
  const page = Math.max(1, Math.floor(params.page || 1));
  const limit = Math.min(50, Math.max(1, Math.floor(params.limit || 12)));

  const filtered = filterAndSortProducts(
    params.products,
    params.filters,
    params.regionCode,
    params.targetCurrency,
    params.ratesPerUsd,
    params.referenceNowIso
  );

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * limit;
  const sliced = filtered.slice(startIndex, startIndex + limit);

  const regionObj =
    params.regions.find((r) => r.code === params.regionCode) ||
    params.regions[0];

  const items: ProductListItemDto[] = sliced.map((product) => {
    const rPrice =
      product.pricesByRegion[params.regionCode] ||
      product.pricesByRegion['US'];
    const history =
      product.historyByRegion[params.regionCode] ||
      product.historyByRegion['US'] ||
      [];
    const analytics = calculatePriceAnalytics(history, rPrice);
    const effectivePrice = getEffectiveRegionalPrice(rPrice);
    const convertedEffectivePrice = convertCurrency(
      effectivePrice,
      rPrice.currency,
      params.targetCurrency,
      params.ratesPerUsd
    );

    const comparison = buildRegionalComparison(
      product,
      params.regions,
      params.regionCode,
      params.targetCurrency,
      params.ratesPerUsd
    );
    const cheapest = comparison[0];

    return {
      bigId: product.bigId,
      slug: product.slug,
      title: product.title,
      subtitle: product.subtitle,
      productType: product.productType,
      platforms: product.platforms,
      coverImage: product.coverImage,
      regionCode: rPrice.regionCode,
      nativeCurrency: rPrice.currency,
      listPrice: rPrice.listPrice,
      effectivePrice,
      gamePassPrice: rPrice.gamePassPrice,
      includedInGamePass: rPrice.includedInGamePass,
      discountPct: analytics.discountPct,
      endDate: rPrice.endDate,
      convertedEffectivePrice,
      targetCurrency: params.targetCurrency,
      lowestPriceEver: analytics.lowestPriceEver,
      verdict: analytics.verdict,
      cheapestRegion: cheapest
        ? {
            regionCode: cheapest.regionCode,
            regionName: cheapest.regionName,
            convertedPrice: cheapest.convertedPrice,
            savingsPctVsLocal: cheapest.savingsPctVsLocal,
          }
        : null,
      storeDeepLink: buildXboxStoreDeepLink(
        regionObj.locale,
        product.slug,
        product.bigId
      ),
    };
  });

  return {
    pagination: {
      page: safePage,
      limit,
      totalItems,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPrevPage: safePage > 1,
    },
    appliedFilters: {
      ...params.filters,
      regionCode: params.regionCode,
      targetCurrency: params.targetCurrency,
    },
    items,
  };
}

/**
 * Filters price history points by timeframe ('3M' | '6M' | '1Y' | 'ALL').
 */
export function filterHistoryByTimeframe(
  history: PriceHistoryPoint[],
  timeframe: '3M' | '6M' | '1Y' | 'ALL' = 'ALL',
  referenceDateIso = '2026-11-05T00:00:00Z'
): PriceHistoryPoint[] {
  if (timeframe === 'ALL' || history.length <= 2) return history;
  const refMs = new Date(referenceDateIso).getTime();
  const daysMap: Record<'3M' | '6M' | '1Y', number> = {
    '3M': 92,
    '6M': 185,
    '1Y': 365,
  };
  const cutoffMs = refMs - daysMap[timeframe] * 24 * 3600 * 1000;
  const subset = history.filter((pt) => new Date(pt.date).getTime() >= cutoffMs);
  return subset.length > 0 ? subset : history.slice(-2);
}

/**
 * Sanitizes a string before writing into a CSV cell to prevent CSV Formula Injection (DDE/Excel injection).
 */
export function sanitizeCsvCell(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ').trim();
  const neutralized = /^[=+\-@\t]/.test(clean) ? `'${clean}` : clean;
  return neutralized.replace(/"/g, '""');
}

/**
 * Validates incoming Watchlist create/update payloads for POST /api/watchlist and PATCH /api/watchlist/:bigId.
 */
export function validateWatchlistPayload(
  payload: Record<string, unknown>,
  availableBigIds: Set<string>,
  fallbackRegion = 'MX',
  fallbackCurrency = 'MXN'
): { valid: true; item: WatchlistItem } | { valid: false; error: string } {
  const bigId = String(payload.bigId || '').trim().toUpperCase();
  if (!bigId || !/^[A-Z0-9]{12}$/.test(bigId)) {
    return { valid: false, error: 'El identificador del producto no es válido.' };
  }
  if (!availableBigIds.has(bigId)) {
    return {
      valid: false,
      error: `El producto '${bigId}' no se encuentra en el catálogo.`,
    };
  }

  let targetPrice: number | null = null;
  if (
    payload.targetPrice !== null &&
    payload.targetPrice !== undefined &&
    String(payload.targetPrice).trim() !== ''
  ) {
    const parsed = Number(payload.targetPrice);
    if (Number.isNaN(parsed) || !Number.isFinite(parsed) || parsed < 0 || parsed > 10_000_000) {
      return {
        valid: false,
        error: 'El precio objetivo debe ser un monto válido mayor o igual a 0.',
      };
    }
    targetPrice = Number(parsed.toFixed(2));
  }

  const rawRegion = String(payload.preferredRegion || fallbackRegion)
    .trim()
    .toUpperCase();
  const preferredRegion = /^[A-Z]{2}$/.test(rawRegion)
    ? rawRegion
    : fallbackRegion;

  const rawCurrency = String(payload.targetCurrency || fallbackCurrency)
    .trim()
    .toUpperCase();
  const targetCurrency = /^[A-Z]{3}$/.test(rawCurrency)
    ? rawCurrency
    : fallbackCurrency;

  const notifyOnAnyDrop =
    payload.notifyOnAnyDrop === undefined
      ? true
      : Boolean(payload.notifyOnAnyDrop);

  const safeNotes =
    typeof payload.notes === 'string'
      ? payload.notes.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 200)
      : undefined;

  return {
    valid: true,
    item: {
      bigId,
      addedAt:
        typeof payload.addedAt === 'string' &&
        !Number.isNaN(new Date(payload.addedAt).getTime())
          ? payload.addedAt
          : new Date().toISOString(),
      targetPrice,
      targetCurrency,
      notifyOnAnyDrop,
      preferredRegion,
      notes: safeNotes,
    },
  };
}

/**
 * Formats a user's Watchlist as RFC 4180 CSV text with formula-injection protection.
 */
export function formatWatchlistCsv(
  watchlist: WatchlistItem[],
  productsMap: Record<string, XboxProduct>
): string {
  const header =
    'bigId,title,preferredRegion,targetPrice,targetCurrency,notifyOnAnyDrop,addedAt';
  const rows = watchlist.map((item) => {
    const prod = productsMap[item.bigId];
    const safeTitle = sanitizeCsvCell(prod?.title || item.bigId);
    const safeRegion = sanitizeCsvCell(item.preferredRegion);
    const safeCurrency = sanitizeCsvCell(item.targetCurrency);
    return `${item.bigId},"${safeTitle}",${safeRegion},${item.targetPrice ?? ''},${safeCurrency},${item.notifyOnAnyDrop},${item.addedAt}`;
  });
  return [header, ...rows].join('\n');
}

/**
 * Enriches Watchlist items with current regional pricing, conversion, countdown, and target status.
 */
export function buildEnrichedWatchlistResponse(params: {
  watchlist: WatchlistItem[];
  products: XboxProduct[];
  sortBy: WatchlistSortOption;
  userRegionCode: string;
  targetCurrency: string;
  ratesPerUsd: Record<string, number>;
}): {
  totalWatched: number;
  onSaleCount: number;
  targetReachedCount: number;
  sortBy: WatchlistSortOption;
  items: Array<
    WatchlistItem & {
      title: string;
      productType: ProductType;
      nativeCurrency: string;
      nativeEffectivePrice: number;
      convertedEffectivePrice: number;
      discountPct: number;
      endDate: string | null;
      targetReached: boolean;
    }
  >;
} {
  const productsMap: Record<string, XboxProduct> = {};
  for (const p of params.products) productsMap[p.bigId] = p;

  const sorted = sortWatchlistItems(
    params.watchlist,
    productsMap,
    params.sortBy,
    params.userRegionCode,
    params.targetCurrency,
    params.ratesPerUsd
  );

  let onSaleCount = 0;
  let targetReachedCount = 0;

  const enriched = sorted
    .map((item) => {
      const product = productsMap[item.bigId];
      if (!product) return null;

      const rPrice =
        product.pricesByRegion[item.preferredRegion] ||
        product.pricesByRegion[params.userRegionCode] ||
        product.pricesByRegion['US'];
      const nativeEffectivePrice = getEffectiveRegionalPrice(rPrice);
      const convertedEffectivePrice = convertCurrency(
        nativeEffectivePrice,
        rPrice.currency,
        params.targetCurrency,
        params.ratesPerUsd
      );

      if (rPrice.discountPct > 0) onSaleCount++;

      const targetReached =
        item.targetPrice !== null &&
        item.targetPrice > 0 &&
        convertedEffectivePrice <= item.targetPrice;
      if (targetReached) targetReachedCount++;

      return {
        ...item,
        title: product.title,
        productType: product.productType,
        nativeCurrency: rPrice.currency,
        nativeEffectivePrice,
        convertedEffectivePrice,
        discountPct: rPrice.discountPct,
        endDate: rPrice.endDate,
        targetReached,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return {
    totalWatched: enriched.length,
    onSaleCount,
    targetReachedCount,
    sortBy: params.sortBy,
    items: enriched,
  };
}
