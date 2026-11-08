import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkBigIds,
  classifyXboxProductType,
  convertEmeraldSummaryToXboxProduct,
  detectPriceDeltaAndUpdateHistory,
  extractBigIdFromQuery,
  extractMsProductFromNode,
  normalizeMsImageUrl,
} from './msCatalogScraper';
import { RegionalPrice } from '../types/xbox';

test('chunkBigIds splits catalog IDs into batches of 20 and deduplicates', () => {
  const ids = Array.from({ length: 45 }, (_, i) => `9NBLGGH4R6${String(i).padStart(2, '0')}`);
  ids.push('9nblggh4r600'); // duplicate in lowercase
  const batches = chunkBigIds(ids, 20);
  assert.equal(batches.length, 3);
  assert.equal(batches[0].length, 20);
  assert.equal(batches[1].length, 20);
  assert.equal(batches[2].length, 5);
});

test('normalizeMsImageUrl converts protocol-relative Microsoft Store URLs to https', () => {
  assert.equal(
    normalizeMsImageUrl('//store-images.s-microsoft.com/image/apps.123.jpg'),
    'https://store-images.s-microsoft.com/image/apps.123.jpg'
  );
  assert.equal(normalizeMsImageUrl(''), '');
});

test('extractMsProductFromNode parses ListPrice, general SalePrice, GamePass exclusive discount, and GamePass inclusion', () => {
  const mockMsProductNode = {
    ProductId: '9NBLGGH4R6P9',
    ProductKind: 'Game',
    Properties: {
      IsXboxPlayAnywhere: true,
      XboxCrossGenCompatible: true,
    },
    MarketProperties: [
      {
        OriginalReleaseDate: '2025-09-18T00:00:00Z',
      },
    ],
    LocalizedProperties: [
      {
        ProductTitle: 'Cyber Odyssey 2099',
        ShortDescription: 'Sci-Fi RPG en estación orbital.',
        DeveloperName: 'Aether Syndicate',
        PublisherName: 'Xbox Game Studios',
        Images: [
          {
            ImagePurpose: 'BoxArt',
            Uri: '//store-images.s-microsoft.com/image/boxart.jpg',
          },
          {
            ImagePurpose: 'Screenshot',
            Uri: '//store-images.s-microsoft.com/image/screen1.jpg',
          },
        ],
      },
    ],
    DisplaySkuAvailabilities: [
      {
        Sku: {
          Properties: {
            Packages: [
              {
                PlatformDependencies: [
                  { PlatformName: 'Windows.Xbox' },
                  { PlatformName: 'Windows.Desktop' },
                ],
              },
            ],
          },
        },
        Availabilities: [
          // 1. General Store Sale (ListPrice 1399 -> WholesalePrice 699.50)
          {
            Actions: ['Purchase', 'Browse'],
            OrderManagementData: {
              Price: {
                ListPrice: 1399.0,
                WholesalePrice: 699.5,
                CurrencyCode: 'MXN',
              },
            },
            Conditions: {
              StartDate: '2026-11-01T00:00:00Z',
              EndDate: '2026-11-12T23:59:59Z',
            },
          },
          // 2. Game Pass Ultimate Exclusive Discount (WholesalePrice 559.60)
          {
            Actions: ['Purchase', 'Browse'],
            EligibilityProperties: {
              Remediations: [{ BigId: '9WNZS2ZC9L74', Description: 'Join Game Pass Ultimate' }],
            },
            OrderManagementData: {
              Price: {
                ListPrice: 1399.0,
                WholesalePrice: 559.6,
                CurrencyCode: 'MXN',
              },
            },
            Conditions: {
              StartDate: '2026-11-01T00:00:00Z',
              EndDate: '2026-11-12T23:59:59Z',
            },
          },
          // 3. Active Game Pass Catalog Fulfillment
          {
            Actions: ['Fulfill', 'License'],
            EligibilityProperties: {
              Affirmations: [{ AffirmationId: 'CFQ7TTC0K6L8' }],
            },
          },
        ],
      },
    ],
  };

  const extracted = extractMsProductFromNode(mockMsProductNode, 'MX', 'MXN');
  assert.equal(extracted.bigId, '9NBLGGH4R6P9');
  assert.equal(extracted.listPrice, 1399.0);
  assert.equal(extracted.salePrice, 699.5);
  assert.equal(extracted.gamePassPrice, 559.6);
  assert.equal(extracted.includedInGamePass, true);
  assert.equal(extracted.discountPct, 60);
  assert.equal(extracted.isPlayAnywhere, true);
  assert.equal(
    extracted.coverUrl,
    'https://store-images.s-microsoft.com/image/boxart.jpg'
  );
  assert.equal(extracted.screenshots.length, 1);
});

