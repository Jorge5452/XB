/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  Search,
} from 'lucide-react';
import {
  CURRENCY_METADATA,
  EXCHANGE_RATES_PER_USD,
  XBOX_REGIONS,
} from './data/xboxCatalogData';
import { LIVE_DEALS_SNAPSHOT } from './data/liveDealsSnapshot';
import {
  FilterState,
  ProductType,
  SortOption,
  WatchlistItem,
  XboxPlatform,
  XboxProduct,
} from './types/xbox';
import {
  buildRegionalComparison,
  buildXboxStoreDeepLink,
  calculatePriceAnalytics,
  convertCurrency,
  filterAndSortProducts,
  getEffectiveRegionalPrice,
  rankSearchResults,
} from './utils/pricingEngine';
import {
  fetchLiveExchangeRates,
  loadCatalogForRegion,
  searchXboxCatalog,
  syncCatalogDealsForRegion,
} from './utils/clientXboxService';
import { ProductDetailModal } from './components/ProductDetailModal';
import { WatchlistView } from './components/WatchlistView';
import { RegionalMatrixView } from './components/RegionalMatrixView';

type ActiveWorkspaceView = 'EXPLORER' | 'REGIONAL_MATRIX' | 'WATCHLIST';

const FILTERS_CACHE_KEY = 'xb_pulse_cached_filters_v2';
const WATCHLIST_CACHE_KEY = 'xb_pulse_watchlist_v2';
const REGION_CACHE_KEY = 'xb_pulse_region_v2';
const COMPARE_REGION_CACHE_KEY = 'xb_pulse_compare_region_v2';
const CURRENCY_CACHE_KEY = 'xb_pulse_currency_v2';

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

const DEFAULT_WATCHLIST: WatchlistItem[] = [
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

const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  Game: 'Juego',
  Bundle: 'Edición',
  'Add-on': 'Complemento',
};

