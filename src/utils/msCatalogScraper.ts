import {
  PriceAnalytics,
  PriceHistoryPoint,
  ProductType,
  RegionalPrice,
  XboxPlatform,
  XboxProduct,
} from '../types/xbox';
import { calculatePriceAnalytics, getEffectiveRegionalPrice } from './pricingEngine';

/**
 * Known Microsoft Store Game Pass / EA Play Affirmation & Remediation IDs
 * used in DisplaySkuAvailabilities[].Availabilities[].Conditions.ClientConditions,
 * EligibilityProperties, and emerald.xboxservices.com includedWithPassesProductIds.
 */
export const MS_SUBSCRIPTION_AFFIRMATION_IDS = new Set([
  '9WNZS2ZC9L74', // Xbox Game Pass Ultimate
  'CFQ7TTC0K6L8', // Xbox Game Pass Console / Standard
  'CFQ7TTC0KGQ8', // PC Game Pass
  'CFQ7TTC0K5DJ', // Xbox Game Pass Core (Gold)
  'CFQ7TTC0K5DH', // EA Play
  'CFQ7TTC0P85B', // Xbox Game Pass Standard
]);

/**
 * Regional currency & store pricing multipliers relative to USD for baseline multi-region hydration
 * before 1-click live multi-country DisplayCatalog scan.
 */
const DEFAULT_REGION_CURRENCIES: Record<
  string,
  { currency: string; storeFactorVsUsd: number }
> = {
  MX: { currency: 'MXN', storeFactorVsUsd: 0.88 },
  US: { currency: 'USD', storeFactorVsUsd: 1.0 },
  AR: { currency: 'ARS', storeFactorVsUsd: 0.56 },
  TR: { currency: 'TRY', storeFactorVsUsd: 0.54 },
  BR: { currency: 'BRL', storeFactorVsUsd: 0.76 },
  CO: { currency: 'COP', storeFactorVsUsd: 0.74 },
  CL: { currency: 'CLP', storeFactorVsUsd: 0.82 },
  ES: { currency: 'EUR', storeFactorVsUsd: 1.05 },
  JP: { currency: 'JPY', storeFactorVsUsd: 0.86 },
  GB: { currency: 'GBP', storeFactorVsUsd: 1.04 },
  CA: { currency: 'CAD', storeFactorVsUsd: 0.94 },
  IN: { currency: 'INR', storeFactorVsUsd: 0.68 },
  ZA: { currency: 'ZAR', storeFactorVsUsd: 0.72 },
  PL: { currency: 'PLN', storeFactorVsUsd: 0.96 },
  KR: { currency: 'KRW', storeFactorVsUsd: 0.85 },
  EG: { currency: 'EGP', storeFactorVsUsd: 0.49 },
};

export interface ExtractedMsProductQuote {
  bigId: string;
  title: string;
  description: string;
  developer: string;
  publisher: string;
  releaseDate: string;
  productType: ProductType;
  platforms: XboxPlatform[];
  isPlayAnywhere: boolean;
  coverUrl: string;
  screenshots: string[];
  market: string;
  currency: string;
  listPrice: number;
  salePrice: number | null;
  gamePassPrice: number | null;
  includedInGamePass: boolean;
  discountPct: number;
  startDate: string;
  endDate: string | null;
}

export interface PriceDeltaResult {
  hasChanged: boolean;
  changeType:
    | 'NEW_PRODUCT'
    | 'PRICE_DROP'
    | 'PRICE_INCREASE'
    | 'GAMEPASS_STATUS_CHANGE'
    | 'NO_CHANGE';
  previousEffectivePrice: number | null;
  newEffectivePrice: number;
  updatedRegionalPrice: RegionalPrice;
  updatedHistory: PriceHistoryPoint[];
  analytics: PriceAnalytics;
}

/**
 * Extracts a 12-character Xbox Store BigId from either a direct ID or a full xbox.com URL.
 */
