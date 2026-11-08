import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRegionalComparison,
  buildXboxStoreDeepLink,
  calculatePriceAnalytics,
  convertCurrency,
  evaluateWatchlistAlerts,
  filterAndSortProducts,
  fuzzyMatchScore,
  parseMsDisplayCatalogPayload,
  rankSearchResults,
} from './pricingEngine';
import { EXCHANGE_RATES_PER_USD } from '../data/xboxCatalogData';
import { FilterState, RegionalPrice, XboxProduct, XboxRegion } from '../types/xbox';

const MOCK_RATES: Record<string, number> = {
  USD: 1.0,
  MXN: 20.0,
  ARS: 1000.0,
  TRY: 34.0,
  BRL: 5.8,
  EUR: 0.92,
};

const MOCK_REGIONS: XboxRegion[] = [
  {
    code: 'MX',
    locale: 'es-mx',
    name: 'México',
    currency: 'MXN',
    symbol: 'MX$',
    regionGroup: 'Americas',
  },
  {
    code: 'US',
    locale: 'en-us',
    name: 'Estados Unidos',
    currency: 'USD',
    symbol: 'US$',
    regionGroup: 'Americas',
  },
  {
    code: 'TR',
    locale: 'tr-tr',
    name: 'Turquía',
    currency: 'TRY',
    symbol: '₺',
    regionGroup: 'Europe',
  },
  {
    code: 'AR',
    locale: 'es-ar',
    name: 'Argentina',
    currency: 'ARS',
    symbol: 'ARS$',
    regionGroup: 'Americas',
  },
];

test('convertCurrency accurately converts between regional currencies via USD base and 669 TRY is ~250 MXN', () => {
  // 340 TRY -> 10 USD -> 200 MXN
  const converted = convertCurrency(340, 'TRY', 'MXN', MOCK_RATES);
  assert.equal(converted, 200);

  // Real rates check: 669 TRY -> ~250.07 MXN (never +400 MXN)
  const realTryToMxn = convertCurrency(
    669,
    'TRY',
    'MXN',
    EXCHANGE_RATES_PER_USD
  );
  assert.ok(realTryToMxn > 230 && realTryToMxn < 270);

  // Same currency returns rounded value
  assert.equal(convertCurrency(599.9, 'MXN', 'MXN', MOCK_RATES), 599.9);
  assert.equal(convertCurrency(0, 'USD', 'MXN', MOCK_RATES), 0);
});

test('rankSearchResults prioritizes Base Games and Bundles ahead of DLC Add-ons', () => {
  const samplePrice: RegionalPrice = {
    regionCode: 'MX',
    currency: 'MXN',
    listPrice: 500,
    salePrice: null,
    gamePassPrice: null,
    includedInGamePass: false,
    discountPct: 0,
    startDate: '2026-11-01T00:00:00Z',
    endDate: null,
  };
  const dlcItem: XboxProduct = {
    bigId: '9NDLC0000001',
    slug: 'tekken-8-dlc-pack',
    title: 'TEKKEN 8 - Character Pass DLC',
    description: 'DLC',
    developer: 'Bandai Namco',
    publisher: 'Bandai Namco',
    releaseDate: '2025-01-01',
    productType: 'Add-on',
    platforms: ['Xbox Series X|S'],
    coverImage: '/img.jpg',
    screenshots: [],
    featuredDeal: false,
    addedToDealsAt: '2026-11-01T00:00:00Z',
    pricesByRegion: { MX: { ...samplePrice, discountPct: 50, salePrice: 250 } },
    historyByRegion: {},
  };
  const gameItem: XboxProduct = {
    ...dlcItem,
    bigId: '9PPSM14VKCLW',
    slug: 'tekken-8',
    title: 'TEKKEN 8',
    productType: 'Game',
    pricesByRegion: { MX: samplePrice },
  };

  const ranked = rankSearchResults([dlcItem, gameItem], 'Tekken', 'MX');
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].productType, 'Game');
  assert.equal(ranked[0].bigId, '9PPSM14VKCLW');
});

