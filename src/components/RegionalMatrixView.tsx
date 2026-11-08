import React, { useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  RefreshCw,
  Search,
} from 'lucide-react';
import { ProductType, XboxProduct, XboxRegion } from '../types/xbox';
import {
  buildRegionalComparison,
  buildXboxStoreDeepLink,
  computeSearchRelevance,
  convertCurrency,
  getEffectiveRegionalPrice,
  rankSearchResults,
} from '../utils/pricingEngine';
import { CURRENCY_METADATA } from '../data/xboxCatalogData';
import { hydrateProductMultiRegion } from '../utils/clientXboxService';

interface RegionalMatrixViewProps {
  products: XboxProduct[];
  regions: XboxRegion[];
  activeRegionCode: string;
  compareRegionCode: string;
  targetCurrency: string;
  ratesPerUsd: Record<string, number>;
  onChangeActiveRegion: (regionCode: string) => void;
  onChangeCompareRegion: (regionCode: string) => void;
  onChangeTargetCurrency: (currencyCode: string) => void;
  onSelectProduct: (product: XboxProduct) => void;
  onProductHydrated: (hydrated: XboxProduct) => void;
}

type ComparatorSortOption =
  | 'savings_desc'
  | 'compare_price_asc'
  | 'local_price_asc'
  | 'discount_desc'
  | 'name_asc';

const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  Game: 'Juego',
  Bundle: 'Edición / Lote',
  'Add-on': 'Complemento',
};