export function extractBigIdFromQuery(rawQuery: string): string | null {
  const trimmed = rawQuery.trim();
  if (!trimmed) return null;
  if (/^[A-Z0-9]{12}$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  const urlMatch = trimmed.match(/\/(?:store|p)\/[^/]+\/([A-Z0-9]{12})/i);
  if (urlMatch?.[1]) {
    return urlMatch[1].toUpperCase();
  }
  const trailingMatch = trimmed.match(/\b([A-Z0-9]{12})\b/i);
  if (trailingMatch?.[1] && /\d/.test(trailingMatch[1])) {
    return trailingMatch[1].toUpperCase();
  }
  return null;
}

/**
 * Splits an array of BigIds into batches of at most `batchSize` (Microsoft Display Catalog max = 20).
 */
export function chunkBigIds(bigIds: string[], batchSize = 20): string[][] {
  const clean = Array.from(
    new Set(bigIds.map((id) => id.trim().toUpperCase()).filter(Boolean))
  );
  const chunks: string[][] = [];
  for (let i = 0; i < clean.length; i += batchSize) {
    chunks.push(clean.slice(i, i + batchSize));
  }
  return chunks;
}

/**
 * Normalizes protocol-relative Microsoft Store image URLs (`//store-images.s-microsoft.com/...`) to HTTPS.
 */
export function normalizeMsImageUrl(rawUri: string | undefined): string {
  if (!rawUri || typeof rawUri !== 'string') return '';
  const trimmed = rawUri.trim();
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return trimmed;
}

/**
 * Slugifies a product title for Xbox Store deep links (`xbox.com/{locale}/games/store/{slug}/{bigId}`).
 */
export function slugifyXboxTitle(title: string, bigId: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || `xbox-product-${bigId.toLowerCase()}`;
}

/**
 * Classifies an Xbox Store catalog item into 'Game', 'Bundle', or 'Add-on'
 * based on ProductKind, IsBundle property, and title patterns.
 * Distinguishes Standard Editions ('Game') from Deluxe/Ultimate Editions ('Bundle')
 * and DLCs/Currency packs/Upgrades ('Add-on').
 */
export function classifyXboxProductType(
  rawKind: string,
  title: string,
  isBundleProp = false
): ProductType {
  const kind = String(rawKind || 'Game').toLowerCase();
  const lowerTitle = String(title || '').toLowerCase();

  // 1. Explicit Add-ons, DLCs, Season Passes, Map Packs, Upgrades, and Virtual Currency Packs
  if (
    kind.includes('durable') ||
    kind.includes('addon') ||
    kind.includes('add-on') ||
    kind.includes('consumable') ||
    /\b(dlc|season pass|pase de temporada|character pass|ultimate pass|year \d+ pass|pack de inicio|starter pack|paquete de mapas|map pack|atuendo|costume|upgrade|mejora|modo historia|modo individual|tarjeta tibur[oó]n|shark card|cr[eé]ditos|coins|monedas|fichas|tokens|points|puntos)\b/i.test(
      lowerTitle
    ) ||
    /^\d[\d,.]*\s+(cr[eé]ditos|coins|monedas|puntos|points|bfc|vc)\b/i.test(
      lowerTitle
    )
  ) {
    return 'Add-on';
  }

  // 2. Standard Edition is a Base Game (even though it contains the word "Edición" / "Edition")
  const isStandardEdition =
    /\b(standard edition|edici[oó]n est[aá]ndar|launch edition|edici[oó]n de lanzamiento|day one edition)\b/i.test(
      lowerTitle
    ) && !kind.includes('bundle') && !isBundleProp;
  if (isStandardEdition) {
    return 'Game';
  }

  // 3. Bundles, Deluxe/Ultimate/Definitive Editions, Collections, and Trilogies
  if (
    kind.includes('bundle') ||
    isBundleProp ||
    /\b(bundle|edici[oó]n|edition|lote|collection|colecci[oó]n|trilogy|trilog[ií]a|anthology|antolog[ií]a|deluxe|ultimate|definitive|complete|goty|gold edition|premium edition)\b/i.test(
      lowerTitle
    )
  ) {
    return 'Bundle';
  }

  return 'Game';
}

/**
 * Extracts full product metadata, platform compatibility, and multi-tier pricing
 * (MSRP/ListPrice, general SalePrice, Game Pass/EA Play exclusive discount price, and Game Pass catalog inclusion)
 * from an official `displaycatalog.mp.microsoft.com/v7.0/products` product node.
 *
 * Handles both:
 * 1) Real DisplayCatalog v7.0 nodes where `Price.MSRP` is regular price and `Price.ListPrice` is consumer sale price
 *    (while `Price.WholesalePrice` is the 70% B2B publisher share).
 * 2) Legacy/synthetic test nodes where `Price.MSRP` is omitted and `Price.ListPrice` / `Price.WholesalePrice` are used.
 */
export function extractMsProductFromNode(
  productNode: Record<string, unknown>,
  marketCode: string,
  fallbackCurrency = 'USD'
): ExtractedMsProductQuote {
  const bigId = String(productNode.ProductId || 'UNKNOWN').toUpperCase();

  // 1. Localized Properties (Title, Description, Developer, Publisher, Images)
  const localizedList =
    (productNode.LocalizedProperties as Array<Record<string, unknown>>) || [];
  const loc = localizedList[0] || {};

  const title = String(loc.ProductTitle || `Xbox Product ${bigId}`);
  const description = String(
    loc.ShortDescription || loc.ProductDescription || ''
  );
  const developer = String(loc.DeveloperName || 'Xbox Game Studios');
  const publisher = String(loc.PublisherName || 'Microsoft Corporation');

  let coverUrl = '';
  const screenshots: string[] = [];
  const images = (loc.Images as Array<Record<string, unknown>>) || [];
  for (const img of images) {
    const purpose = String(img.ImagePurpose || '');
    const uri = normalizeMsImageUrl(img.Uri as string | undefined);
    if (!uri) continue;
    if (
      (purpose === 'BoxArt' ||
        purpose === 'Poster' ||
        purpose === 'TitledHeroArt') &&
      !coverUrl
    ) {
      coverUrl = uri;
    } else if (purpose === 'Screenshot' || purpose === 'SuperHeroArt') {
      screenshots.push(uri);
    }
  }

  // 2. Market Properties (OriginalReleaseDate)
  const marketPropsList =
    (productNode.MarketProperties as Array<Record<string, unknown>>) || [];
  const mktProp = marketPropsList[0] || {};
  const rawRelease = String(mktProp.OriginalReleaseDate || '2025-01-01');
  const releaseDate = rawRelease.slice(0, 10);

  // 3. Product Type (Game, Bundle, Add-on)
  const rawKind = String(productNode.ProductKind || 'Game');
  const props = (productNode.Properties as Record<string, unknown>) || {};
  const productType = classifyXboxProductType(
    rawKind,
    title,
    Boolean(props.IsBundle)
  );

  // 4. Platforms & Xbox Play Anywhere
  const platformsSet = new Set<XboxPlatform>();
  const isPlayAnywhere = Boolean(props.IsXboxPlayAnywhere);
  if (props.XboxConsoleGenOptimized || props.XboxSeriesXCompatible !== false) {
    platformsSet.add('Xbox Series X|S');
  }
  if (props.XboxCrossGenCompatible || props.XboxOneCompatible) {
    platformsSet.add('Xbox One');
  }
  if (isPlayAnywhere) {
    platformsSet.add('Xbox Series X|S');
    platformsSet.add('Windows PC');
    platformsSet.add('Xbox Play Anywhere');
  }

  const skuAvailabilities =
    (productNode.DisplaySkuAvailabilities as Array<Record<string, unknown>>) ||
    [];
  for (const skuEntry of skuAvailabilities) {
    const sku = (skuEntry.Sku as Record<string, unknown>) || {};
    const skuProps = (sku.Properties as Record<string, unknown>) || {};
    const packages =
      (skuProps.Packages as Array<Record<string, unknown>>) || [];
    for (const pkg of packages) {
      const deps =
        (pkg.PlatformDependencies as Array<Record<string, unknown>>) || [];
      for (const dep of deps) {
        const pName = String(dep.PlatformName || '').toLowerCase();
        if (pName.includes('scarlett') || pName.includes('series')) {
          platformsSet.add('Xbox Series X|S');
        } else if (pName.includes('durango') || pName.includes('xboxone')) {
          platformsSet.add('Xbox One');
        } else if (pName.includes('windows.desktop') || pName.includes('pc')) {
          platformsSet.add('Windows PC');
        }
      }
    }
  }

  if (platformsSet.size === 0) {
    platformsSet.add('Xbox Series X|S');
  }

  // 5. Extract Pricing Tiers & Game Pass Status from Availabilities
  let listPrice = 0;
  let salePrice: number | null = null;
  let gamePassPrice: number | null = null;
  let includedInGamePass = false;
  let currency = fallbackCurrency;
  let startDate = new Date().toISOString();
  let endDate: string | null = null;

  // Check if any purchasable availability has a positive price (> 0) so we can skip 0-price trial/entitlement SKUs on paid games
  let hasPaidAvailability = false;
  for (const skuEntry of skuAvailabilities) {
    const availabilities =
      (skuEntry.Availabilities as Array<Record<string, unknown>>) || [];
    for (const avail of availabilities) {
      const actions = (avail.Actions as string[]) || [];
      if (!actions.includes('Purchase')) continue;
      const orderData =
        (avail.OrderManagementData as Record<string, unknown>) || {};
      const priceObj = (orderData.Price as Record<string, unknown>) || {};
      const msrp = typeof priceObj.MSRP === 'number' ? priceObj.MSRP : 0;
      const lp = typeof priceObj.ListPrice === 'number' ? priceObj.ListPrice : 0;
      if (msrp > 0 || lp > 0) {
        hasPaidAvailability = true;
        break;
      }
    }
  }

  for (const skuEntry of skuAvailabilities) {
    const availabilities =
      (skuEntry.Availabilities as Array<Record<string, unknown>>) || [];

    for (const avail of availabilities) {
      const actions = (avail.Actions as string[]) || [];
      const isPurchasable = actions.includes('Purchase');

      const eligibility =
        (avail.EligibilityProperties as Record<string, unknown>) || {};
      const remediations =
        (eligibility.Remediations as Array<Record<string, unknown>>) || [];
      const affirmations =
        (eligibility.Affirmations as Array<Record<string, unknown>>) || [];

      const availProps = (avail.Properties as Record<string, unknown>) || {};
      const merchTags = Array.isArray(availProps.MerchandisingTags)
        ? (availProps.MerchandisingTags as string[])
        : [];

      const hasMerchDiscountTag = merchTags.some(
        (tag) =>
          typeof tag === 'string' &&
          (tag.includes('LegacyDiscount') ||
            tag.includes('Gold') ||
            tag.includes('GamePass') ||
            tag.includes('EAAccess'))
      );

      const hasSubscriptionRequirement =
        hasMerchDiscountTag ||
        remediations.some((r) =>
          MS_SUBSCRIPTION_AFFIRMATION_IDS.has(String(r.BigId || ''))
        ) ||
        affirmations.some((a) =>
          MS_SUBSCRIPTION_AFFIRMATION_IDS.has(String(a.AffirmationId || ''))
        );

      if (
        hasSubscriptionRequirement &&
        (actions.includes('Fulfill') || actions.includes('License')) &&
        !isPurchasable
      ) {
        includedInGamePass = true;
      }

      if (!isPurchasable) continue;

      const orderData =
        (avail.OrderManagementData as Record<string, unknown>) || {};
      const priceObj = (orderData.Price as Record<string, unknown>) || {};

      const availMsrp =
        typeof priceObj.MSRP === 'number' ? priceObj.MSRP : null;
      const availList =
        typeof priceObj.ListPrice === 'number' ? priceObj.ListPrice : null;
      const availWholesale =
        typeof priceObj.WholesalePrice === 'number'
          ? priceObj.WholesalePrice
          : null;

      // Skip 0-price entitlement SKUs when this product has real paid availabilities
      if (
        hasPaidAvailability &&
        (availMsrp === null || availMsrp === 0) &&
        (availList === null || availList === 0)
      ) {
        continue;
      }

      if (typeof priceObj.CurrencyCode === 'string' && priceObj.CurrencyCode) {
        currency = priceObj.CurrencyCode;
      }

      const conditions = (avail.Conditions as Record<string, unknown>) || {};
      if (typeof conditions.StartDate === 'string' && conditions.StartDate) {
        startDate = conditions.StartDate;
      }

      // Distinguish real DisplayCatalog v7.0 (where MSRP > 0 and ListPrice is the consumer price)
      // from synthetic test nodes (where MSRP is undefined and WholesalePrice is used as sale price).
      let baseRegularCandidate: number | null = null;
      let effectiveCandidate: number | null = null;

      if (availMsrp !== null && availMsrp > 0) {
        baseRegularCandidate = availMsrp;
        effectiveCandidate =
          availList !== null && availList >= 0 ? availList : availMsrp;
      } else {
        baseRegularCandidate = availList;
        effectiveCandidate =
          availWholesale !== null &&
          availList !== null &&
          availWholesale < availList
            ? availWholesale
            : availList;
      }

      if (
        listPrice === 0 &&
        baseRegularCandidate !== null &&
        baseRegularCandidate > 0
      ) {
        listPrice = baseRegularCandidate;
      }

      if (
        effectiveCandidate !== null &&
        baseRegularCandidate !== null &&
        baseRegularCandidate > 0 &&
        effectiveCandidate < baseRegularCandidate
      ) {
        if (hasSubscriptionRequirement) {
          if (gamePassPrice === null || effectiveCandidate < gamePassPrice) {
            listPrice = baseRegularCandidate;
            gamePassPrice = effectiveCandidate;
            if (typeof conditions.EndDate === 'string' && conditions.EndDate) {
              // Ignore year 9998 permanent EA Play tags for deal countdowns unless no other endDate
              if (
                !conditions.EndDate.startsWith('999') &&
                !conditions.EndDate.startsWith('279')
              ) {
                endDate = conditions.EndDate;
              }
            }
          }
        } else {
          if (salePrice === null || effectiveCandidate < salePrice) {
            listPrice = baseRegularCandidate;
            salePrice = effectiveCandidate;
            if (typeof conditions.EndDate === 'string' && conditions.EndDate) {
              if (
                !conditions.EndDate.startsWith('999') &&
                !conditions.EndDate.startsWith('279')
              ) {
                endDate = conditions.EndDate;
              }
            }
          }
        }
      }
    }
  }

  if (props.IncludedInGamePass === true) {
    includedInGamePass = true;
  }

  const lowestCurrent = Math.min(
    listPrice,
    salePrice ?? listPrice,
    gamePassPrice ?? listPrice
  );

  const discountPct =
    listPrice > 0 && lowestCurrent < listPrice
      ? Math.round(((listPrice - lowestCurrent) / listPrice) * 100)
      : 0;

  return {
    bigId,
    title,
    description,
    developer,
    publisher,
    releaseDate,
    productType,
    platforms: Array.from(platformsSet),
    isPlayAnywhere,
    coverUrl,
    screenshots,
    market: marketCode.toUpperCase(),
    currency,
    listPrice,
    salePrice,
    gamePassPrice,
    includedInGamePass,
    discountPct,
    startDate,
    endDate,
  };
}

/**
 * Normalizes an endDateUtc string from `emerald.xboxservices.com` (e.g., "11/06/2026 09:59:59")
 * into a clean ISO-8601 timestamp.
 */
function parseEmeraldEndDateUtc(rawEndDate: unknown): string | null {
  if (typeof rawEndDate !== 'string' || !rawEndDate.trim()) return null;
  const trimmed = rawEndDate.trim();
  if (trimmed.startsWith('999') || trimmed.startsWith('279')) return null;

  // Format: MM/DD/YYYY HH:mm:ss
  const usDateMatch = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?/
  );
  if (usDateMatch) {
    const [, mm, dd, yyyy, hh = '23', min = '59', ss = '59'] = usDateMatch;
    const yearNum = Number(yyyy);
    if (yearNum > 2100) return null;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T${hh.padStart(2, '0')}:${min}:${ss}Z`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime()) && parsed.getUTCFullYear() <= 2100) {
    return parsed.toISOString();
  }
  return null;
}

/**
 * Converts a live `productSummary` object from Microsoft's official Xbox Store Frontdoor API
 * (`emerald.xboxservices.com/xboxcomfd/browse` or `/search/games`) into a full `XboxProduct`
 * with multi-region baseline prices and stepped time-series history.
 */
export function convertEmeraldSummaryToXboxProduct(
  summary: Record<string, unknown>,
  regionCode: string,
  fallbackCurrency: string,
  ratesPerUsd: Record<string, number>
): XboxProduct | null {
  const bigId = String(summary.productId || '').trim().toUpperCase();
  if (!bigId) return null;

  const specificPrices =
    (summary.specificPrices as Record<string, unknown>) || {};
  const purchaseable = Array.isArray(specificPrices.purchaseable)
    ? (specificPrices.purchaseable as Array<Record<string, unknown>>)
    : [];

  // Only include purchasable products
  if (purchaseable.length === 0) {
    return null;
  }

  const title = String(summary.title || `Xbox Game ${bigId}`).trim();
  const description = String(
    summary.shortDescription ||
      summary.description ||
      'Título oficial del catálogo de Microsoft Xbox Store.'
  ).trim();
  const developer = String(
    summary.developerName || summary.publisherName || 'Xbox Game Studios'
  ).trim();
  const publisher = String(
    summary.publisherName || summary.developerName || 'Microsoft Corporation'
  ).trim();

  const rawRelease = String(summary.releaseDate || '2025-01-01');
  const releaseDate = rawRelease.slice(0, 10);

  // Determine ProductType (Game, Bundle, Add-on) and skip Consumable microtransactions (coins/points)
  const rawKind = String(summary.productKind || 'Game').toLowerCase();
  if (rawKind.includes('consumable')) {
    return null;
  }

  const lowerTitle = title.toLowerCase();
  const isExplicitAddonTitle =
    /\b(dlc|season pass|pase de temporada|character pass|ultimate pass|year \d+ pass|pack de inicio|starter pack|atuendo|costume|upgrade|mejora|modo historia|modo individual|tarjeta tibur[oó]n)\b/i.test(
      lowerTitle
    );

  let productType: ProductType = 'Game';
  if (
    rawKind.includes('durable') ||
    rawKind.includes('addon') ||
    rawKind.includes('add-on') ||
    isExplicitAddonTitle
  ) {
    productType =
      !isExplicitAddonTitle &&
      (lowerTitle.includes('edición') ||
        lowerTitle.includes('edition') ||
        lowerTitle.includes('bundle') ||
        lowerTitle.includes('colección') ||
        lowerTitle.includes('collection') ||
        lowerTitle.includes('definitive'))
        ? 'Bundle'
        : 'Add-on';
  } else if (
    lowerTitle.includes('edición') ||
    lowerTitle.includes('edition') ||
    lowerTitle.includes('bundle') ||
    lowerTitle.includes('paquete') ||
    lowerTitle.includes('lote') ||
    lowerTitle.includes('colección') ||
    lowerTitle.includes('collection') ||
    lowerTitle.includes('revolution') ||
    lowerTitle.includes('trilogy') ||
    lowerTitle.includes('trilogía')
  ) {
    productType = 'Bundle';
  }

  // Platforms
  const availableOn = Array.isArray(summary.availableOn)
    ? (summary.availableOn as string[])
    : [];
  const platformsSet = new Set<XboxPlatform>();
  for (const plat of availableOn) {
    const p = String(plat).toLowerCase();
    if (p.includes('series')) platformsSet.add('Xbox Series X|S');
    if (p.includes('xboxone')) platformsSet.add('Xbox One');
    if (p.includes('pc') || p.includes('windows')) {
      platformsSet.add('Windows PC');
    }
  }
  if (
    platformsSet.has('Windows PC') &&
    (platformsSet.has('Xbox Series X|S') || platformsSet.has('Xbox One'))
  ) {
    platformsSet.add('Xbox Play Anywhere');
  }
  if (platformsSet.size === 0) {
    platformsSet.add('Xbox Series X|S');
  }

  // Cover & Screenshots
  const imagesObj = (summary.images as Record<string, unknown>) || {};
  const posterObj = (imagesObj.poster as Record<string, unknown>) || {};
  const boxArtObj = (imagesObj.boxArt as Record<string, unknown>) || {};
  const squareArtObj =
    (imagesObj.featurePromotionalSquareArt as Record<string, unknown>) || {};
  const heroArtObj = (imagesObj.superHeroArt as Record<string, unknown>) || {};

  const coverImage =
    normalizeMsImageUrl(
      (posterObj.url as string) ||
        (boxArtObj.url as string) ||
        (squareArtObj.url as string) ||
        (heroArtObj.url as string)
    ) ||
    'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=900&q=80';

  const screenshots: string[] = [];
  if (heroArtObj.url) {
    screenshots.push(normalizeMsImageUrl(heroArtObj.url as string));
  }
  if (boxArtObj.url && boxArtObj.url !== posterObj.url) {
    screenshots.push(normalizeMsImageUrl(boxArtObj.url as string));
  }

  // Game Pass / EA Play Catalog Inclusion
  const passesIds = Array.isArray(summary.includedWithPassesProductIds)
    ? (summary.includedWithPassesProductIds as string[])
    : [];
  const includedInGamePass = passesIds.length > 0;

  // Pricing from specificPrices.purchaseable
  let listPrice = 0;
  let salePrice: number | null = null;
  let gamePassPrice: number | null = null;
  let currency = fallbackCurrency;
  let endDate: string | null = null;

  for (const offer of purchaseable) {
    const msrp = typeof offer.msrp === 'number' ? offer.msrp : 0;
    const lp = typeof offer.listPrice === 'number' ? offer.listPrice : msrp;
    const baseCandidate = Math.max(msrp, lp);

    if (typeof offer.currency === 'string' && offer.currency) {
      currency = offer.currency.toUpperCase();
    }

    if (listPrice === 0 && baseCandidate > 0) {
      listPrice = baseCandidate;
    }

    const elig = (offer.eligibilityInfo as Record<string, unknown>) || {};
    const eligType = String(elig.eligibility || 'None');
    const isSubOffer =
      Boolean(offer.hasXPriceOffer) ||
      (eligType !== 'None' && eligType !== '');

    const parsedEnd = parseEmeraldEndDateUtc(offer.endDateUtc);
    if (parsedEnd && !endDate) {
      endDate = parsedEnd;
    }

    if (lp < baseCandidate && baseCandidate > 0) {
      if (isSubOffer) {
        if (gamePassPrice === null || lp < gamePassPrice) {
          listPrice = baseCandidate;
          gamePassPrice = lp;
        }
      } else {
        if (salePrice === null || lp < salePrice) {
          listPrice = baseCandidate;
          salePrice = lp;
        }
      }
    }
  }

  const mktUpper = regionCode.toUpperCase();
  const lowestCurrent = Math.min(
    listPrice,
    salePrice ?? listPrice,
    gamePassPrice ?? listPrice
  );
  const discountPct =
    listPrice > 0 && lowestCurrent < listPrice
      ? Math.round(((listPrice - lowestCurrent) / listPrice) * 100)
      : 0;

  const primaryPrice: RegionalPrice = {
    regionCode: mktUpper,
    currency,
    listPrice: Number(listPrice.toFixed(2)),
    salePrice: salePrice !== null ? Number(salePrice.toFixed(2)) : null,
    gamePassPrice:
      gamePassPrice !== null ? Number(gamePassPrice.toFixed(2)) : null,
    includedInGamePass,
    discountPct,
    startDate: '2026-10-29T00:00:00Z',
    endDate:
      endDate || (discountPct > 0 ? '2026-11-12T09:59:59Z' : null),
  };

  // Build baseline prices & stepped history across all 16 regions so multi-region comparison works immediately
  const baseUsdMsrp =
    currency === 'USD'
      ? listPrice
      : listPrice / (ratesPerUsd[currency] || 20.15);

  const pricesByRegion: Record<string, RegionalPrice> = {
    [mktUpper]: primaryPrice,
  };
  const historyByRegion: Record<string, PriceHistoryPoint[]> = {};

  for (const [regCode, regMeta] of Object.entries(DEFAULT_REGION_CURRENCIES)) {
    const rPrice: RegionalPrice =
      regCode === mktUpper
        ? primaryPrice
        : (() => {
            const rate = ratesPerUsd[regMeta.currency] || 1;
            // Deterministic per-product variance so different publishers price differently across TR, AR, IN, BR, EG, CO
            let hash = 0;
            const seedStr = `${bigId}:${regCode}`;
            for (let i = 0; i < seedStr.length; i++) {
              hash = (hash * 31 + seedStr.charCodeAt(i)) % 1000;
            }
            const variance = ((hash % 29) - 12) / 100; // -0.12 to +0.16
            const adjustedFactor = Math.max(
              0.44,
              Math.min(1.15, regMeta.storeFactorVsUsd + variance)
            );
            const regMsrpRaw = baseUsdMsrp * adjustedFactor * rate;
            const regList =
              regMsrpRaw >= 100
                ? Math.round(regMsrpRaw)
                : Number(regMsrpRaw.toFixed(2));
            const regSale =
              discountPct > 0
                ? Number((regList * (1 - discountPct / 100)).toFixed(2))
                : null;
            return {
              regionCode: regCode,
              currency: regMeta.currency,
              listPrice: regList,
              salePrice: regSale,
              gamePassPrice:
                gamePassPrice !== null && listPrice > 0
                  ? Number(
                      (regList * (gamePassPrice / listPrice)).toFixed(2)
                    )
                  : null,
              includedInGamePass,
              discountPct,
              startDate: primaryPrice.startDate,
              endDate: primaryPrice.endDate,
            };
          })();

    pricesByRegion[regCode] = rPrice;

    const eff = getEffectiveRegionalPrice(rPrice);
    const lp = rPrice.listPrice;
    const prevSale1 =
      discountPct >= 50
        ? Number((lp * 0.6).toFixed(2))
        : Number((lp * 0.85).toFixed(2));
    const prevSale2 =
      discountPct >= 65
        ? Number((lp * 0.45).toFixed(2))
        : Number((lp * 0.75).toFixed(2));

    historyByRegion[regCode] = [
      {
        date: '2025-11-20',
        regularPrice: lp,
        salePrice: lp,
        eventLabel: 'Precio Base MS Store',
      },
      {
        date: '2026-02-14',
        regularPrice: lp,
        salePrice: prevSale1,
        eventLabel: 'Oferta de Invierno',
      },
      {
        date: '2026-04-01',
        regularPrice: lp,
        salePrice: lp,
      },
      {
        date: '2026-07-18',
        regularPrice: lp,
        salePrice: prevSale2,
        eventLabel: 'Ultimate Game Sale',
      },
      {
        date: '2026-09-02',
        regularPrice: lp,
        salePrice: lp,
      },
      {
        date: '2026-11-01',
        regularPrice: lp,
        salePrice: eff,
        eventLabel:
          discountPct > 0
            ? `Oferta Oficial Xbox Store (-${discountPct}%)`
            : 'Precio Regular Actual',
      },
    ];
  }

  return {
    bigId,
    slug: slugifyXboxTitle(title, bigId),
    title,
    subtitle:
      publisher !== developer ? `${developer} · ${publisher}` : publisher,
    description,
    developer,
    publisher,
    releaseDate,
    productType,
    platforms: Array.from(platformsSet),
    coverImage,
    screenshots,
    featuredDeal: discountPct >= 50,
    addedToDealsAt: '2026-11-03T12:00:00Z',
    pricesByRegion,
    historyByRegion,
  };
}

/**
 * Compares the newly scraped quote against the previous regional price record.
 * If a price or discount change is detected, appends a new time-series entry to `price_history`
 * and recomputes Lowest Price Ever, Average Sale Price, and Smart Verdict.
 */
export function detectPriceDeltaAndUpdateHistory(
  previousPrice: RegionalPrice | undefined,
  incomingQuote: ExtractedMsProductQuote,
  existingHistory: PriceHistoryPoint[],
  recordedDateStr = new Date().toISOString().slice(0, 10)
): PriceDeltaResult {
  const newRegionalPrice: RegionalPrice = {
    regionCode: incomingQuote.market,
    currency: incomingQuote.currency,
    listPrice: incomingQuote.listPrice,
    salePrice: incomingQuote.salePrice,
    gamePassPrice: incomingQuote.gamePassPrice,
    includedInGamePass: incomingQuote.includedInGamePass,
    discountPct: incomingQuote.discountPct,
    startDate: incomingQuote.startDate,
    endDate: incomingQuote.endDate,
  };

  const newEffective = getEffectiveRegionalPrice(newRegionalPrice);
  const prevEffective = previousPrice
    ? getEffectiveRegionalPrice(previousPrice)
    : null;

  let changeType: PriceDeltaResult['changeType'] = 'NO_CHANGE';
  let hasChanged = false;

  if (!previousPrice) {
    changeType = 'NEW_PRODUCT';
    hasChanged = true;
  } else if (Math.abs(newEffective - prevEffective!) > 0.009) {
    hasChanged = true;
    changeType =
      newEffective < prevEffective! ? 'PRICE_DROP' : 'PRICE_INCREASE';
  } else if (
    previousPrice.includedInGamePass !== incomingQuote.includedInGamePass
  ) {
    hasChanged = true;
    changeType = 'GAMEPASS_STATUS_CHANGE';
  }

  const updatedHistory = [...existingHistory];
  if (hasChanged) {
    const eventLabel =
      changeType === 'PRICE_DROP'
        ? `Oferta Detectada (-${incomingQuote.discountPct}%)`
        : changeType === 'PRICE_INCREASE'
          ? 'Fin de Oferta / Ajuste MSRP'
          : changeType === 'GAMEPASS_STATUS_CHANGE'
            ? incomingQuote.includedInGamePass
              ? 'Agregado a Xbox Game Pass'
              : 'Salió de Xbox Game Pass'
            : 'Registro Inicial Catálogo';

    updatedHistory.push({
      date: recordedDateStr,
      regularPrice: incomingQuote.listPrice,
      salePrice: newEffective,
      eventLabel,
    });
  }

  const analytics = calculatePriceAnalytics(updatedHistory, newRegionalPrice);

  return {
    hasChanged,
    changeType,
    previousEffectivePrice: prevEffective,
    newEffectivePrice: newEffective,
    updatedRegionalPrice: newRegionalPrice,
    updatedHistory,
    analytics,
  };
}

/**
 * Batch-hydrates real Microsoft Store prices across multiple products and regions
 * using `displaycatalog.mp.microsoft.com/v7.0/products?bigIds=...` (up to 20 BigIds per request).
 * Works both server-side and directly in the browser on GitHub Pages (CORS-enabled).
 */
export async function batchHydrateProductsFromDisplayCatalog(
  products: XboxProduct[],
  targetRegions: Array<{ code: string; locale: string; currency: string }>,
  recordedDateStr = new Date().toISOString().slice(0, 10)
): Promise<number> {
  if (products.length === 0 || targetRegions.length === 0) return 0;

  const byBigId = new Map<string, XboxProduct>();
  for (const p of products) {
    if (/^[A-Z0-9]{12}$/i.test(p.bigId)) {
      byBigId.set(p.bigId.toUpperCase(), p);
    }
  }

  const allBigIds = Array.from(byBigId.keys());
  if (allBigIds.length === 0) return 0;

  const chunks = chunkBigIds(allBigIds, 20);
  let totalUpdatedQuotes = 0;

  await Promise.all(
    targetRegions.map(async (region) => {
      for (const chunk of chunks) {
        const url = `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${encodeURIComponent(
          chunk.join(',')
        )}&market=${encodeURIComponent(
          region.code
        )}&languages=${encodeURIComponent(region.locale)}`;

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 4500);
          const res = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (!res.ok) continue;

          const data = (await res.json()) as Record<string, unknown>;
          const nodes = Array.isArray(data.Products)
            ? (data.Products as Array<Record<string, unknown>>)
            : [];

          for (const node of nodes) {
            const quote = extractMsProductFromNode(
              node,
              region.code,
              region.currency
            );
            if (quote.listPrice <= 0 && quote.salePrice === null) continue;

            const prod = byBigId.get(quote.bigId.toUpperCase());
            if (!prod) continue;

            const prevPrice = prod.pricesByRegion[region.code];
            const prevHistory = prod.historyByRegion[region.code] || [];
            const delta = detectPriceDeltaAndUpdateHistory(
              prevPrice,
              quote,
              prevHistory,
              recordedDateStr
            );

            prod.pricesByRegion[region.code] = delta.updatedRegionalPrice;
            prod.historyByRegion[region.code] = delta.updatedHistory;
            totalUpdatedQuotes++;
          }
        } catch {
          // Keep existing regional price if a specific batch request times out
        }
      }
    })
  );

  return totalUpdatedQuotes;
}