test('calculatePriceAnalytics detects Lowest Price Ever and assigns smart verdict', () => {
  const history = [
    { date: '2026-03-01', regularPrice: 1399, salePrice: 979 },
    { date: '2026-06-15', regularPrice: 1399, salePrice: 699.5 },
    { date: '2026-09-10', regularPrice: 1399, salePrice: 839 },
  ];

  const currentLowestPrice: RegionalPrice = {
    regionCode: 'MX',
    currency: 'MXN',
    listPrice: 1399,
    salePrice: 559.6,
    gamePassPrice: null,
    includedInGamePass: false,
    discountPct: 60,
    startDate: '2026-11-01T00:00:00Z',
    endDate: '2026-11-12T00:00:00Z',
  };

  const analytics = calculatePriceAnalytics(history, currentLowestPrice);
  assert.equal(analytics.lowestPriceEver, 559.6);
  assert.equal(analytics.verdict, 'Mínimo histórico');
  assert.equal(analytics.discountPct, 60);

  const inflatedPrice: RegionalPrice = {
    ...currentLowestPrice,
    salePrice: 1259,
    discountPct: 10,
  };
  const analyticsInflated = calculatePriceAnalytics(history, inflatedPrice);
  assert.equal(analyticsInflated.verdict, 'Precio inflado / Esperar');
  assert.equal(analyticsInflated.lowestPriceEver, 699.5);
});

test('buildRegionalComparison sorts cheapest region first and calculates savings vs user local store', () => {
  const product: XboxProduct = {
    bigId: '9NBLGGH4R6P9',
    slug: 'cyber-odyssey-2099',
    title: 'Cyber Odyssey 2099',
    description: 'Sci-fi RPG',
    developer: 'Aether Studios',
    publisher: 'Xbox Game Studios',
    releaseDate: '2025-10-15',
    productType: 'Game',
    platforms: ['Xbox Series X|S', 'Windows PC', 'Xbox Play Anywhere'],
    coverImage: '/cover.jpg',
    screenshots: [],
    featuredDeal: true,
    addedToDealsAt: '2026-11-02T00:00:00Z',
    pricesByRegion: {
      MX: {
        regionCode: 'MX',
        currency: 'MXN',
        listPrice: 1400,
        salePrice: 700, // 35 USD = 700 MXN
        gamePassPrice: null,
        includedInGamePass: false,
        discountPct: 50,
        startDate: '2026-11-01T00:00:00Z',
        endDate: '2026-11-10T00:00:00Z',
      },
      TR: {
        regionCode: 'TR',
        currency: 'TRY',
        listPrice: 1360,
        salePrice: 595, // 17.5 USD = 350 MXN (50% cheaper than MX!)
        gamePassPrice: null,
        includedInGamePass: false,
        discountPct: 56,
        startDate: '2026-11-01T00:00:00Z',
        endDate: '2026-11-10T00:00:00Z',
      },
      US: {
        regionCode: 'US',
        currency: 'USD',
        listPrice: 69.99,
        salePrice: 39.99, // 39.99 USD = 799.8 MXN
        gamePassPrice: null,
        includedInGamePass: false,
        discountPct: 43,
        startDate: '2026-11-01T00:00:00Z',
        endDate: '2026-11-10T00:00:00Z',
      },
    },
    historyByRegion: {},
  };

  const comparison = buildRegionalComparison(
    product,
    MOCK_REGIONS,
    'MX',
    'MXN',
    MOCK_RATES
  );

  assert.equal(comparison.length, 3);
  assert.equal(comparison[0].regionCode, 'TR');
  assert.equal(comparison[0].isCheapest, true);
  assert.equal(comparison[0].convertedPrice, 350);
  assert.equal(comparison[0].savingsPctVsLocal, 50);
  assert.equal(
    comparison[0].storeDeepLink,
    buildXboxStoreDeepLink('tr-tr', 'cyber-odyssey-2099', '9NBLGGH4R6P9')
  );
});

test('fuzzyMatchScore handles exact, substring, and typo-tolerant queries', () => {
  assert.ok(fuzzyMatchScore('Cyber Odyssey', 'Cyber Odyssey 2099: Ultimate') >= 80);
  // Typo tolerance: "Cybr Odissey" should still match "Cyber Odyssey 2099"
  assert.ok(fuzzyMatchScore('Cybr Odissey', 'Cyber Odyssey 2099') > 0);
  assert.equal(fuzzyMatchScore('Unrelated Mario Game', 'Cyber Odyssey 2099'), 0);
});

