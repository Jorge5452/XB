import {
  FilterState,
  PriceAnalytics,
  PriceHistoryPoint,
  PriceVerdict,
  ProductType,
  RegionalComparisonRow,
  RegionalPrice,
  TriggeredAlert,
  WatchlistItem,
  WatchlistSortOption,
  XboxPlatform,
  XboxProduct,
  XboxRegion,
} from '../types/xbox';

/**
 * Converts an amount between two currencies using a USD-base exchange rate map.
 * rates[currency] = units of currency per 1 USD.
 */
export function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  ratesPerUsd: Record<string, number>
): number {
  if (amount <= 0) return 0;
  if (fromCurrency === toCurrency) return Number(amount.toFixed(2));
  const fromRate = ratesPerUsd[fromCurrency];
  const toRate = ratesPerUsd[toCurrency];
  if (!fromRate || !toRate || fromRate <= 0) {
    return Number(amount.toFixed(2));
  }
  const amountInUsd = amount / fromRate;
  const converted = amountInUsd * toRate;
  return Number(converted.toFixed(2));
}

/**
 * Returns the effective lowest payable price in a region (considering general sale and Game Pass discount).
 */
export function getEffectiveRegionalPrice(price: RegionalPrice): number {
  const candidates = [price.listPrice];
  if (price.salePrice !== null && price.salePrice >= 0) {
    candidates.push(price.salePrice);
  }
  if (price.gamePassPrice !== null && price.gamePassPrice >= 0) {
    candidates.push(price.gamePassPrice);
  }
  return Math.min(...candidates);
}

/**
 * Computes historical statistics and automatic smart purchase verdict for a product in a region.
 */
export function calculatePriceAnalytics(
  history: PriceHistoryPoint[],
  regionalPrice: RegionalPrice
): PriceAnalytics {
  const currentEffectivePrice = getEffectiveRegionalPrice(regionalPrice);
  const listPrice = regionalPrice.listPrice;

  let lowestPriceEver = currentEffectivePrice;
  let lowestPriceDate = regionalPrice.startDate.slice(0, 10);

  const saleSamples: number[] = [];

  for (const point of history) {
    const pointLow = Math.min(point.regularPrice, point.salePrice);
    if (pointLow < lowestPriceEver) {
      lowestPriceEver = pointLow;
      lowestPriceDate = point.date;
    } else if (pointLow === lowestPriceEver && point.date < lowestPriceDate) {
      lowestPriceDate = point.date;
    }
    if (point.salePrice < point.regularPrice) {
      saleSamples.push(point.salePrice);
    }
  }

  if (currentEffectivePrice < listPrice) {
    saleSamples.push(currentEffectivePrice);
  }

  const averageSalePrice =
    saleSamples.length > 0
      ? Number(
          (
            saleSamples.reduce((acc, val) => acc + val, 0) / saleSamples.length
          ).toFixed(2)
        )
      : listPrice;

  const discountPct =
    listPrice > 0
      ? Math.round(((listPrice - currentEffectivePrice) / listPrice) * 100)
      : 0;

  let verdict: PriceVerdict = 'Precio inflado / Esperar';
  if (currentEffectivePrice <= lowestPriceEver * 1.01 && discountPct >= 15) {
    verdict = 'Mínimo histórico';
  } else if (currentEffectivePrice === 0) {
    verdict = 'Mínimo histórico';
  } else if (
    currentEffectivePrice <= averageSalePrice * 1.05 &&
    discountPct >= 20
  ) {
    verdict = 'Buena oferta';
  }

  const savingsFromList = Number(
    Math.max(0, listPrice - currentEffectivePrice).toFixed(2)
  );
  const diffFromLowestPct =
    lowestPriceEver > 0
      ? Math.round(
          ((currentEffectivePrice - lowestPriceEver) / lowestPriceEver) * 100
        )
      : 0;

  return {
    lowestPriceEver: Number(lowestPriceEver.toFixed(2)),
    lowestPriceDate,
    averageSalePrice,
    currentEffectivePrice: Number(currentEffectivePrice.toFixed(2)),
    listPrice: Number(listPrice.toFixed(2)),
    discountPct,
    verdict,
    savingsFromList,
    diffFromLowestPct,
  };
}

/**
 * Generates the official Xbox Store deep link for a product in a specific regional locale.
 */