test('extractMsProductFromNode accurately parses real DisplayCatalog v7.0 MSRP vs ListPrice and ignores 0-price trial SKUs', () => {
  const realNoMansSkyNode = {
    ProductId: 'BQVQTL3PCH05',
    ProductKind: 'Game',
    LocalizedProperties: [
      {
        ProductTitle: "No Man's Sky",
        DeveloperName: 'Hello Games',
        PublisherName: 'Hello Games',
      },
    ],
    DisplaySkuAvailabilities: [
      {
        Availabilities: [
          // 0-price entitlement SKU that must be ignored on paid games
          {
            Actions: ['Purchase', 'Browse'],
            OrderManagementData: {
              Price: {
                MSRP: 0,
                ListPrice: 0,
                WholesalePrice: 0,
                CurrencyCode: 'MXN',
              },
            },
          },
          // Real active -60% deal: MSRP=1059, ListPrice=423.6 (WholesalePrice=296.52 is B2B)
          {
            Actions: ['Purchase', 'Browse'],
            OrderManagementData: {
              Price: {
                MSRP: 1059,
                ListPrice: 423.6,
                WholesalePrice: 296.52,
                CurrencyCode: 'MXN',
              },
            },
            Conditions: {
              StartDate: '2026-10-29T00:00:00Z',
              EndDate: '2026-11-11T09:59:59Z',
            },
          },
        ],
      },
    ],
  };

  const quote = extractMsProductFromNode(realNoMansSkyNode, 'MX', 'MXN');
  assert.equal(quote.bigId, 'BQVQTL3PCH05');
  assert.equal(quote.listPrice, 1059);
  assert.equal(quote.salePrice, 423.6);
  assert.equal(quote.discountPct, 60);
});

test('convertEmeraldSummaryToXboxProduct and extractBigIdFromQuery handle official emerald.xboxservices.com payloads', () => {
  assert.equal(extractBigIdFromQuery('9NXVC0482QS5'), '9NXVC0482QS5');
  assert.equal(
    extractBigIdFromQuery('https://www.xbox.com/es-mx/games/store/it-takes-two-version-digital/9NXVC0482QS5'),
    '9NXVC0482QS5'
  );

  const emeraldSummary = {
    productId: '9NXVC0482QS5',
    title: 'It Takes Two - Versión digital',
    shortDescription: 'Embárcate en la aventura más loca de tu vida.',
    developerName: 'Hazelight',
    publisherName: 'Electronic Arts',
    releaseDate: '2021-03-26T00:00:00Z',
    productKind: 'Game',
    availableOn: ['XboxOne', 'XboxSeriesX'],
    includedWithPassesProductIds: ['CFQ7TTC0K5DH', 'CFQ7TTC0K6L8'],
    images: {
      poster: { url: '//store-images.s-microsoft.com/image/ittakestwo.jpg' },
    },
    specificPrices: {
      purchaseable: [
        {
          msrp: 894,
          listPrice: 268.2,
          discountPercentage: 70,
          currency: 'MXN',
          endDateUtc: '11/06/2026 09:59:59',
          hasXPriceOffer: false,
          eligibilityInfo: { eligibility: 'None', type: 'Unknown' },
        },
      ],
    },
  };

  const product = convertEmeraldSummaryToXboxProduct(emeraldSummary, 'MX', 'MXN', {
    USD: 1,
    MXN: 20,
    TRY: 34,
  });
  assert.ok(product);
  assert.equal(product.bigId, '9NXVC0482QS5');
  assert.equal(product.pricesByRegion.MX.listPrice, 894);
  assert.equal(product.pricesByRegion.MX.salePrice, 268.2);
  assert.equal(product.pricesByRegion.MX.discountPct, 70);
  assert.equal(product.pricesByRegion.MX.includedInGamePass, true);
});

