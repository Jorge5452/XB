export type ProductType = 'Game' | 'Bundle' | 'Add-on';

export type XboxPlatform =
  | 'Xbox Series X|S'
  | 'Xbox One'
  | 'Windows PC'
  | 'Xbox Play Anywhere';

export type PriceVerdict =
  | 'Mínimo histórico'
  | 'Buena oferta'
  | 'Precio inflado / Esperar';

export type ExplorerTab =
  | 'new_deals'
  | 'featured'
  | 'historical_lows'
  | 'ending_soon'
  | 'freebies';

export type SortOption =
  | 'discount_desc'
  | 'price_asc'
  | 'ending_soon'
  | 'newest'
  | 'name_asc';

export type WatchlistSortOption =
  | 'added_desc'
  | 'on_sale_now'
  | 'discount_desc'
  | 'price_asc'
  | 'expiring_soon';

export interface XboxRegion {
  code: string;        // e.g. 'MX', 'US', 'AR', 'TR', 'BR', 'CO', 'CL', 'ES', 'JP'
  locale: string;      // e.g. 'es-mx', 'en-us', 'es-ar', 'tr-tr', 'pt-br'
  name: string;        // e.g. 'México', 'Estados Unidos', 'Argentina', 'Turquía'
  currency: string;    // e.g. 'MXN', 'USD', 'ARS', 'TRY', 'BRL'
  symbol: string;      // e.g. '$', 'US$', 'ARS$', '₺', 'R$'
  regionGroup: 'Americas' | 'Europe' | 'Asia-Pacific' | 'MEA';
}

export interface RegionalPrice {
  regionCode: string;
  currency: string;
  listPrice: number;
  salePrice: number | null;
  gamePassPrice: number | null;
  includedInGamePass: boolean;
  discountPct: number;
  startDate: string;   // ISO timestamp
  endDate: string | null; // ISO timestamp
}

export interface PriceHistoryPoint {
  date: string;        // YYYY-MM-DD
  regularPrice: number;
  salePrice: number;
  eventLabel?: string; // e.g. 'Countdown Sale', 'Spring Sale', 'Game Pass Deal'
}

export interface PriceAnalytics {
  lowestPriceEver: number;
  lowestPriceDate: string;
  averageSalePrice: number;
  currentEffectivePrice: number;
  listPrice: number;
  discountPct: number;
  verdict: PriceVerdict;
  savingsFromList: number;
  diffFromLowestPct: number;
}

export interface XboxProduct {
  bigId: string;       // Official Microsoft Store BigId (e.g. '9NBLGGH4R6P9')
  slug: string;        // URL slug for xbox.com/[locale]/games/store/[slug]/[bigId]
  title: string;
  subtitle?: string;
  description: string;
  developer: string;
  publisher: string;
  releaseDate: string;
  productType: ProductType;
  parentBigId?: string; // For Add-ons / Bundles linked to a base game
  platforms: XboxPlatform[];
  coverImage: string;
  screenshots: string[];
  featuredDeal: boolean;
  addedToDealsAt: string; // ISO timestamp when current deal dropped
  pricesByRegion: Record<string, RegionalPrice>;
  historyByRegion: Record<string, PriceHistoryPoint[]>;
}

export interface RegionalComparisonRow {
  regionCode: string;
  regionName: string;
  locale: string;
  nativeCurrency: string;
  nativeSymbol: string;
  nativeListPrice: number;
  nativeEffectivePrice: number;
  discountPct: number;
  convertedPrice: number;
  targetCurrency: string;
  savingsPctVsLocal: number; // Positive means cheaper than user's local store
  isCheapest: boolean;
  isUserLocal: boolean;
  includedInGamePass: boolean;
  hasGamePassExclusiveDiscount: boolean;
  storeDeepLink: string;
}

export interface FilterState {
  tab: ExplorerTab;
  searchQuery: string;
  productType: 'ALL' | ProductType;
  minDiscountPct: number; // 0, 25, 50, 75
  maxPriceInLocal: number | null;
  subscriptionFilter: 'ALL' | 'GAMEPASS_DISCOUNT' | 'INCLUDED_IN_GAMEPASS';
  platformFilter: 'ALL' | XboxPlatform;
  sortBy: SortOption;
}

export interface WatchlistItem {
  bigId: string;
  addedAt: string;
  targetPrice: number | null; // In user's selected currency
  targetCurrency: string;
  notifyOnAnyDrop: boolean;
  preferredRegion: string;
  notes?: string;
}

export interface TriggeredAlert {
  id: string;
  bigId: string;
  productTitle: string;
  regionCode: string;
  currentPriceConverted: number;
  targetPrice: number | null;
  currency: string;
  discountPct: number;
  reason: 'TARGET_REACHED' | 'PRICE_DROP' | 'HISTORICAL_LOW' | 'WEEKLY_WAVE';
  triggeredAt: string;
  endDate: string | null;
}