export function buildXboxStoreDeepLink(
  locale: string,
  slug: string,
  bigId: string
): string {
  return `https://www.xbox.com/${locale.toLowerCase()}/games/store/${slug}/${bigId}`;
}

/**
 * Builds the 1-Click Regional Comparison table across all available regions for a product,
 * converted to the user's selected currency and sorted from cheapest to most expensive.
 */
export function buildRegionalComparison(
  product: XboxProduct,
  regions: XboxRegion[],
  userRegionCode: string,
  targetCurrency: string,
  ratesPerUsd: Record<string, number>
): RegionalComparisonRow[] {
  const localRegionPrice = product.pricesByRegion[userRegionCode];
  const localConvertedPrice = localRegionPrice
    ? convertCurrency(
        getEffectiveRegionalPrice(localRegionPrice),
        localRegionPrice.currency,
        targetCurrency,
        ratesPerUsd
      )
    : null;

  const rows: RegionalComparisonRow[] = [];

  for (const region of regions) {
    const rPrice = product.pricesByRegion[region.code];
    if (!rPrice) continue;

    const nativeEffectivePrice = getEffectiveRegionalPrice(rPrice);
    const convertedPrice = convertCurrency(
      nativeEffectivePrice,
      rPrice.currency,
      targetCurrency,
      ratesPerUsd
    );

    const savingsPctVsLocal =
      localConvertedPrice && localConvertedPrice > 0
        ? Math.round(
            ((localConvertedPrice - convertedPrice) / localConvertedPrice) * 100
          )
        : 0;

    rows.push({
      regionCode: region.code,
      regionName: region.name,
      locale: region.locale,
      nativeCurrency: rPrice.currency,
      nativeSymbol: region.symbol,
      nativeListPrice: rPrice.listPrice,
      nativeEffectivePrice,
      discountPct: rPrice.discountPct,
      convertedPrice,
      targetCurrency,
      savingsPctVsLocal,
      isCheapest: false,
      isUserLocal: region.code === userRegionCode,
      includedInGamePass: rPrice.includedInGamePass,
      hasGamePassExclusiveDiscount:
        rPrice.gamePassPrice !== null &&
        (rPrice.salePrice === null || rPrice.gamePassPrice < rPrice.salePrice),
      storeDeepLink: buildXboxStoreDeepLink(
        region.locale,
        product.slug,
        product.bigId
      ),
    });
  }

  rows.sort((a, b) => a.convertedPrice - b.convertedPrice);

  if (rows.length > 0) {
    rows[0].isCheapest = true;
  }

  return rows;
}

/**
 * Computes a bounded Levenshtein edit distance between two strings for typo-tolerant search.
 */
export function levenshteinDistance(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const m = s.length;
  const n = t.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

/**
 * Typo-tolerant fuzzy match scorer. Returns score > 0 if query matches target (exact, substring, or <= 2 typos per token).
 */
const ACRONYM_EXPANSIONS: Record<string, string> = {
  gta: 'grand theft auto',
  gtav: 'grand theft auto v',
  gta5: 'grand theft auto v',
  gta6: 'grand theft auto vi',
  gtavi: 'grand theft auto vi',
  rdr: 'red dead redemption',
  rdr2: 'red dead redemption 2',
  cod: 'call of duty',
  mw: 'modern warfare',
  mw2: 'modern warfare 2',
  mw3: 'modern warfare 3',
  bo2: 'black ops ii',
  bo3: 'black ops iii',
  bf: 'battlefield',
  bf1: 'battlefield 1',
  bf4: 'battlefield 4',
  bf5: 'battlefield v',
  bfv: 'battlefield v',
  bf2042: 'battlefield 2042',
  mk: 'mortal kombat',
  mk1: 'mortal kombat 1',
  mk11: 'mortal kombat 11',
  mkx: 'mortal kombat x',
  re: 'resident evil',
  re2: 'resident evil 2',
  re3: 'resident evil 3',
  re4: 'resident evil 4',
  re7: 'resident evil 7',
  re8: 'resident evil village',
  fh4: 'forza horizon 4',
  fh5: 'forza horizon 5',
  sf6: 'street fighter 6',
  ac: 'assassins creed',
  fifa: 'ea sports fc',
};

export function expandXboxSearchQuery(rawQuery: string): string {
  const tokens = rawQuery
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const clean = tok.toLowerCase().replace(/[^a-z0-9]/g, '');
      return ACRONYM_EXPANSIONS[clean] || tok;
    });
  return tokens.join(' ') || rawQuery.trim();
}