export default function App() {
  const [activeView, setActiveView] =
    useState<ActiveWorkspaceView>('EXPLORER');
  const [products, setProducts] = useState<XboxProduct[]>(
    LIVE_DEALS_SNAPSHOT
  );

  const [activeRegionCode, setActiveRegionCode] = useState<string>(() => {
    try {
      return localStorage.getItem(REGION_CACHE_KEY) || 'MX';
    } catch {
      return 'MX';
    }
  });

  const [compareRegionCode, setCompareRegionCode] = useState<string>(() => {
    try {
      return localStorage.getItem(COMPARE_REGION_CACHE_KEY) || 'US';
    } catch {
      return 'US';
    }
  });

  const [targetCurrency, setTargetCurrency] = useState<string>(() => {
    try {
      return localStorage.getItem(CURRENCY_CACHE_KEY) || 'MXN';
    } catch {
      return 'MXN';
    }
  });

  const [filters, setFilters] = useState<FilterState>(() => {
    try {
      const saved = localStorage.getItem(FILTERS_CACHE_KEY);
      if (saved) {
        return { ...DEFAULT_FILTERS, ...JSON.parse(saved) };
      }
    } catch {
      // ignore storage errors
    }
    return DEFAULT_FILTERS;
  });

  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(() => {
    try {
      const saved = localStorage.getItem(WATCHLIST_CACHE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {
      // ignore storage errors
    }
    return DEFAULT_WATCHLIST;
  });

  const [selectedProduct, setSelectedProduct] = useState<XboxProduct | null>(
    null
  );
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [isSyncingCatalog, setIsSyncingCatalog] = useState<boolean>(false);
  const [isSearchingLiveStore, setIsSearchingLiveStore] =
    useState<boolean>(false);
  const [liveSearchResults, setLiveSearchResults] = useState<XboxProduct[]>([]);
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>(
    EXCHANGE_RATES_PER_USD
  );

  useEffect(() => {
    fetchLiveExchangeRates()
      .then((rates) => {
        if (rates) setExchangeRates(rates);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_CACHE_KEY, JSON.stringify(filters));
    } catch {
      // ignore
    }
  }, [filters]);

  useEffect(() => {
    try {
      localStorage.setItem(WATCHLIST_CACHE_KEY, JSON.stringify(watchlist));
    } catch {
      // ignore
    }
  }, [watchlist]);

  useEffect(() => {
    try {
      localStorage.setItem(REGION_CACHE_KEY, activeRegionCode);
      localStorage.setItem(COMPARE_REGION_CACHE_KEY, compareRegionCode);
      localStorage.setItem(CURRENCY_CACHE_KEY, targetCurrency);
    } catch {
      // ignore
    }
  }, [activeRegionCode, compareRegionCode, targetCurrency]);

  // Load real Xbox Store deals on mount and when switching store region
  useEffect(() => {
    let cancelled = false;
    setIsSyncingCatalog(true);

    loadCatalogForRegion(activeRegionCode)
      .then((loaded) => {
        if (cancelled || !Array.isArray(loaded) || loaded.length === 0) return;
        setProducts(loaded);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsSyncingCatalog(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeRegionCode]);

  // Real-time Xbox Store search (works in both Server and GitHub Pages modes)
  useEffect(() => {
    const q = filters.searchQuery.trim();
    if (q.length < 2) {
      setLiveSearchResults([]);
      setIsSearchingLiveStore(false);
      return;
    }

    let cancelled = false;
    setIsSearchingLiveStore(true);

    const timer = setTimeout(() => {
      searchXboxCatalog(q, activeRegionCode, products)
        .then((incoming) => {
          if (cancelled || !Array.isArray(incoming)) return;
          setLiveSearchResults(incoming);
          if (incoming.length > 0) {
            setProducts((prev) => {
              const map = new Map<string, XboxProduct>();
              for (const item of incoming) {
                map.set(item.bigId, item);
              }
              for (const item of prev) {
                if (!map.has(item.bigId)) {
                  map.set(item.bigId, item);
                }
              }
              return Array.from(map.values());
            });
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setIsSearchingLiveStore(false);
        });
    }, 260);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filters.searchQuery, activeRegionCode]);

  const handleManualSyncLiveDeals = async () => {
    setIsSyncingCatalog(true);
    try {
      const refreshed = await syncCatalogDealsForRegion(activeRegionCode);
      if (Array.isArray(refreshed) && refreshed.length > 0) {
        setProducts(refreshed);
      }
    } catch {
      // ignore
    } finally {
      setIsSyncingCatalog(false);
    }
  };

  const activeRegionObj = useMemo(
    () =>
      XBOX_REGIONS.find((r) => r.code === activeRegionCode) || XBOX_REGIONS[0],
    [activeRegionCode]
  );

  const targetCurrencySymbol =
    CURRENCY_METADATA[targetCurrency]?.symbol || `${targetCurrency} `;

  const filteredProducts = useMemo(() => {
    const baseFiltered = filterAndSortProducts(
      products,
      filters,
      activeRegionCode,
      targetCurrency,
      exchangeRates,
      '2026-11-04T22:00:00Z'
    );

    if (filters.searchQuery.trim().length >= 2 && liveSearchResults.length > 0) {
      const seen = new Set<string>();
      const combined: XboxProduct[] = [];

      for (const item of [...liveSearchResults, ...baseFiltered]) {
        if (seen.has(item.bigId)) continue;
        if (
          filters.productType !== 'ALL' &&
          item.productType !== filters.productType
        ) {
          continue;
        }
        const rPrice =
          item.pricesByRegion[activeRegionCode] || item.pricesByRegion['US'];
        if (!rPrice) continue;

        if (
          filters.minDiscountPct > 0 &&
          (rPrice.discountPct || 0) < filters.minDiscountPct
        ) {
          continue;
        }
        if (filters.subscriptionFilter === 'GAMEPASS_DISCOUNT') {
          if (rPrice.gamePassPrice === null) continue;
        } else if (filters.subscriptionFilter === 'INCLUDED_IN_GAMEPASS') {
          if (!rPrice.includedInGamePass) continue;
        }
        if (
          filters.platformFilter !== 'ALL' &&
          !item.platforms.includes(filters.platformFilter)
        ) {
          continue;
        }

        seen.add(item.bigId);
        combined.push(item);
      }

      return rankSearchResults(combined, filters.searchQuery, activeRegionCode);
    }

    return baseFiltered;
  }, [
    products,
    filters,
    activeRegionCode,
    targetCurrency,
    exchangeRates,
    liveSearchResults,
  ]);

  const watchlistMap = useMemo(() => {
    const map: Record<string, WatchlistItem> = {};
    for (const item of watchlist) {
      map[item.bigId] = item;
    }
    return map;
  }, [watchlist]);

  const handleSaveWatchlistItem = (item: WatchlistItem) => {
    setWatchlist((prev) => {
      const exists = prev.some((w) => w.bigId === item.bigId);
      if (exists) {
        return prev.map((w) => (w.bigId === item.bigId ? item : w));
      }
      return [item, ...prev];
    });
  };

  const handleRemoveWatchlistItem = (bigId: string) => {
    setWatchlist((prev) => prev.filter((w) => w.bigId !== bigId));
  };

  const handleToggleQuickWatchlist = (
    e: React.MouseEvent,
    product: XboxProduct,
    cheapestRegionCode: string
  ) => {
    e.stopPropagation();
    if (watchlistMap[product.bigId]) {
      handleRemoveWatchlistItem(product.bigId);
    } else {
      const rPrice =
        product.pricesByRegion[activeRegionCode] ||
        product.pricesByRegion['US'];
      const currentConverted = convertCurrency(
        getEffectiveRegionalPrice(rPrice),
        rPrice.currency,
        targetCurrency,
        exchangeRates
      );
      handleSaveWatchlistItem({
        bigId: product.bigId,
        addedAt: new Date().toISOString(),
        targetPrice: Math.max(10, Math.round(currentConverted * 0.9)),
        targetCurrency,
        notifyOnAnyDrop: true,
        preferredRegion: cheapestRegionCode || activeRegionCode,
      });
    }
  };

  const handleResetFilters = () => {
    setFilters(DEFAULT_FILTERS);
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      {/* STRICT 3-ZONE TOP BAR CONTRACT */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800/90 bg-[#0B0F17]/95 sticky top-0 z-30 backdrop-blur">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#ofertas"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('EXPLORER');
          }}
          className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          XB Pulse
        </a>

        {/* Zone 2: Clean single-line text navigation links */}
        <nav
          className="flex items-center gap-6 text-sm font-medium text-slate-300 overflow-x-auto"
          aria-label="Navegación principal"
        >
          <a
            href="#ofertas"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('EXPLORER');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
              activeView === 'EXPLORER'
                ? 'text-white underline decoration-[#22C55E] decoration-2 underline-offset-4'
                : 'hover:text-white'
            }`}
          >
            Ofertas
          </a>
          <a
            href="#paises"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('REGIONAL_MATRIX');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
              activeView === 'REGIONAL_MATRIX'
                ? 'text-white underline decoration-[#22C55E] decoration-2 underline-offset-4'
                : 'hover:text-white'
            }`}
          >
            Comparar Países
          </a>
          <a
            href="#mi-lista"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('WATCHLIST');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
              activeView === 'WATCHLIST'
                ? 'text-white underline decoration-[#22C55E] decoration-2 underline-offset-4'
                : 'hover:text-white'
            }`}
          >
            Mi Lista ({watchlist.length})
          </a>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            disabled={isSyncingCatalog}
            onClick={handleManualSyncLiveDeals}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#107C10] hover:bg-[#159415] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isSyncingCatalog ? 'animate-spin' : ''}`}
            />
            <span>
              {isSyncingCatalog ? 'Actualizando...' : 'Actualizar precios'}
            </span>
          </button>
        </div>
      </header>

      {/* STORE REGION & CURRENCY BAR */}
      <div className="border-b border-slate-800/80 bg-[#0F1520] px-6 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-slate-400">
            Tienda activa:{' '}
            <strong className="text-slate-200">{activeRegionObj.name}</strong> ·
            Elige abajo con qué país quieres comparar precios.
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label
                htmlFor="global-region-select"
                className="text-xs text-slate-400 whitespace-nowrap"
              >
                Tu tienda:
              </label>
              <select
                id="global-region-select"
                value={activeRegionCode}
                onChange={(e) => {
                  const newReg = e.target.value;
                  setActiveRegionCode(newReg);
                  if (compareRegionCode === newReg) {
                    setCompareRegionCode(newReg === 'MX' ? 'US' : 'MX');
                  }
                  const regObj = XBOX_REGIONS.find((r) => r.code === newReg);
                  if (regObj) {
                    setTargetCurrency(regObj.currency);
                  }
                }}
                className="px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-slate-100"
              >
                {XBOX_REGIONS.map((reg) => (
                  <option key={reg.code} value={reg.code}>
                    {reg.name} ({reg.currency})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label
                htmlFor="global-compare-region-select"
                className="text-xs text-slate-400 whitespace-nowrap"
              >
                Comparar con:
              </label>
              <select
                id="global-compare-region-select"
                value={compareRegionCode}
                onChange={(e) => setCompareRegionCode(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-slate-100"
              >
                {XBOX_REGIONS.map((reg) => (
                  <option key={reg.code} value={reg.code}>
                    {reg.name} ({reg.currency})
                  </option>
                ))}
                <option value="BEST">Mejor precio (cualquier país)</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label
                htmlFor="global-currency-select"
                className="text-xs text-slate-400 whitespace-nowrap"
              >
                Ver precios en:
              </label>
              <select
                id="global-currency-select"
                value={targetCurrency}
                onChange={(e) => setTargetCurrency(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-800 rounded-lg text-slate-100"
              >
                {Object.entries(CURRENCY_METADATA).map(([code, meta]) => (
                  <option key={code} value={code}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN WORKSPACE CONTENT */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        {activeView === 'EXPLORER' && (
          <div className="space-y-8">
            {/* Hero Header & Search Bar */}
            <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end pb-6 border-b border-slate-800">
              <div className="lg:col-span-7 space-y-2">
                <div className="text-xs font-medium text-emerald-400">
                  Ofertas y precios por región
                </div>
                <h1
                  className="text-3xl sm:text-4xl font-bold text-white tracking-tight"
                  style={{ textWrap: 'balance' }}
                >
                  Ofertas de Xbox en tiempo real
                </h1>
                <p className="text-sm text-slate-400 max-w-2xl">
                  Consulta las rebajas activas de la tienda de Xbox, revisa si
                  realmente están en su precio más bajo y compara cuánto cuestan
                  en otros países.
                </p>
              </div>

              <div className="lg:col-span-5">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label
                    htmlFor="fuzzy-search-input"
                    className="block text-xs font-medium text-slate-400 truncate"
                  >
                    Buscar en la tienda de Xbox
                  </label>
                  {isSearchingLiveStore && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 whitespace-nowrap shrink-0">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      <span>Buscando...</span>
                    </span>
                  )}
                </div>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="fuzzy-search-input"
                    type="search"
                    value={filters.searchQuery}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        searchQuery: e.target.value,
                      }))
                    }
                    placeholder="Buscar juego o complemento (ej. Battlefield, It Takes Two, Star Wars...)"
                    className="w-full pl-10 pr-4 py-2.5 text-sm bg-[#111722] border border-slate-800 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-[#107C10]"
                  />
                </div>
              </div>
            </section>

            {/* Primary 5 Deal Tabs + Filters Bar */}
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div
                  className="flex items-center gap-1 p-1 bg-[#111722] border border-slate-800 rounded-xl overflow-x-auto"
                  role="tablist"
                  aria-label="Categorías de ofertas"
                >
                  {(
                    [
                      { id: 'new_deals', label: 'En oferta' },
                      { id: 'featured', label: 'Destacados (-50%)' },
                      { id: 'historical_lows', label: 'Mínimo histórico' },
                      { id: 'ending_soon', label: 'Terminan pronto' },
                      { id: 'freebies', label: 'Gratis' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={filters.tab === t.id}
                      onClick={() =>
                        setFilters((prev) => ({ ...prev, tab: t.id }))
                      }
                      className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                        filters.tab === t.id
                          ? 'bg-[#107C10] text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <label
                    htmlFor="explorer-sort-select"
                    className="text-xs text-slate-400 whitespace-nowrap"
                  >
                    Ordenar por:
                  </label>
                  <select
                    id="explorer-sort-select"
                    value={filters.sortBy}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        sortBy: e.target.value as SortOption,
                      }))
                    }
                    className="px-3 py-2 text-xs bg-[#111722] border border-slate-800 rounded-lg text-slate-100"
                  >
                    <option value="discount_desc">Mayor descuento</option>
                    <option value="price_asc">Menor precio</option>
                    <option value="ending_soon">Terminan pronto</option>
                    <option value="newest">Recientes</option>
                    <option value="name_asc">Nombre (A-Z)</option>
                  </select>
                </div>
              </div>

              {/* Filters Row */}
              <div className="p-4 rounded-xl bg-[#111722] border border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4 items-end">
                <div className="lg:col-span-3">
                  <label
                    htmlFor="filter-product-type"
                    className="block text-xs text-slate-400 mb-1"
                  >
                    Categoría
                  </label>
                  <select
                    id="filter-product-type"
                    value={filters.productType}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        productType: e.target.value as 'ALL' | ProductType,
                      }))
                    }
                    className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-slate-200"
                  >
                    <option value="ALL">Todos</option>
                    <option value="Game">Solo juegos</option>
                    <option value="Add-on">Complementos (DLC)</option>
                    <option value="Bundle">Ediciones y lotes</option>
                  </select>
                </div>

                <div className="lg:col-span-2">
                  <label
                    htmlFor="filter-min-discount"
                    className="block text-xs text-slate-400 mb-1"
                  >
                    Descuento
                  </label>
                  <select
                    id="filter-min-discount"
                    value={filters.minDiscountPct}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        minDiscountPct: Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-slate-200"
                  >
                    <option value={0}>Todos</option>
                    <option value={25}>25% o más</option>
                    <option value={50}>50% o más</option>
                    <option value={75}>75% o más</option>
                  </select>
                </div>

                <div className="lg:col-span-3">
                  <label
                    htmlFor="filter-subscription"
                    className="block text-xs text-slate-400 mb-1"
                  >
                    Game Pass
                  </label>
                  <select
                    id="filter-subscription"
                    value={filters.subscriptionFilter}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        subscriptionFilter: e.target
                          .value as FilterState['subscriptionFilter'],
                      }))
                    }
                    className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-slate-200"
                  >
                    <option value="ALL">Todas las ofertas</option>
                    <option value="GAMEPASS_DISCOUNT">
                      Con descuento Game Pass
                    </option>
                    <option value="INCLUDED_IN_GAMEPASS">
                      Incluido en Game Pass
                    </option>
                  </select>
                </div>

                <div className="lg:col-span-2">
                  <label
                    htmlFor="filter-platform"
                    className="block text-xs text-slate-400 mb-1"
                  >
                    Consola / PC
                  </label>
                  <select
                    id="filter-platform"
                    value={filters.platformFilter}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        platformFilter: e.target.value as 'ALL' | XboxPlatform,
                      }))
                    }
                    className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-slate-200"
                  >
                    <option value="ALL">Todas</option>
                    <option value="Xbox Series X|S">Xbox Series X|S</option>
                    <option value="Xbox One">Xbox One</option>
                    <option value="Windows PC">PC</option>
                    <option value="Xbox Play Anywhere">Play Anywhere</option>
                  </select>
                </div>

                <div className="lg:col-span-2 flex justify-end">
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white bg-[#0B0F17] border border-slate-800 hover:border-slate-700 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Limpiar filtros</span>
                  </button>
                </div>
              </div>
            </section>

            {/* Results Counter */}
            <div className="flex items-center justify-between text-xs text-slate-400">
              <div>
                <strong className="text-white font-mono tabular-nums">
                  {filteredProducts.length}
                </strong>{' '}
                juegos encontrados en{' '}
                <strong className="text-slate-200">
                  {activeRegionObj.name}
                </strong>
              </div>
              <div>
                Toca cualquier juego para ver su historial y precios por país
              </div>
            </div>

            {/* Product Deals Grid */}
            {filteredProducts.length === 0 ? (
              <div className="p-12 rounded-xl bg-[#111722] border border-slate-800 text-center space-y-3">
                <div className="text-base font-bold text-white">
                  No encontramos ofertas con esos filtros
                </div>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Prueba cambiar de categoría o quitar los filtros aplicados.
                </p>
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#107C10] hover:bg-[#159415] rounded-lg transition-colors"
                >
                  Ver todas las ofertas
                </button>
              </div>
            ) : (
              <section
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
                aria-label="Catálogo de ofertas Xbox"
              >
                {filteredProducts.map((product) => {
                  const rPrice =
                    product.pricesByRegion[activeRegionCode] ||
                    product.pricesByRegion['US'];
                  const history =
                    product.historyByRegion[activeRegionCode] ||
                    product.historyByRegion['US'] ||
                    [];
                  const analytics = calculatePriceAnalytics(history, rPrice);

                  const comparison = buildRegionalComparison(
                    product,
                    XBOX_REGIONS,
                    activeRegionCode,
                    targetCurrency,
                    exchangeRates
                  );
                  const cheapestRegion = comparison[0];
                  const selectedCompareRegion =
                    compareRegionCode === 'BEST'
                      ? cheapestRegion
                      : comparison.find(
                          (c) => c.regionCode === compareRegionCode
                        ) || cheapestRegion;

                  const isTracked = Boolean(watchlistMap[product.bigId]);
                  const imgFailed = failedImages[product.bigId];

                  return (
                    <article
                      key={product.bigId}
                      onClick={() => setSelectedProduct(product)}
                      className="group rounded-xl bg-[#111722] border border-slate-800 hover:border-slate-600 transition-all duration-150 overflow-hidden flex flex-col cursor-pointer"
                    >
                      {/* Top Media Area */}
                      <div className="relative aspect-[16/10] w-full bg-slate-900 overflow-hidden border-b border-slate-800/80">
                        {!imgFailed ? (
                          <img
                            src={product.coverImage}
                            alt={product.title}
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setFailedImages((prev) => ({
                                ...prev,
                                [product.bigId]: true,
                              }))
                            }
                            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center p-6 bg-gradient-to-br from-slate-900 to-slate-800 text-center">
                            <span className="text-sm font-bold text-slate-200">
                              {product.title}
                            </span>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-[#0B0F17] via-black/30 to-transparent" />

                        {/* Bottom Scrim Overlay Metadata */}
                        <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between gap-2">
                          <div className="text-xs font-medium text-slate-200 truncate">
                            <span>
                              {PRODUCT_TYPE_LABELS[product.productType]}
                            </span>
                            <span aria-hidden="true"> · </span>
                            <span
                              className={
                                analytics.verdict === 'Mínimo histórico'
                                  ? 'text-emerald-400 font-semibold'
                                  : analytics.verdict === 'Buena oferta'
                                    ? 'text-sky-400 font-semibold'
                                    : 'text-amber-400 font-semibold'
                              }
                            >
                              {analytics.verdict}
                            </span>
                          </div>

                          <div className="text-sm font-bold font-mono tabular-nums text-emerald-400 shrink-0">
                            {analytics.currentEffectivePrice === 0
                              ? 'GRATIS'
                              : `-${analytics.discountPct}%`}
                          </div>
                        </div>
                      </div>

                      {/* Card Content Body */}
                      <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                        <div className="space-y-1.5">
                          <div className="text-xs text-slate-400 truncate">
                            <span>{product.platforms.join(' · ')}</span>
                            {rPrice.includedInGamePass && (
                              <>
                                <span aria-hidden="true"> · </span>
                                <span className="text-emerald-400 font-medium">
                                  Game Pass
                                </span>
                              </>
                            )}
                          </div>

                          <h3 className="text-base font-bold text-white group-hover:text-emerald-400 transition-colors leading-snug">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedProduct(product);
                              }}
                              className="text-left hover:underline focus:outline-none"
                            >
                              {product.title}
                            </button>
                          </h3>

                          {product.subtitle && (
                            <p className="text-xs text-slate-400 truncate">
                              {product.subtitle}
                            </p>
                          )}
                        </div>

                        {/* Pricing & User-Controlled Regional Comparison */}
                        <div className="pt-3 border-t border-slate-800/80 space-y-3">
                          <div className="flex items-baseline justify-between gap-2">
                            <div>
                              <div className="text-[11px] text-slate-400">
                                En {activeRegionObj.name}
                              </div>
                              <div className="flex items-baseline gap-2">
                                <span className="text-lg font-bold text-white font-mono tabular-nums">
                                  {analytics.currentEffectivePrice === 0
                                    ? 'Gratis'
                                    : `${activeRegionObj.symbol}${analytics.currentEffectivePrice.toLocaleString('es-MX')}`}
                                </span>
                                {rPrice.listPrice >
                                  analytics.currentEffectivePrice && (
                                  <span className="text-xs text-slate-500 line-through font-mono tabular-nums">
                                    {activeRegionObj.symbol}
                                    {rPrice.listPrice.toLocaleString('es-MX')}
                                  </span>
                                )}
                              </div>
                            </div>

                            {selectedCompareRegion && (
                              <div className="text-right">
                                <div className="text-[11px] text-slate-400">
                                  {compareRegionCode === 'BEST'
                                    ? `Mejor precio (${selectedCompareRegion.regionName})`
                                    : `En ${selectedCompareRegion.regionName}`}
                                </div>
                                <div
                                  className={`text-sm font-bold font-mono tabular-nums ${
                                    selectedCompareRegion.savingsPctVsLocal > 0
                                      ? 'text-emerald-400'
                                      : 'text-slate-200'
                                  }`}
                                >
                                  {targetCurrencySymbol}
                                  {selectedCompareRegion.convertedPrice.toLocaleString(
                                    'es-MX'
                                  )}
                                  {selectedCompareRegion.savingsPctVsLocal >
                                    0 && (
                                    <span className="text-xs text-emerald-300 ml-1">
                                      (-
                                      {selectedCompareRegion.savingsPctVsLocal}
                                      %)
                                    </span>
                                  )}
                                  {selectedCompareRegion.savingsPctVsLocal <
                                    0 && (
                                    <span className="text-xs text-rose-400 ml-1">
                                      (+
                                      {Math.abs(
                                        selectedCompareRegion.savingsPctVsLocal
                                      )}
                                      %)
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Card Footer Actions */}
                          <div className="flex items-center justify-between gap-2 pt-1">
                            <button
                              type="button"
                              onClick={(e) =>
                                handleToggleQuickWatchlist(
                                  e,
                                  product,
                                  activeRegionCode
                                )
                              }
                              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                                isTracked
                                  ? 'bg-emerald-950/60 border-emerald-700/70 text-emerald-300'
                                  : 'bg-[#0B0F17] border-slate-800 text-slate-300 hover:text-white hover:border-slate-700'
                              }`}
                            >
                              <Bookmark className="w-3.5 h-3.5" />
                              <span>{isTracked ? 'En Mi Lista' : 'Guardar'}</span>
                            </button>

                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-400 font-mono tabular-nums">
                                Mín: {activeRegionObj.symbol}
                                {analytics.lowestPriceEver.toLocaleString(
                                  'es-MX'
                                )}
                              </span>
                              <a
                                href={buildXboxStoreDeepLink(
                                  activeRegionObj.locale,
                                  product.slug,
                                  product.bigId
                                )}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Ver ${product.title} en Xbox`}
                                className="p-1.5 text-slate-400 hover:text-emerald-400 bg-[#0B0F17] border border-slate-800 rounded-lg transition-colors"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>
            )}
          </div>
        )}

        {activeView === 'REGIONAL_MATRIX' && (
          <RegionalMatrixView
            products={products}
            regions={XBOX_REGIONS}
            activeRegionCode={activeRegionCode}
            compareRegionCode={compareRegionCode}
            targetCurrency={targetCurrency}
            ratesPerUsd={exchangeRates}
            onChangeActiveRegion={(newReg) => {
              setActiveRegionCode(newReg);
              if (compareRegionCode === newReg) {
                setCompareRegionCode(newReg === 'MX' ? 'US' : 'MX');
              }
              const regObj = XBOX_REGIONS.find((r) => r.code === newReg);
              if (regObj) {
                setTargetCurrency(regObj.currency);
              }
            }}
            onChangeCompareRegion={(newComp) => setCompareRegionCode(newComp)}
            onChangeTargetCurrency={(newCurr) => setTargetCurrency(newCurr)}
            onSelectProduct={(p) => setSelectedProduct(p)}
            onProductHydrated={(hydrated) => {
              setProducts((prev) =>
                prev.map((p) => (p.bigId === hydrated.bigId ? hydrated : p))
              );
            }}
          />
        )}

        {activeView === 'WATCHLIST' && (
          <WatchlistView
            watchlist={watchlist}
            products={products}
            regions={XBOX_REGIONS}
            activeRegionCode={activeRegionCode}
            targetCurrency={targetCurrency}
            ratesPerUsd={exchangeRates}
            onUpdateItem={handleSaveWatchlistItem}
            onRemoveItem={handleRemoveWatchlistItem}
            onSelectProduct={(p) => setSelectedProduct(p)}
          />
        )}
      </main>

      {/* Clean Footer */}
      <footer className="border-t border-slate-800/80 bg-[#0B0F17] px-6 py-5 mt-12">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            XB Pulse — Ofertas y comparativa de precios por país para Xbox
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setActiveView('EXPLORER')}
              className="hover:text-slate-300 transition-colors"
            >
              Ofertas
            </button>
            <button
              type="button"
              onClick={() => setActiveView('REGIONAL_MATRIX')}
              className="hover:text-slate-300 transition-colors"
            >
              Comparar Países
            </button>
            <button
              type="button"
              onClick={() => setActiveView('WATCHLIST')}
              className="hover:text-slate-300 transition-colors"
            >
              Mi Lista
            </button>
          </div>
        </div>
      </footer>

      {/* Product Detail Modal */}
      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          allProducts={products}
          regions={XBOX_REGIONS}
          activeRegionCode={activeRegionCode}
          targetCurrency={targetCurrency}
          ratesPerUsd={exchangeRates}
          watchlistItem={watchlistMap[selectedProduct.bigId]}
          onClose={() => setSelectedProduct(null)}
          onSelectProduct={(p) => setSelectedProduct(p)}
          onSaveWatchlist={handleSaveWatchlistItem}
          onRemoveWatchlist={handleRemoveWatchlistItem}
          onProductHydrated={(hydrated) => {
            setProducts((prev) =>
              prev.map((p) => (p.bigId === hydrated.bigId ? hydrated : p))
            );
          }}
        />
      )}
    </div>
  );
}