export const RegionalMatrixView: React.FC<RegionalMatrixViewProps> = ({
  products,
  regions,
  activeRegionCode,
  compareRegionCode,
  targetCurrency,
  ratesPerUsd,
  onChangeActiveRegion,
  onChangeCompareRegion,
  onChangeTargetCurrency,
  onSelectProduct,
  onProductHydrated,
}) => {
  const [thirdRegionCode, setThirdRegionCode] = useState<string>('NONE');
  const [showBestPriceAddon, setShowBestPriceAddon] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<ComparatorSortOption>('savings_desc');
  const [onlyCheaperInTarget, setOnlyCheaperInTarget] =
    useState<boolean>(false);
  const [expandedBigId, setExpandedBigId] = useState<string | null>(null);
  const [hydratingBigId, setHydratingBigId] = useState<string | null>(null);

  const currencySymbol =
    CURRENCY_METADATA[targetCurrency]?.symbol || `${targetCurrency} `;

  const activeRegionObj =
    regions.find((r) => r.code === activeRegionCode) || regions[0];

  const isAutoBestMode = compareRegionCode === 'BEST';
  const compareRegionObj = !isAutoBestMode
    ? regions.find((r) => r.code === compareRegionCode) ||
      regions.find((r) => r.code !== activeRegionCode) ||
      regions[1]
    : null;

  const thirdRegionObj =
    thirdRegionCode !== 'NONE'
      ? regions.find((r) => r.code === thirdRegionCode) || null
      : null;

  const handleToggleExpandAllCountries = async (
    e: React.MouseEvent,
    product: XboxProduct
  ) => {
    e.stopPropagation();
    if (expandedBigId === product.bigId) {
      setExpandedBigId(null);
      return;
    }
    setExpandedBigId(product.bigId);
    setHydratingBigId(product.bigId);
    try {
      const hydrated = await hydrateProductMultiRegion(
        product,
        activeRegionCode,
        targetCurrency
      );
      if (hydrated) {
        onProductHydrated(hydrated);
      }
    } catch {
      // keep existing regional prices
    } finally {
      setHydratingBigId(null);
    }
  };

  const handleSwapRegions = () => {
    if (!isAutoBestMode && compareRegionObj) {
      const prevActive = activeRegionObj.code;
      const prevCompare = compareRegionObj.code;
      onChangeActiveRegion(prevCompare);
      onChangeCompareRegion(prevActive);
    }
  };

  const rows = useMemo(() => {
    const q = searchQuery.trim();
    const filtered = q
      ? rankSearchResults(products, q, activeRegionCode)
      : products;

    const mapped = filtered
      .map((product) => {
        const comparison = buildRegionalComparison(
          product,
          regions,
          activeRegionCode,
          targetCurrency,
          ratesPerUsd
        );
        const cheapestRow = comparison[0];

        const localPriceObj =
          product.pricesByRegion[activeRegionCode] ||
          product.pricesByRegion['US'];
        const localNative = getEffectiveRegionalPrice(localPriceObj);
        const localConverted = convertCurrency(
          localNative,
          localPriceObj.currency,
          targetCurrency,
          ratesPerUsd
        );

        // Selected comparison country (or Mejor precio if user explicitly chose 'BEST')
        const targetRow = isAutoBestMode
          ? cheapestRow
          : comparison.find(
              (c) => c.regionCode === (compareRegionObj?.code || 'US')
            ) || cheapestRow;

        const thirdRow = thirdRegionObj
          ? comparison.find((c) => c.regionCode === thirdRegionObj.code) || null
          : null;

        if (!targetRow) return null;

        const diffAmount = Number(
          (localConverted - targetRow.convertedPrice).toFixed(2)
        );
        const diffPct =
          localConverted > 0
            ? Math.round(
                ((localConverted - targetRow.convertedPrice) / localConverted) *
                  100
              )
            : 0;

        return {
          product,
          localPriceObj,
          localNative,
          localConverted,
          targetRow,
          thirdRow,
          cheapestRow,
          allRegionsComparison: comparison,
          diffAmount,
          diffPct,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const afterCheaperFilter = onlyCheaperInTarget
      ? mapped.filter((r) => r.diffAmount > 0)
      : mapped;

    afterCheaperFilter.sort((a, b) => {
      if (q) {
        const isAddOnA = a.product.productType === 'Add-on' ? 1 : 0;
        const isAddOnB = b.product.productType === 'Add-on' ? 1 : 0;
        if (isAddOnA !== isAddOnB) return isAddOnA - isAddOnB;

        const relDiff =
          computeSearchRelevance(q, b.product) -
          computeSearchRelevance(q, a.product);
        if (Math.abs(relDiff) > 12) return relDiff;
      }

      switch (sortBy) {
        case 'savings_desc':
          return b.diffPct - a.diffPct || b.diffAmount - a.diffAmount;
        case 'compare_price_asc':
          return a.targetRow.convertedPrice - b.targetRow.convertedPrice;
        case 'local_price_asc':
          return a.localConverted - b.localConverted;
        case 'discount_desc':
          return b.targetRow.discountPct - a.targetRow.discountPct;
        case 'name_asc':
          return a.product.title.localeCompare(b.product.title, 'es');
        default:
          return 0;
      }
    });

    return afterCheaperFilter;
  }, [
    products,
    regions,
    activeRegionCode,
    compareRegionCode,
    compareRegionObj,
    thirdRegionObj,
    isAutoBestMode,
    targetCurrency,
    ratesPerUsd,
    searchQuery,
    sortBy,
    onlyCheaperInTarget,
  ]);

  const summaryStats = useMemo(() => {
    if (rows.length === 0) {
      return {
        cheaperCount: 0,
        avgSavingsPct: 0,
        bestDealTitle: '—',
        bestDealSavingsAmt: 0,
        bestDealSavingsPct: 0,
      };
    }
    const cheaperRows = rows.filter((r) => r.diffPct > 0);
    const avgSavingsPct =
      cheaperRows.length > 0
        ? Math.round(
            cheaperRows.reduce((acc, r) => acc + r.diffPct, 0) /
              cheaperRows.length
          )
        : 0;

    let bestRow = rows[0];
    for (const r of rows) {
      if (r.diffAmount > bestRow.diffAmount) {
        bestRow = r;
      }
    }

    return {
      cheaperCount: cheaperRows.length,
      avgSavingsPct,
      bestDealTitle: bestRow.diffAmount > 0 ? bestRow.product.title : '—',
      bestDealSavingsAmt: Math.max(0, bestRow.diffAmount),
      bestDealSavingsPct: Math.max(0, bestRow.diffPct),
    };
  }, [rows]);

  const quickCompareRegions = ['US', 'AR', 'TR', 'BR', 'CO', 'CL', 'ES', 'EG'];
  const showBestPriceColumn = !isAutoBestMode && showBestPriceAddon;

  const totalColumns =
    6 + (thirdRegionObj ? 1 : 0) + (showBestPriceColumn ? 1 : 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-slate-800">
        <div className="text-xs font-medium text-emerald-400">
          Comparador interactivo entre tiendas
        </div>
        <h2 className="text-2xl sm:text-3xl font-bold text-white mt-1">
          Compara tu precio con cualquier país
        </h2>
        <p className="text-sm text-slate-400 mt-1 max-w-3xl">
          Elige tu tienda base y el país con el que quieres comparar, o activa
          la opción <strong className="text-emerald-400">Mejor precio</strong>{' '}
          como agregado para ver también dónde está más barato cada juego en{' '}
          <strong className="text-slate-200">{targetCurrency}</strong>.
        </p>
      </div>

      {/* Interactive Country Comparison Builder */}
      <div className="p-5 rounded-xl bg-[#111722] border border-slate-800 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          {/* 1. User Base Store */}
          <div className="md:col-span-3">
            <label
              htmlFor="comp-base-region"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              1. Tu tienda (Base)
            </label>
            <select
              id="comp-base-region"
              value={activeRegionCode}
              onChange={(e) => onChangeActiveRegion(e.target.value)}
              className="w-full px-3 py-2.5 text-xs font-medium bg-[#0B0F17] border border-slate-700 rounded-lg text-white focus:outline-none focus:border-[#107C10]"
            >
              {regions.map((reg) => (
                <option key={reg.code} value={reg.code}>
                  {reg.name} ({reg.currency})
                </option>
              ))}
            </select>
          </div>

          {/* Swap Button */}
          <div className="md:col-span-1 flex justify-center">
            <button
              type="button"
              disabled={isAutoBestMode}
              onClick={handleSwapRegions}
              title="Intercambiar tiendas"
              aria-label="Intercambiar tienda base y país a comparar"
              className="w-full md:w-auto p-2.5 text-xs text-slate-300 hover:text-white bg-[#0B0F17] border border-slate-800 hover:border-slate-600 disabled:opacity-40 rounded-lg transition-colors flex items-center justify-center"
            >
              <ArrowRightLeft className="w-4 h-4" />
            </button>
          </div>

          {/* 2. Target Country to Compare Against */}
          <div className="md:col-span-3">
            <label
              htmlFor="comp-target-region"
              className="block text-xs font-medium text-emerald-400 mb-1.5"
            >
              2. País con el que quieres comparar
            </label>
            <select
              id="comp-target-region"
              value={compareRegionCode}
              onChange={(e) => onChangeCompareRegion(e.target.value)}
              className="w-full px-3 py-2.5 text-xs font-semibold bg-[#0B0F17] border border-emerald-700/80 rounded-lg text-white focus:outline-none focus:border-emerald-500"
            >
              {regions.map((reg) => (
                <option key={reg.code} value={reg.code}>
                  {reg.name} ({reg.currency})
                </option>
              ))}
              <option value="BEST">Opción: Mejor precio (cualquier país)</option>
            </select>
          </div>

          {/* 3. Optional 3rd Country */}
          <div className="md:col-span-3">
            <label
              htmlFor="comp-third-region"
              className="block text-xs font-medium text-slate-400 mb-1.5"
            >
              3. Tercer país (opcional)
            </label>
            <select
              id="comp-third-region"
              value={thirdRegionCode}
              onChange={(e) => setThirdRegionCode(e.target.value)}
              className="w-full px-3 py-2.5 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-[#107C10]"
            >
              <option value="NONE">Ninguno (comparar 2 tiendas)</option>
              {regions.map((reg) => (
                <option key={reg.code} value={reg.code}>
                  {reg.name} ({reg.currency})
                </option>
              ))}
            </select>
          </div>

          {/* 4. Display Currency */}
          <div className="md:col-span-2">
            <label
              htmlFor="comp-currency-select"
              className="block text-xs font-medium text-slate-400 mb-1.5"
            >
              Convertir todo a
            </label>
            <select
              id="comp-currency-select"
              value={targetCurrency}
              onChange={(e) => onChangeTargetCurrency(e.target.value)}
              className="w-full px-3 py-2.5 text-xs font-mono bg-[#0B0F17] border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-[#107C10]"
            >
              {Object.entries(CURRENCY_METADATA).map(([code, meta]) => (
                <option key={code} value={code}>
                  {code} ({meta.symbol.trim()})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Quick Country Switcher Buttons & Addon Toggles */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-800/80">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-400 mr-1">
              Comparar rápido con:
            </span>
            {quickCompareRegions
              .filter((code) => code !== activeRegionCode)
              .map((code) => {
                const reg = regions.find((r) => r.code === code);
                if (!reg) return null;
                const isSelected = compareRegionCode === code;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => onChangeCompareRegion(code)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                      isSelected
                        ? 'bg-[#107C10] border-emerald-500 text-white'
                        : 'bg-[#0B0F17] border-slate-800 text-slate-300 hover:text-white hover:border-slate-700'
                    }`}
                  >
                    {reg.name}
                  </button>
                );
              })}
            <button
              type="button"
              onClick={() => onChangeCompareRegion('BEST')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors ${
                isAutoBestMode
                  ? 'bg-[#107C10] border-emerald-500 text-white'
                  : 'bg-[#0B0F17] border-emerald-800/80 text-emerald-400 hover:text-white hover:border-emerald-600'
              }`}
            >
              Mejor precio
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {!isAutoBestMode && (
              <label
                htmlFor="best-price-addon-toggle"
                className="flex items-center gap-2 text-xs text-emerald-300 cursor-pointer"
              >
                <input
                  id="best-price-addon-toggle"
                  type="checkbox"
                  checked={showBestPriceAddon}
                  onChange={(e) => setShowBestPriceAddon(e.target.checked)}
                  className="w-4 h-4 accent-[#107C10] rounded"
                />
                <span>Agregar columna de Mejor precio</span>
              </label>
            )}

            <label
              htmlFor="only-cheaper-toggle"
              className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer"
            >
              <input
                id="only-cheaper-toggle"
                type="checkbox"
                checked={onlyCheaperInTarget}
                onChange={(e) => setOnlyCheaperInTarget(e.target.checked)}
                className="w-4 h-4 accent-[#107C10] rounded"
              />
              <span>
                Solo más baratos que en {activeRegionObj.name}
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* Comparison Summary Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-[#111722] border border-slate-800">
          <div className="text-xs text-slate-400">
            {isAutoBestMode
              ? `${activeRegionObj.name} vs. Mejor precio`
              : `${activeRegionObj.name} vs. ${compareRegionObj?.name}`}
          </div>
          <div className="text-lg font-bold text-white mt-1 font-mono tabular-nums">
            {summaryStats.cheaperCount} de {rows.length} juegos
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            son más económicos en{' '}
            {isAutoBestMode ? 'Mejor precio' : compareRegionObj?.name} hoy
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#111722] border border-slate-800">
          <div className="text-xs text-slate-400">
            Ahorro promedio cuando conviene
          </div>
          <div className="text-lg font-bold text-emerald-400 mt-1 font-mono tabular-nums">
            {summaryStats.avgSavingsPct > 0
              ? `-${summaryStats.avgSavingsPct}%`
              : '0%'}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            respecto al precio actual en {activeRegionObj.name}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#111722] border border-slate-800">
          <div className="text-xs text-slate-400">Mayor ahorro disponible</div>
          <div className="text-base font-bold text-white truncate mt-1">
            {summaryStats.bestDealTitle}
          </div>
          <div className="text-xs text-emerald-400 font-mono tabular-nums mt-0.5">
            {summaryStats.bestDealSavingsAmt > 0
              ? `Te ahorras ${currencySymbol}${summaryStats.bestDealSavingsAmt.toLocaleString('es-MX')} (-${summaryStats.bestDealSavingsPct}%)`
              : 'Sin diferencia a favor en esta tienda'}
          </div>
        </div>
      </div>

      {/* Search & Sort Controls for the Table */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filtrar juego dentro del comparador..."
            aria-label="Filtrar juego dentro del comparador"
            className="w-full pl-10 pr-4 py-2 text-xs bg-[#111722] border border-slate-800 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-[#107C10]"
          />
        </div>

        <div className="flex items-center gap-2">
          <label
            htmlFor="comparator-sort-select"
            className="text-xs text-slate-400 whitespace-nowrap"
          >
            Ordenar tabla por:
          </label>
          <select
            id="comparator-sort-select"
            value={sortBy}
            onChange={(e) =>
              setSortBy(e.target.value as ComparatorSortOption)
            }
            className="px-3 py-2 text-xs bg-[#111722] border border-slate-800 rounded-lg text-slate-100"
          >
            <option value="savings_desc">Mayor ahorro para ti</option>
            <option value="compare_price_asc">
              Menor precio en{' '}
              {isAutoBestMode ? 'Mejor precio' : compareRegionObj?.name}
            </option>
            <option value="local_price_asc">
              Menor precio en {activeRegionObj.name}
            </option>
            <option value="discount_desc">Mayor descuento (%)</option>
            <option value="name_asc">Nombre (A-Z)</option>
          </select>
        </div>
      </div>

      {/* Main Comparison Table */}
      <div className="border border-slate-800 rounded-xl overflow-hidden bg-[#111722]">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-[#0B0F17] text-xs font-semibold text-slate-400">
                <th className="py-3 px-4">Juego</th>
                <th className="py-3 px-4 text-right">
                  Tu tienda: {activeRegionObj.name}
                </th>
                <th className="py-3 px-4 text-right">
                  {isAutoBestMode
                    ? 'Mejor precio (país)'
                    : `En ${compareRegionObj?.name}`}
                </th>
                <th className="py-3 px-4 text-right">
                  {isAutoBestMode
                    ? `Mejor precio en ${targetCurrency}`
                    : `${compareRegionObj?.name} en ${targetCurrency}`}
                </th>
                {thirdRegionObj && (
                  <th className="py-3 px-4 text-right">
                    {thirdRegionObj.name} en {targetCurrency}
                  </th>
                )}
                <th className="py-3 px-4 text-right">
                  Diferencia vs. {activeRegionObj.name}
                </th>
                {showBestPriceColumn && (
                  <th className="py-3 px-4 text-right text-emerald-400">
                    Mejor precio (opción global)
                  </th>
                )}
                <th className="py-3 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-xs">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={totalColumns}
                    className="py-10 px-4 text-center text-slate-400"
                  >
                    No hay juegos que coincidan con ese filtro en este momento.
                  </td>
                </tr>
              ) : (
                rows.map(
                  ({
                    product,
                    localPriceObj,
                    localNative,
                    localConverted,
                    targetRow,
                    thirdRow,
                    cheapestRow,
                    allRegionsComparison,
                    diffAmount,
                    diffPct,
                  }) => {
                    const isExpanded = expandedBigId === product.bigId;
                    const isHydrating = hydratingBigId === product.bigId;

                    return (
                      <React.Fragment key={product.bigId}>
                        <tr
                          onClick={() => onSelectProduct(product)}
                          className="hover:bg-slate-800/40 cursor-pointer transition-colors"
                        >
                          {/* Game Column */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <img
                                src={product.coverImage}
                                alt={product.title}
                                referrerPolicy="no-referrer"
                                className="w-9 h-12 object-cover rounded border border-slate-800 shrink-0"
                              />
                              <div className="min-w-0">
                                <div className="font-semibold text-white truncate max-w-[230px]">
                                  {product.title}
                                </div>
                                <div className="text-[11px] text-slate-400">
                                  {PRODUCT_TYPE_LABELS[product.productType]} ·{' '}
                                  {product.publisher}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* User Base Store Price */}
                          <td className="py-3 px-4 text-right font-mono tabular-nums">
                            <div className="font-semibold text-slate-200">
                              {currencySymbol}
                              {localConverted.toLocaleString('es-MX')}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {activeRegionObj.currency !== targetCurrency
                                ? `${activeRegionObj.symbol}${localNative.toLocaleString('es-MX')} ${localPriceObj.currency}`
                                : localPriceObj.discountPct > 0
                                  ? `-${localPriceObj.discountPct}% en oferta`
                                  : 'Precio regular'}
                            </div>
                          </td>

                          {/* Target Country Native Price */}
                          <td className="py-3 px-4 text-right font-mono tabular-nums">
                            <div className="text-slate-200 font-medium">
                              {isAutoBestMode && (
                                <span className="text-emerald-400 font-sans font-semibold mr-1.5">
                                  {targetRow.regionName}:
                                </span>
                              )}
                              {targetRow.nativeSymbol}
                              {targetRow.nativeEffectivePrice.toLocaleString(
                                'es-MX'
                              )}{' '}
                              <span className="text-slate-500">
                                {targetRow.nativeCurrency}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {targetRow.discountPct > 0
                                ? `-${targetRow.discountPct}% dto.`
                                : 'Sin descuento'}
                            </div>
                          </td>

                          {/* Target Country Converted Price */}
                          <td className="py-3 px-4 text-right font-mono tabular-nums">
                            <div className="text-sm font-bold text-white">
                              {currencySymbol}
                              {targetRow.convertedPrice.toLocaleString('es-MX')}
                            </div>
                          </td>

                          {/* Optional 3rd Country Column */}
                          {thirdRegionObj && (
                            <td className="py-3 px-4 text-right font-mono tabular-nums">
                              {thirdRow ? (
                                <>
                                  <div className="font-semibold text-slate-200">
                                    {currencySymbol}
                                    {thirdRow.convertedPrice.toLocaleString(
                                      'es-MX'
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                    {thirdRow.nativeSymbol}
                                    {thirdRow.nativeEffectivePrice.toLocaleString(
                                      'es-MX'
                                    )}{' '}
                                    {thirdRow.nativeCurrency}
                                  </div>
                                </>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </td>
                          )}

                          {/* Difference vs Local Store */}
                          <td className="py-3 px-4 text-right font-mono tabular-nums">
                            {diffAmount > 0 ? (
                              <div>
                                <div className="text-emerald-400 font-bold">
                                  Ahorras {currencySymbol}
                                  {diffAmount.toLocaleString('es-MX')}
                                </div>
                                <div className="text-[11px] text-emerald-300">
                                  (-{diffPct}% más barato)
                                </div>
                              </div>
                            ) : diffAmount < 0 ? (
                              <div>
                                <div className="text-rose-400 font-semibold">
                                  +{currencySymbol}
                                  {Math.abs(diffAmount).toLocaleString('es-MX')}
                                </div>
                                <div className="text-[11px] text-rose-300/80">
                                  (+{Math.abs(diffPct)}% más caro)
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400">
                                Mismo precio
                              </span>
                            )}
                          </td>

                          {/* Optional Add-on Column: Mejor precio */}
                          {showBestPriceColumn && (
                            <td className="py-3 px-4 text-right font-mono tabular-nums bg-emerald-950/10">
                              {cheapestRow ? (
                                <div>
                                  <div className="text-emerald-400 font-bold">
                                    {currencySymbol}
                                    {cheapestRow.convertedPrice.toLocaleString(
                                      'es-MX'
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-300 font-sans">
                                    {cheapestRow.regionName}{' '}
                                    {cheapestRow.savingsPctVsLocal > 0 && (
                                      <span className="text-emerald-400 font-mono">
                                        (-{cheapestRow.savingsPctVsLocal}%)
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </td>
                          )}

                          {/* Actions: Expand all 16 countries or go to store */}
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={(e) =>
                                  handleToggleExpandAllCountries(e, product)
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 bg-[#0B0F17] border border-slate-700 hover:border-slate-500 rounded-lg transition-colors whitespace-nowrap"
                              >
                                <span>16 países</span>
                                {isExpanded ? (
                                  <ChevronUp className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                )}
                              </button>

                              <a
                                href={buildXboxStoreDeepLink(
                                  targetRow.locale,
                                  product.slug,
                                  product.bigId
                                )}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-white bg-[#107C10] hover:bg-[#159415] rounded-lg transition-colors whitespace-nowrap"
                              >
                                <span>Tienda ({targetRow.regionCode})</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          </td>
                        </tr>

                        {/* Expandable 16-Country Breakdown Row */}
                        {isExpanded && (
                          <tr className="bg-[#0B0F17]/90">
                            <td
                              colSpan={totalColumns}
                              className="p-4 border-t border-slate-800"
                            >
                              <div className="space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="text-xs font-semibold text-white flex items-center gap-2">
                                    <span>
                                      Todos los países disponibles para{' '}
                                      <strong className="text-emerald-400">
                                        {product.title}
                                      </strong>
                                    </span>
                                    {isHydrating && (
                                      <span className="inline-flex items-center gap-1 text-[11px] font-normal text-emerald-400">
                                        <RefreshCw className="w-3 h-3 animate-spin" />
                                        <span>
                                          Consultando tiendas de Xbox...
                                        </span>
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-400">
                                    Haz clic en cualquier país abajo para fijarlo
                                    como tu país a comparar
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
                                  {allRegionsComparison.map((regRow) => {
                                    const isSelectedCompare =
                                      !isAutoBestMode &&
                                      compareRegionObj?.code ===
                                        regRow.regionCode;
                                    const isUserBase =
                                      regRow.regionCode === activeRegionCode;

                                    return (
                                      <button
                                        key={regRow.regionCode}
                                        type="button"
                                        onClick={() => {
                                          if (
                                            regRow.regionCode !==
                                            activeRegionCode
                                          ) {
                                            onChangeCompareRegion(
                                              regRow.regionCode
                                            );
                                          }
                                        }}
                                        className={`p-2.5 rounded-lg border text-left transition-colors ${
                                          isSelectedCompare
                                            ? 'bg-emerald-950/50 border-emerald-600'
                                            : isUserBase
                                              ? 'bg-sky-950/40 border-sky-700/70'
                                              : 'bg-[#111722] border-slate-800 hover:border-slate-600'
                                        }`}
                                      >
                                        <div className="flex items-center justify-between gap-1 text-[11px] font-semibold text-white truncate">
                                          <span className="truncate">
                                            {regRow.regionName}
                                          </span>
                                          <span className="text-[10px] text-slate-400 font-mono">
                                            {regRow.regionCode}
                                          </span>
                                        </div>
                                        <div className="text-xs font-bold text-emerald-400 font-mono tabular-nums mt-1">
                                          {currencySymbol}
                                          {regRow.convertedPrice.toLocaleString(
                                            'es-MX'
                                          )}
                                        </div>
                                        <div className="text-[10px] text-slate-400 font-mono tabular-nums truncate">
                                          {regRow.nativeSymbol}
                                          {regRow.nativeEffectivePrice.toLocaleString(
                                            'es-MX'
                                          )}{' '}
                                          {regRow.nativeCurrency}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  }
                )
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