export function fuzzyMatchScore(query: string, targetText: string): number {
  const normalizeText = (str: string) =>
    str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[™®©']/g, '');

  const rawQ = normalizeText(query.trim());
  if (!rawQ) return 1;
  const target = normalizeText(targetText);

  const expandedTokens = rawQ
    .split(/[\s\-:|,/]+/)
    .filter(Boolean)
    .map((tok) => ACRONYM_EXPANSIONS[tok] || tok);
  const expandedQ = expandedTokens.join(' ');

  if (expandedQ !== rawQ) {
    const rawScore = computeRawFuzzyScore(rawQ, target);
    const expScore = computeRawFuzzyScore(expandedQ, target);
    return Math.max(rawScore, expScore);
  }

  return computeRawFuzzyScore(rawQ, target);
}

function computeRawFuzzyScore(q: string, target: string): number {
  if (target === q) return 100;
  if (target.startsWith(q)) return 92;

  const queryTokens = q.split(/[\s\-:|,/]+/).filter(Boolean);
  const targetTokens = target.split(/[\s\-:|,/]+/).filter(Boolean);

  if (target.includes(q)) {
    // Check if query appears on a token boundary
    const allExactTokens = queryTokens.every((qt) =>
      targetTokens.some((tt) => tt === qt || tt.startsWith(qt))
    );
    return allExactTokens ? 86 : 78;
  }

  let matchedTokens = 0;
  let totalScore = 0;

  for (const qToken of queryTokens) {
    let bestTokenScore = 0;
    for (const tToken of targetTokens) {
      if (tToken === qToken) {
        bestTokenScore = Math.max(bestTokenScore, 82);
      } else if (tToken.startsWith(qToken) && qToken.length >= 2) {
        bestTokenScore = Math.max(bestTokenScore, 74);
      } else if (qToken.length >= 4 && tToken.includes(qToken)) {
        bestTokenScore = Math.max(bestTokenScore, 68);
      } else if (qToken.length >= 4) {
        const maxDist = qToken.length >= 6 ? 2 : 1;
        const dist = levenshteinDistance(
          qToken,
          tToken.slice(0, Math.max(qToken.length, tToken.length))
        );
        if (dist <= maxDist) {
          bestTokenScore = Math.max(bestTokenScore, 55 - dist * 10);
        }
      }
    }
    if (bestTokenScore > 0) {
      matchedTokens++;
      totalScore += bestTokenScore;
    }
  }

  if (matchedTokens === queryTokens.length && queryTokens.length > 0) {
    return Math.round(totalScore / queryTokens.length);
  }
  return 0;
}

/**
 * Computes numeric search relevance for a single product against a query,
 * prioritizing Base Games and Bundles ahead of Add-ons and Demos.
 */
export function computeSearchRelevance(
  rawQuery: string,
  product: XboxProduct
): number {
  const q = rawQuery.trim();
  if (!q) return 0;
  if (product.bigId.toUpperCase() === q.toUpperCase()) return 1000;

  const titleScore = fuzzyMatchScore(q, product.title);
  const devPubScore = fuzzyMatchScore(
    q,
    `${product.publisher} ${product.developer}`
  );
  const baseScore = Math.max(titleScore, Math.round(devPubScore * 0.7));
  if (baseScore < 40) return 0;

  const wantsDlcExplicitly =
    /\b(dlc|add-on|addon|pase|pass|pack|complemento|expansion|expansión|season)\b/i.test(
      q
    );
  const typeBonus = wantsDlcExplicitly
    ? product.productType === 'Add-on'
      ? 30
      : product.productType === 'Bundle'
        ? 15
        : 0
    : product.productType === 'Game'
      ? 35
      : product.productType === 'Bundle'
        ? 20
        : -25;

  const isDemoOrTrial = /\b(demo|beta|trial|pruebas|teaser)\b/i.test(
    product.title
  );
  const demoPenalty = isDemoOrTrial ? -20 : 0;

  return baseScore + typeBonus + demoPenalty;
}

/**
 * Ranks search results so full Games and Editions appear ahead of DLCs (Add-ons) and Demos,
 * and filters out loose non-matching search noise.
 */
export function rankSearchResults(
  products: XboxProduct[],
  rawQuery: string,
  regionCode: string
): XboxProduct[] {
  const q = rawQuery.trim();
  if (!q) return products;

  const upperQ = q.toUpperCase();
  const wantsDlcExplicitly =
    /\b(dlc|add-on|addon|pase|pass|pack|complemento|expansion|expansión|season)\b/i.test(
      q
    );

  const scored: Array<{
    product: XboxProduct;
    isExactId: number;
    hasStrongTitleMatch: number;
    typeRank: number;
    isFullRelease: number;
    titleScore: number;
    discountPct: number;
  }> = [];

  for (const product of products) {
    const isExactId = product.bigId.toUpperCase() === upperQ ? 1 : 0;
    const titleScore = fuzzyMatchScore(q, product.title);
    const devPubScore = fuzzyMatchScore(
      q,
      `${product.publisher} ${product.developer}`
    );

    if (!isExactId && titleScore < 40 && devPubScore < 80) {
      continue;
    }

    const hasStrongTitleMatch = titleScore >= 65 ? 1 : 0;

    let typeRank = 2;
    if (wantsDlcExplicitly) {
      typeRank =
        product.productType === 'Add-on'
          ? 3
          : product.productType === 'Bundle'
            ? 2
            : 1;
    } else {
      typeRank =
        product.productType === 'Game'
          ? 3
          : product.productType === 'Bundle'
            ? 2
            : 1;
    }

    const isDemoOrTrial =
      /\b(demo|beta|trial|pruebas|teaser)\b/i.test(product.title) ||
      (product.pricesByRegion[regionCode]?.listPrice === 0 &&
        product.productType === 'Game' &&
        /demo|beta|trial|teaser|episodio 1/i.test(product.title));

    const rPrice =
      product.pricesByRegion[regionCode] || product.pricesByRegion['US'];
    const discountPct = rPrice?.discountPct || 0;

    scored.push({
      product,
      isExactId,
      hasStrongTitleMatch,
      typeRank,
      isFullRelease: isDemoOrTrial ? 0 : 1,
      titleScore: Math.max(titleScore, Math.round(devPubScore * 0.7)),
      discountPct,
    });
  }

  scored.sort((a, b) => {
    if (b.isExactId !== a.isExactId) return b.isExactId - a.isExactId;
    if (b.hasStrongTitleMatch !== a.hasStrongTitleMatch) {
      return b.hasStrongTitleMatch - a.hasStrongTitleMatch;
    }
    if (b.typeRank !== a.typeRank) return b.typeRank - a.typeRank;
    if (b.isFullRelease !== a.isFullRelease) {
      return b.isFullRelease - a.isFullRelease;
    }
    if (Math.abs(b.titleScore - a.titleScore) >= 8) {
      return b.titleScore - a.titleScore;
    }
    const onSaleA = a.discountPct > 0 ? 1 : 0;
    const onSaleB = b.discountPct > 0 ? 1 : 0;
    if (onSaleB !== onSaleA) return onSaleB - onSaleA;
    if (b.discountPct !== a.discountPct) return b.discountPct - a.discountPct;
    return b.titleScore - a.titleScore;
  });

  return scored.map((s) => s.product);
}

/**
 * Filters and sorts Xbox catalog products according to active tab, search query, and combinable filters.
 */
export function filterAndSortProducts(
  products: XboxProduct[],
  filters: FilterState,
  regionCode: string,
  targetCurrency: string,
  ratesPerUsd: Record<string, number>,
  referenceNowIso = '2026-11-05T00:00:00Z'
): XboxProduct[] {
  const refNowMs = new Date(referenceNowIso).getTime();
  const hasSearchQuery = filters.searchQuery.trim().length > 0;

  const filtered = products.filter((product) => {
    const rPrice =
      product.pricesByRegion[regionCode] || product.pricesByRegion['US'];
    if (!rPrice) return false;

    const effectivePrice = getEffectiveRegionalPrice(rPrice);
    const convertedEffective = convertCurrency(
      effectivePrice,
      rPrice.currency,
      targetCurrency,
      ratesPerUsd
    );
    const history =
      product.historyByRegion[regionCode] ||
      product.historyByRegion['US'] ||
      [];
    const analytics = calculatePriceAnalytics(history, rPrice);

    // 1. Tab filter (when user actively searches by title/BigId, allow matching games across tabs)
    if (!hasSearchQuery) {
      if (filters.tab === 'freebies') {
        if (effectivePrice > 0) return false;
      } else if (filters.tab === 'historical_lows') {
        if (analytics.verdict !== 'Mínimo histórico' || effectivePrice === 0)
          return false;
      } else if (filters.tab === 'featured') {
        if (
          (!product.featuredDeal && rPrice.discountPct < 50) ||
          effectivePrice === 0
        )
          return false;
      } else if (filters.tab === 'ending_soon') {
        if (!rPrice.endDate) return false;
        const hoursLeft =
          (new Date(rPrice.endDate).getTime() - refNowMs) / (1000 * 3600);
        if (hoursLeft <= 0 || hoursLeft > 144) return false;
      } else if (filters.tab === 'new_deals') {
        if (effectivePrice === 0) return false;
        if (rPrice.discountPct <= 0 && effectivePrice > 0) return false;
      }
    }

    // 2. Product Type filter
    if (
      filters.productType !== 'ALL' &&
      product.productType !== filters.productType
    ) {
      return false;
    }

    // 3. Minimum discount percentage
    if (
      filters.minDiscountPct > 0 &&
      rPrice.discountPct < filters.minDiscountPct
    ) {
      return false;
    }

    // 4. Maximum price in user's local currency
    if (
      filters.maxPriceInLocal !== null &&
      filters.maxPriceInLocal > 0 &&
      convertedEffective > filters.maxPriceInLocal
    ) {
      return false;
    }

    // 5. Subscription filter
    if (filters.subscriptionFilter === 'GAMEPASS_DISCOUNT') {
      if (rPrice.gamePassPrice === null) return false;
    } else if (filters.subscriptionFilter === 'INCLUDED_IN_GAMEPASS') {
      if (!rPrice.includedInGamePass) return false;
    }

    // 6. Platform filter
    if (
      filters.platformFilter !== 'ALL' &&
      !product.platforms.includes(filters.platformFilter)
    ) {
      return false;
    }

    // 7. Fuzzy search filter
    if (hasSearchQuery) {
      const q = filters.searchQuery.trim();
      if (product.bigId.toUpperCase() === q.toUpperCase()) return true;
      const titleScore = fuzzyMatchScore(q, product.title);
      const devScore = fuzzyMatchScore(
        q,
        `${product.publisher} ${product.developer}`
      );
      if (titleScore === 0 && devScore < 80) return false;
    }

    return true;
  });

  if (hasSearchQuery) {
    return rankSearchResults(filtered, filters.searchQuery, regionCode);
  }

  // Sort results
  return [...filtered].sort((a, b) => {
    const priceA =
      a.pricesByRegion[regionCode] || a.pricesByRegion['US'];
    const priceB =
      b.pricesByRegion[regionCode] || b.pricesByRegion['US'];

    const effA = convertCurrency(
      getEffectiveRegionalPrice(priceA),
      priceA.currency,
      targetCurrency,
      ratesPerUsd
    );
    const effB = convertCurrency(
      getEffectiveRegionalPrice(priceB),
      priceB.currency,
      targetCurrency,
      ratesPerUsd
    );

    switch (filters.sortBy) {
      case 'discount_desc':
        return priceB.discountPct - priceA.discountPct || effA - effB;
      case 'price_asc':
        return effA - effB;
      case 'ending_soon': {
        const endA = priceA.endDate
          ? new Date(priceA.endDate).getTime()
          : Number.MAX_SAFE_INTEGER;
        const endB = priceB.endDate
          ? new Date(priceB.endDate).getTime()
          : Number.MAX_SAFE_INTEGER;
        return endA - endB;
      }
      case 'newest':
        return (
          new Date(b.addedToDealsAt).getTime() -
          new Date(a.addedToDealsAt).getTime()
        );
      case 'name_asc':
        return a.title.localeCompare(b.title, 'es');
      default:
        return 0;
    }
  });
}

/**
 * Sorts Watchlist items according to user criteria.
 */
export function sortWatchlistItems(
  items: WatchlistItem[],
  productsMap: Record<string, XboxProduct>,
  sortBy: WatchlistSortOption,
  userRegionCode: string,
  targetCurrency: string,
  ratesPerUsd: Record<string, number>
): WatchlistItem[] {
  return [...items].sort((a, b) => {
    const prodA = productsMap[a.bigId];
    const prodB = productsMap[b.bigId];
    if (!prodA || !prodB) return 0;

    const regA =
      prodA.pricesByRegion[a.preferredRegion] ||
      prodA.pricesByRegion[userRegionCode] ||
      prodA.pricesByRegion['US'];
    const regB =
      prodB.pricesByRegion[b.preferredRegion] ||
      prodB.pricesByRegion[userRegionCode] ||
      prodB.pricesByRegion['US'];

    const effA = convertCurrency(
      getEffectiveRegionalPrice(regA),
      regA.currency,
      targetCurrency,
      ratesPerUsd
    );
    const effB = convertCurrency(
      getEffectiveRegionalPrice(regB),
      regB.currency,
      targetCurrency,
      ratesPerUsd
    );

    switch (sortBy) {
      case 'added_desc':
        return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
      case 'on_sale_now': {
        const onSaleA = regA.discountPct > 0 ? 1 : 0;
        const onSaleB = regB.discountPct > 0 ? 1 : 0;
        return onSaleB - onSaleA || regB.discountPct - regA.discountPct;
      }
      case 'discount_desc':
        return regB.discountPct - regA.discountPct;
      case 'price_asc':
        return effA - effB;
      case 'expiring_soon': {
        const endA = regA.endDate
          ? new Date(regA.endDate).getTime()
          : Number.MAX_SAFE_INTEGER;
        const endB = regB.endDate
          ? new Date(regB.endDate).getTime()
          : Number.MAX_SAFE_INTEGER;
        return endA - endB;
      }
      default:
        return 0;
    }
  });
}

/**
 * Evaluates Watchlist items against current regional prices and generates push/webhook alerts.
 */
export function evaluateWatchlistAlerts(
  watchlist: WatchlistItem[],
  productsMap: Record<string, XboxProduct>,
  targetCurrency: string,
  ratesPerUsd: Record<string, number>,
  nowIso = new Date().toISOString()
): TriggeredAlert[] {
  const alerts: TriggeredAlert[] = [];

  for (const item of watchlist) {
    const product = productsMap[item.bigId];
    if (!product) continue;

    const rPrice =
      product.pricesByRegion[item.preferredRegion] ||
      product.pricesByRegion['US'];
    if (!rPrice) continue;

    const effNative = getEffectiveRegionalPrice(rPrice);
    const effConverted = convertCurrency(
      effNative,
      rPrice.currency,
      targetCurrency,
      ratesPerUsd
    );

    const history =
      product.historyByRegion[item.preferredRegion] ||
      product.historyByRegion['US'] ||
      [];
    const analytics = calculatePriceAnalytics(history, rPrice);

    if (
      item.targetPrice !== null &&
      item.targetPrice > 0 &&
      effConverted <= item.targetPrice
    ) {
      alerts.push({
        id: `alert-${item.bigId}-target`,
        bigId: item.bigId,
        productTitle: product.title,
        regionCode: item.preferredRegion,
        currentPriceConverted: effConverted,
        targetPrice: item.targetPrice,
        currency: targetCurrency,
        discountPct: rPrice.discountPct,
        reason: 'TARGET_REACHED',
        triggeredAt: nowIso,
        endDate: rPrice.endDate,
      });
    } else if (item.notifyOnAnyDrop && rPrice.discountPct > 0) {
      alerts.push({
        id: `alert-${item.bigId}-drop`,
        bigId: item.bigId,
        productTitle: product.title,
        regionCode: item.preferredRegion,
        currentPriceConverted: effConverted,
        targetPrice: item.targetPrice,
        currency: targetCurrency,
        discountPct: rPrice.discountPct,
        reason:
          analytics.verdict === 'Mínimo histórico'
            ? 'HISTORICAL_LOW'
            : 'PRICE_DROP',
        triggeredAt: nowIso,
        endDate: rPrice.endDate,
      });
    }
  }

  return alerts;
}

/**
 * Parses an official Microsoft Store Display Catalog v7.0 response payload
 * (https://displaycatalog.mp.microsoft.com/v7.0/products) into normalized product metadata and pricing.
 */
export interface ParsedMsCatalogItem {
  bigId: string;
  title: string;
  description: string;
  developer: string;
  publisher: string;
  productType: ProductType;
  platforms: XboxPlatform[];
  listPrice: number;
  salePrice: number | null;
  discountPct: number;
  currency: string;
  endDate: string | null;
}

export function parseMsDisplayCatalogPayload(
  rawPayload: Record<string, unknown>,
  fallbackMarketCurrency = 'USD'
): ParsedMsCatalogItem | null {
  const products = rawPayload?.Products as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(products) || products.length === 0) {
    return null;
  }

  const rawProd = products[0];
  const bigId = String(rawProd.ProductId || 'UNKNOWN');

  const localizedArr =
    (rawProd.LocalizedProperties as Array<Record<string, unknown>>) || [];
  const loc = localizedArr[0] || {};
  const title = String(loc.ProductTitle || 'Xbox Store Product');
  const description = String(
    loc.ShortDescription || loc.ProductDescription || ''
  );
  const developer = String(loc.DeveloperName || 'Xbox Game Studios');
  const publisher = String(loc.PublisherName || 'Microsoft');

  const rawKind = String(rawProd.ProductKind || 'Game').toLowerCase();
  let productType: ProductType = 'Game';
  if (rawKind.includes('bundle')) {
    productType = 'Bundle';
  } else if (
    rawKind.includes('durable') ||
    rawKind.includes('addon') ||
    rawKind.includes('consumable')
  ) {
    productType = 'Add-on';
  }

  const platforms: XboxPlatform[] = ['Xbox Series X|S'];
  const props = (rawProd.Properties as Record<string, unknown>) || {};
  if (props.XboxCrossGenCompatible) {
    platforms.push('Xbox One');
  }
  if (props.IsXboxPlayAnywhere) {
    platforms.push('Windows PC', 'Xbox Play Anywhere');
  }

  let listPrice = 59.99;
  let salePrice: number | null = null;
  let currency = fallbackMarketCurrency;
  let endDate: string | null = null;

  const skuAvailabilities =
    (rawProd.DisplaySkuAvailabilities as Array<Record<string, unknown>>) || [];
  if (skuAvailabilities.length > 0) {
    const availabilities =
      (skuAvailabilities[0].Availabilities as Array<Record<string, unknown>>) ||
      [];
    for (const avail of availabilities) {
      const orderData =
        (avail.OrderManagementData as Record<string, unknown>) || {};
      const priceObj = (orderData.Price as Record<string, unknown>) || {};
      const msrp = typeof priceObj.MSRP === 'number' ? priceObj.MSRP : null;
      const lp =
        typeof priceObj.ListPrice === 'number' ? priceObj.ListPrice : null;

      if (msrp !== null && msrp === 0 && lp === 0) {
        continue;
      }

      if (typeof priceObj.CurrencyCode === 'string' && priceObj.CurrencyCode) {
        currency = priceObj.CurrencyCode;
      }

      if (msrp !== null && msrp > 0) {
        if (msrp > listPrice || listPrice === 59.99) {
          listPrice = msrp;
        }
        if (lp !== null && lp < msrp && (salePrice === null || lp < salePrice)) {
          salePrice = lp;
        }
      } else {
        if (lp !== null) {
          listPrice = lp;
        }
        if (
          typeof priceObj.WholesalePrice === 'number' &&
          priceObj.WholesalePrice < listPrice
        ) {
          salePrice = priceObj.WholesalePrice;
        }
      }

      const conditions = (avail.Conditions as Record<string, unknown>) || {};
      if (
        typeof conditions.EndDate === 'string' &&
        !conditions.EndDate.startsWith('999')
      ) {
        endDate = conditions.EndDate;
      }
    }
  }

  const discountPct =
    salePrice !== null && listPrice > 0
      ? Math.round(((listPrice - salePrice) / listPrice) * 100)
      : 0;

  return {
    bigId,
    title,
    description,
    developer,
    publisher,
    productType,
    platforms,
    listPrice,
    salePrice,
    discountPct,
    currency,
    endDate,
  };
}