test('detectPriceDeltaAndUpdateHistory appends history only when price or Game Pass state changes', () => {
  const prevPrice: RegionalPrice = {
    regionCode: 'MX',
    currency: 'MXN',
    listPrice: 1399,
    salePrice: 699.5,
    gamePassPrice: null,
    includedInGamePass: false,
    discountPct: 50,
    startDate: '2026-10-01T00:00:00Z',
    endDate: '2026-10-15T00:00:00Z',
  };

  const existingHistory = [
    { date: '2026-10-01', regularPrice: 1399, salePrice: 699.5 },
  ];

  // Case 1: Identical price -> no new history point appended
  const unchangedQuote = {
    bigId: '9NBLGGH4R6P9',
    title: 'Cyber Odyssey 2099',
    description: 'RPG',
    developer: 'Aether',
    publisher: 'Xbox',
    releaseDate: '2025-09-18',
    productType: 'Game' as const,
    platforms: ['Xbox Series X|S' as const],
    isPlayAnywhere: true,
    coverUrl: '',
    screenshots: [],
    market: 'MX',
    currency: 'MXN',
    listPrice: 1399,
    salePrice: 699.5,
    gamePassPrice: null,
    includedInGamePass: false,
    discountPct: 50,
    startDate: '2026-11-01T00:00:00Z',
    endDate: '2026-11-12T00:00:00Z',
  };

  const deltaNoChange = detectPriceDeltaAndUpdateHistory(
    prevPrice,
    unchangedQuote,
    existingHistory,
    '2026-11-05'
  );
  assert.equal(deltaNoChange.hasChanged, false);
  assert.equal(deltaNoChange.changeType, 'NO_CHANGE');
  assert.equal(deltaNoChange.updatedHistory.length, 1);

  // Case 2: New price drop (699.5 -> 489.65, -65%) -> appends history and marks Historical Low
  const droppedQuote = {
    ...unchangedQuote,
    salePrice: 489.65,
    discountPct: 65,
  };

  const deltaDrop = detectPriceDeltaAndUpdateHistory(
    prevPrice,
    droppedQuote,
    existingHistory,
    '2026-11-05'
  );
  assert.equal(deltaDrop.hasChanged, true);
  assert.equal(deltaDrop.changeType, 'PRICE_DROP');
  assert.equal(deltaDrop.updatedHistory.length, 2);
  assert.equal(deltaDrop.analytics.lowestPriceEver, 489.65);
  assert.equal(deltaDrop.analytics.verdict, 'Mínimo histórico');
});

test('classifyXboxProductType distinguishes Standard Edition games, Deluxe/Ultimate bundles, and DLC packs/currencies', () => {
  assert.equal(
    classifyXboxProductType('Game', 'Forza Horizon 5: Edición Estándar'),
    'Game'
  );
  assert.equal(
    classifyXboxProductType('Game', 'Battlefield™ V Standard Edition'),
    'Game'
  );
  assert.equal(
    classifyXboxProductType('Game', 'Cyberpunk 2077: Edición definitiva'),
    'Bundle'
  );
  assert.equal(
    classifyXboxProductType('Durable', 'Paquete del calor de Ghostrunner 2'),
    'Add-on'
  );
  assert.equal(
    classifyXboxProductType('Game', '1,000 créditos Halo'),
    'Add-on'
  );
  assert.equal(
    classifyXboxProductType('Game', 'Grand Theft Auto VI: Ultimate Edition Upgrade'),
    'Add-on'
  );
  assert.equal(
    classifyXboxProductType('Game', 'Halo: Reach - Paquete de mapas Desafiant'),
    'Add-on'
  );
});