test('filterAndSortProducts and evaluateWatchlistAlerts work end-to-end', () => {
  const product: XboxProduct = {
    bigId: '9P3J32CTXLRZ',
    slug: 'elder-chronicles-eclipse',
    title: 'Elder Chronicles: Golden Eclipse',
    description: 'Dark Fantasy Action RPG',
    developer: 'Monolith Forge',
    publisher: 'Bandai Visual',
    releaseDate: '2025-05-20',
    productType: 'Game',
    platforms: ['Xbox Series X|S'],
    coverImage: '/cover2.jpg',
    screenshots: [],
    featuredDeal: true,
    addedToDealsAt: '2026-11-03T00:00:00Z',
    pricesByRegion: {
      MX: {
        regionCode: 'MX',
        currency: 'MXN',
        listPrice: 1200,
        salePrice: 300,
        gamePassPrice: 240,
        includedInGamePass: true,
        discountPct: 75,
        startDate: '2026-11-01T00:00:00Z',
        endDate: '2026-11-07T00:00:00Z',
      },
    },
    historyByRegion: {
      MX: [{ date: '2026-04-01', regularPrice: 1200, salePrice: 600 }],
    },
  };

  const filters: FilterState = {
    tab: 'historical_lows',
    searchQuery: 'Eldr Chroncles', // With typos!
    productType: 'Game',
    minDiscountPct: 50,
    maxPriceInLocal: 500,
    subscriptionFilter: 'INCLUDED_IN_GAMEPASS',
    platformFilter: 'Xbox Series X|S',
    sortBy: 'discount_desc',
  };

  const results = filterAndSortProducts(
    [product],
    filters,
    'MX',
    'MXN',
    MOCK_RATES,
    '2026-11-05T00:00:00Z'
  );
  assert.equal(results.length, 1);

  const alerts = evaluateWatchlistAlerts(
    [
      {
        bigId: '9P3J32CTXLRZ',
        addedAt: '2026-10-01T00:00:00Z',
        targetPrice: 350,
        targetCurrency: 'MXN',
        notifyOnAnyDrop: true,
        preferredRegion: 'MX',
      },
    ],
    { '9P3J32CTXLRZ': product },
    'MXN',
    MOCK_RATES
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].reason, 'TARGET_REACHED');
  assert.equal(alerts[0].currentPriceConverted, 240);
});

test('parseMsDisplayCatalogPayload extracts official Microsoft Display Catalog v7.0 fields', () => {
  const sampleMsPayload = {
    Products: [
      {
        ProductId: '9NP1P1WFS0LB',
        ProductKind: 'Game',
        Properties: {
          XboxCrossGenCompatible: true,
          IsXboxPlayAnywhere: true,
        },
        LocalizedProperties: [
          {
            ProductTitle: 'Apex Motorsport Endurance GT',
            ShortDescription: 'Simulador oficial de resistencia.',
            DeveloperName: 'Turn 10 Racing Lab',
            PublisherName: 'Xbox Game Studios',
          },
        ],
        DisplaySkuAvailabilities: [
          {
            Availabilities: [
              {
                OrderManagementData: {
                  Price: {
                    ListPrice: 1399.0,
                    WholesalePrice: 699.5,
                    CurrencyCode: 'MXN',
                  },
                },
                Conditions: {
                  EndDate: '2026-11-15T23:59:59Z',
                },
              },
            ],
          },
        ],
      },
    ],
  };

  const parsed = parseMsDisplayCatalogPayload(sampleMsPayload, 'MXN');
  assert.ok(parsed);
  assert.equal(parsed.bigId, '9NP1P1WFS0LB');
  assert.equal(parsed.title, 'Apex Motorsport Endurance GT');
  assert.equal(parsed.discountPct, 50);
  assert.equal(parsed.salePrice, 699.5);
  assert.ok(parsed.platforms.includes('Xbox Play Anywhere'));
});
