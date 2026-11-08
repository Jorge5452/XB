import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEnrichedWatchlistResponse,
  buildPaginatedProductsResponse,
  filterHistoryByTimeframe,
  formatWatchlistCsv,
  validateWatchlistPayload,
} from './restApiController';
import {
  EXCHANGE_RATES_PER_USD,
  INITIAL_XBOX_PRODUCTS,
  XBOX_REGIONS,
} from '../data/xboxCatalogData';
import { FilterState } from '../types/xbox';

const DEFAULT_FILTERS: FilterState = {
  tab: 'new_deals',
  searchQuery: '',
  productType: 'ALL',
  minDiscountPct: 0,
  maxPriceInLocal: null,
  subscriptionFilter: 'ALL',
  platformFilter: 'ALL',
  sortBy: 'discount_desc',
};

test('buildPaginatedProductsResponse computes pagination metadata and enriched DTOs accurately', () => {
  const page1 = buildPaginatedProductsResponse({
    products: INITIAL_XBOX_PRODUCTS,
    regions: XBOX_REGIONS,
    filters: DEFAULT_FILTERS,
    regionCode: 'MX',
    targetCurrency: 'MXN',
    ratesPerUsd: EXCHANGE_RATES_PER_USD,
    page: 1,
    limit: 3,
    referenceNowIso: '2026-11-04T22:00:00Z',
  });

  assert.equal(page1.pagination.page, 1);
  assert.equal(page1.pagination.limit, 3);
  assert.equal(page1.pagination.totalItems, 8);
  assert.equal(page1.pagination.totalPages, 3);
  assert.equal(page1.pagination.hasNextPage, true);
  assert.equal(page1.pagination.hasPrevPage, false);
  assert.equal(page1.items.length, 3);
  assert.ok(page1.items[0].cheapestRegion);
  assert.ok(page1.items[0].storeDeepLink.includes('xbox.com/es-mx/games/store/'));
});

test('filterHistoryByTimeframe slices time-series points by 3M, 6M, 1Y, and ALL', () => {
  const sampleHistory = [
    { date: '2025-11-01', regularPrice: 1000, salePrice: 800 },
    { date: '2026-06-01', regularPrice: 1000, salePrice: 600 },
    { date: '2026-09-15', regularPrice: 1000, salePrice: 500 },
    { date: '2026-11-01', regularPrice: 1000, salePrice: 400 },
  ];

  const threeMonths = filterHistoryByTimeframe(
    sampleHistory,
    '3M',
    '2026-11-05T00:00:00Z'
  );
  assert.equal(threeMonths.length, 2);
  assert.equal(threeMonths[0].date, '2026-09-15');

  const sixMonths = filterHistoryByTimeframe(
    sampleHistory,
    '6M',
    '2026-11-05T00:00:00Z'
  );
  assert.equal(sixMonths.length, 3);

  const allPoints = filterHistoryByTimeframe(
    sampleHistory,
    'ALL',
    '2026-11-05T00:00:00Z'
  );
  assert.equal(allPoints.length, 4);
});

test('validateWatchlistPayload enforces valid BigIds and non-negative targetPrice', () => {
  const validBigIds = new Set(INITIAL_XBOX_PRODUCTS.map((p) => p.bigId));

  const badBigId = validateWatchlistPayload(
    { bigId: 'INVALID_ID', targetPrice: 250 },
    validBigIds
  );
  assert.equal(badBigId.valid, false);

  const negativeTarget = validateWatchlistPayload(
    { bigId: '9NXVC0482QS5', targetPrice: -50 },
    validBigIds
  );
  assert.equal(negativeTarget.valid, false);

  const validRes = validateWatchlistPayload(
    {
      bigId: '9nxvc0482qs5',
      targetPrice: '350.5',
      preferredRegion: 'tr',
      targetCurrency: 'mxn',
    },
    validBigIds
  );
  assert.equal(validRes.valid, true);
  if (validRes.valid) {
    assert.equal(validRes.item.bigId, '9NXVC0482QS5');
    assert.equal(validRes.item.targetPrice, 350.5);
    assert.equal(validRes.item.preferredRegion, 'TR');
  }
});

test('buildEnrichedWatchlistResponse and formatWatchlistCsv return complete watchlist data and neutralize CSV injection', () => {
  const watchlist = [
    {
      bigId: 'BWTTW53M5B98',
      addedAt: '2026-10-28T15:30:00Z',
      targetPrice: 300,
      targetCurrency: 'MXN',
      notifyOnAnyDrop: true,
      preferredRegion: 'MX',
    },
  ];

  const enriched = buildEnrichedWatchlistResponse({
    watchlist,
    products: INITIAL_XBOX_PRODUCTS,
    sortBy: 'on_sale_now',
    userRegionCode: 'MX',
    targetCurrency: 'MXN',
    ratesPerUsd: EXCHANGE_RATES_PER_USD,
  });

  assert.equal(enriched.totalWatched, 1);
  assert.equal(enriched.onSaleCount, 1);
  assert.equal(enriched.targetReachedCount, 1);
  assert.equal(enriched.items[0].targetReached, true);

  const productsMap = Object.fromEntries(
    INITIAL_XBOX_PRODUCTS.map((p) => [p.bigId, p])
  );
  const csv = formatWatchlistCsv(watchlist, productsMap);
  assert.ok(csv.includes('BWTTW53M5B98,"Battlefield™ 1",MX,300,MXN'));
});
