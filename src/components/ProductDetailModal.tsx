import React, { useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  Check,
  ExternalLink,
  Globe,
  RefreshCw,
  Share2,
  X,
} from 'lucide-react';
import {
  ProductType,
  WatchlistItem,
  XboxProduct,
  XboxRegion,
} from '../types/xbox';
import {
  buildRegionalComparison,
  buildXboxStoreDeepLink,
  calculatePriceAnalytics,
  convertCurrency,
  getEffectiveRegionalPrice,
} from '../utils/pricingEngine';
import { CURRENCY_METADATA } from '../data/xboxCatalogData';
import { hydrateProductMultiRegion } from '../utils/clientXboxService';
import { StepPriceChart } from './StepPriceChart';

interface ProductDetailModalProps {
  product: XboxProduct;
  allProducts: XboxProduct[];
  regions: XboxRegion[];
  activeRegionCode: string;
  targetCurrency: string;
  ratesPerUsd: Record<string, number>;
  watchlistItem?: WatchlistItem;
  onClose: () => void;
  onSelectProduct: (product: XboxProduct) => void;
  onSaveWatchlist: (item: WatchlistItem) => void;
  onRemoveWatchlist: (bigId: string) => void;
  onProductHydrated?: (hydrated: XboxProduct) => void;
}

const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  Game: 'Juego',
  Bundle: 'Edición / Lote',
  'Add-on': 'Complemento',
};

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  product: initialProduct,
  allProducts,
  regions,
  activeRegionCode,
  targetCurrency,
  ratesPerUsd,
  watchlistItem,
  onClose,
  onSelectProduct,
  onSaveWatchlist,
  onRemoveWatchlist,
  onProductHydrated,
}) => {
  const [liveProduct, setLiveProduct] = useState<XboxProduct>(initialProduct);
  const [isHydratingRegions, setIsHydratingRegions] = useState<boolean>(false);
  const [selectedChartRegion, setSelectedChartRegion] =
    useState<string>(activeRegionCode);
  const [targetPriceInput, setTargetPriceInput] = useState<string>(
    watchlistItem?.targetPrice ? String(watchlistItem.targetPrice) : ''
  );
  const [notifyAnyDrop, setNotifyAnyDrop] = useState<boolean>(
    watchlistItem ? watchlistItem.notifyOnAnyDrop : true
  );
  const [copiedShare, setCopiedShare] = useState(false);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setLiveProduct(initialProduct);
    setImgError(false);
    let cancelled = false;
    setIsHydratingRegions(true);

    hydrateProductMultiRegion(initialProduct, activeRegionCode, targetCurrency)
      .then((hydrated) => {
        if (cancelled || !hydrated) return;
        setLiveProduct(hydrated);
        if (onProductHydrated) {
          onProductHydrated(hydrated);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsHydratingRegions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [initialProduct.bigId, activeRegionCode, targetCurrency]);

  const product = liveProduct;

  const activeRegionObj =
    regions.find((r) => r.code === selectedChartRegion) || regions[0];

  const rPrice =
    product.pricesByRegion[selectedChartRegion] ||
    product.pricesByRegion[activeRegionCode] ||
    product.pricesByRegion['MX'] ||
    product.pricesByRegion['US'];
  const history =
    product.historyByRegion[selectedChartRegion] ||
    product.historyByRegion[activeRegionCode] ||
    product.historyByRegion['MX'] ||
    product.historyByRegion['US'] ||
    [];

  const analytics = useMemo(
    () => calculatePriceAnalytics(history, rPrice),
    [history, rPrice]
  );

  const comparisonRows = useMemo(
    () =>
      buildRegionalComparison(
        product,
        regions,
        activeRegionCode,
        targetCurrency,
        ratesPerUsd
      ),
    [product, regions, activeRegionCode, targetCurrency, ratesPerUsd]
  );

  const cheapestRow = comparisonRows[0];
  const targetCurrencySymbol =
    CURRENCY_METADATA[targetCurrency]?.symbol || `${targetCurrency} `;

  const convertedCurrentPrice = convertCurrency(
    analytics.currentEffectivePrice,
    rPrice.currency,
    targetCurrency,
    ratesPerUsd
  );

  const relatedEditions = useMemo(
    () =>
      allProducts.filter(
        (p) =>
          p.bigId !== product.bigId &&
          (p.parentBigId === product.bigId ||
            (product.parentBigId &&
              (p.bigId === product.parentBigId ||
                p.parentBigId === product.parentBigId)))
      ),
    [allProducts, product]
  );

  const daysRemaining = useMemo(() => {
    if (!rPrice.endDate) return null;
    const diffMs =
      new Date(rPrice.endDate).getTime() -
      new Date('2026-11-04T22:00:00Z').getTime();
    if (diffMs <= 0) return 'Finalizada';
    const days = Math.floor(diffMs / (1000 * 3600 * 24));
    const hours = Math.floor((diffMs % (1000 * 3600 * 24)) / (1000 * 3600));
    return days > 0 ? `Termina en ${days}d ${hours}h` : `Termina en ${hours}h`;
  }, [rPrice.endDate]);

  const handleShareDeal = () => {
    const shareText = [
      `${product.title} en oferta para Xbox`,
      `Precio en ${activeRegionObj.name}: ${activeRegionObj.symbol}${analytics.currentEffectivePrice.toLocaleString('es-MX')} (-${analytics.discountPct}%)`,
      cheapestRow
        ? `Más barato en ${cheapestRow.regionName}: ${cheapestRow.nativeSymbol}${cheapestRow.nativeEffectivePrice.toLocaleString('es-MX')} (aprox. ${targetCurrencySymbol}${cheapestRow.convertedPrice.toLocaleString('es-MX')})`
        : '',
      buildXboxStoreDeepLink(
        activeRegionObj.locale,
        product.slug,
        product.bigId
      ),
    ]
      .filter(Boolean)
      .join('\n');

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareText).catch(() => {});
    }
    setCopiedShare(true);
    setTimeout(() => setCopiedShare(false), 2500);
  };

  const handleSaveToWatchlist = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedTarget =
      targetPriceInput.trim() !== '' && !Number.isNaN(Number(targetPriceInput))
        ? Number(targetPriceInput)
        : null;

    onSaveWatchlist({
      bigId: product.bigId,
      addedAt: watchlistItem?.addedAt || new Date().toISOString(),
      targetPrice: parsedTarget,
      targetCurrency,
      notifyOnAnyDrop: notifyAnyDrop,
      preferredRegion: selectedChartRegion,
    });
  };

  const directStoreUrl = buildXboxStoreDeepLink(
    activeRegionObj.locale,
    product.slug,
    product.bigId
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-product-title"
    >
      <div className="relative w-full max-w-5xl bg-[#0F1520] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8 max-h-[90vh] flex flex-col">
        {/* Top Modal Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-slate-800 bg-[#0B0F17]">
          <div className="min-w-0">
            <div className="text-xs text-slate-400 truncate">
              <span>{PRODUCT_TYPE_LABELS[product.productType]}</span>
              <span aria-hidden="true"> · </span>
              <span>{product.platforms.join(' / ')}</span>
            </div>
            <h2
              id="modal-product-title"
              className="text-xl font-bold text-white truncate mt-0.5"
            >
              {product.title}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleShareDeal}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-slate-800/90 hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {copiedShare ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Enlace copiado</span>
                </>
              ) : (
                <>
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Compartir</span>
                </>
              )}
            </button>

            <a
              href={directStoreUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#107C10] hover:bg-[#159415] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <span>Ver en Xbox ({activeRegionObj.code})</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>

            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="p-2 text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Modal Body */}
        <div className="p-6 overflow-y-auto space-y-8">
          {/* Section 1: Overview, Cover, Pricing Analytics & Watchlist Configuration */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Cover Art */}
            <div className="lg:col-span-4">
              <div className="aspect-[3/4] w-full rounded-xl overflow-hidden bg-slate-900 border border-slate-800 relative">
                {!imgError ? (
                  <img
                    src={product.coverImage}
                    alt={product.title}
                    referrerPolicy="no-referrer"
                    onError={() => setImgError(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-br from-slate-900 to-slate-800">
                    <span className="text-sm font-semibold text-slate-200">
                      {product.title}
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-4 text-xs text-slate-400 space-y-1.5">
                <div>
                  <span className="text-slate-500">Estudio:</span>{' '}
                  <span className="text-slate-200">{product.developer}</span>
                </div>
                <div>
                  <span className="text-slate-500">Editor:</span>{' '}
                  <span className="text-slate-200">{product.publisher}</span>
                </div>
                <div>
                  <span className="text-slate-500">Lanzamiento:</span>{' '}
                  <span className="text-slate-200 font-mono tabular-nums">
                    {product.releaseDate}
                  </span>
                </div>
              </div>
            </div>

            {/* Right Column: Analytics, Recommendation, Watchlist Form & Description */}
            <div className="lg:col-span-8 space-y-5">
              <p className="text-sm text-slate-300 leading-relaxed">
                {product.description}
              </p>

              {/* Price & Historical Analytics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-800/80">
                <div className="p-3.5 rounded-xl bg-[#111722] border border-slate-800">
                  <div className="text-xs text-slate-400">
                    Precio en {activeRegionObj.name}
                  </div>
                  <div className="text-lg font-bold text-white font-mono tabular-nums mt-1">
                    {activeRegionObj.symbol}
                    {analytics.currentEffectivePrice.toLocaleString('es-MX')}
                  </div>
                  <div className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                    Antes: {activeRegionObj.symbol}
                    {analytics.listPrice.toLocaleString('es-MX')} (-
                    {analytics.discountPct}%)
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-[#111722] border border-slate-800">
                  <div className="text-xs text-slate-400">
                    Mínimo histórico
                  </div>
                  <div className="text-lg font-bold text-sky-400 font-mono tabular-nums mt-1">
                    {activeRegionObj.symbol}
                    {analytics.lowestPriceEver.toLocaleString('es-MX')}
                  </div>
                  <div className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                    {analytics.lowestPriceDate}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-[#111722] border border-slate-800">
                  <div className="text-xs text-slate-400">
                    Promedio en oferta
                  </div>
                  <div className="text-lg font-bold text-slate-200 font-mono tabular-nums mt-1">
                    {activeRegionObj.symbol}
                    {analytics.averageSalePrice.toLocaleString('es-MX')}
                  </div>
                  <div className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                    {daysRemaining || 'Precio activo'}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-[#111722] border border-slate-800">
                  <div className="text-xs text-slate-400">Recomendación</div>
                  <div
                    className={`text-sm font-bold mt-1.5 ${
                      analytics.verdict === 'Mínimo histórico'
                        ? 'text-emerald-400'
                        : analytics.verdict === 'Buena oferta'
                          ? 'text-sky-400'
                          : 'text-amber-400'
                    }`}
                  >
                    {analytics.verdict}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {rPrice.includedInGamePass
                      ? 'Incluido en Game Pass'
                      : rPrice.gamePassPrice !== null
                        ? 'Con descuento Game Pass'
                        : 'Oferta para todos'}
                  </div>
                </div>
              </div>

              {/* Watchlist & Target Price Alert Setup Box */}
              <form
                onSubmit={handleSaveToWatchlist}
                className="p-4 rounded-xl bg-[#111722] border border-slate-800 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-white">
                    Avísame cuando baje de precio
                  </div>
                  {watchlistItem && (
                    <span className="text-xs text-emerald-400 font-medium">
                      Guardado en Mi Lista ({watchlistItem.preferredRegion})
                    </span>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                  <div className="flex-1 min-w-[180px]">
                    <label
                      htmlFor="target-price-input"
                      className="block text-xs text-slate-400 mb-1"
                    >
                      Avisar si baja de ({targetCurrency} · hoy:{' '}
                      {targetCurrencySymbol}
                      {convertedCurrentPrice.toLocaleString('es-MX')})
                    </label>
                    <input
                      id="target-price-input"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder={`Ej. ${Math.max(10, Math.round(convertedCurrentPrice * 0.85))}`}
                      value={targetPriceInput}
                      onChange={(e) => setTargetPriceInput(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-slate-700 rounded-lg text-white font-mono tabular-nums focus:outline-none focus:border-[#107C10]"
                    />
                  </div>

                  <div className="flex items-center gap-2 pb-2 shrink-0">
                    <input
                      id="notify-any-drop"
                      type="checkbox"
                      checked={notifyAnyDrop}
                      onChange={(e) => setNotifyAnyDrop(e.target.checked)}
                      className="w-4 h-4 accent-[#107C10] rounded"
                    />
                    <label
                      htmlFor="notify-any-drop"
                      className="text-xs text-slate-300 cursor-pointer whitespace-nowrap"
                    >
                      Avisar en cualquier rebaja
                    </label>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {watchlistItem && (
                      <button
                        type="button"
                        onClick={() => onRemoveWatchlist(product.bigId)}
                        className="px-3 py-2 text-xs font-medium text-rose-300 hover:text-white bg-rose-950/60 hover:bg-rose-900 rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        Quitar
                      </button>
                    )}
                    <button
                      type="submit"
                      className="flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#107C10] hover:bg-[#159415] rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <Bookmark className="w-3.5 h-3.5" />
                      <span>
                        {watchlistItem ? 'Actualizar' : 'Guardar en Mi Lista'}
                      </span>
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>

          {/* Section 2: Interactive Stepped Price History Chart */}
          <StepPriceChart
            history={history}
            currentListPrice={rPrice.listPrice}
            currentEffectivePrice={analytics.currentEffectivePrice}
            lowestPriceEver={analytics.lowestPriceEver}
            currencySymbol={activeRegionObj.symbol}
            currencyCode={rPrice.currency}
          />

          {/* Section 3: Multi-Region Price Comparison Table */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Globe className="w-4 h-4 text-[#22C55E]" />
                  <span>Precio por país (convertido a {targetCurrency})</span>
                  {isHydratingRegions && (
                    <span className="inline-flex items-center gap-1 text-xs font-normal text-emerald-400">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Actualizando precios...</span>
                    </span>
                  )}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Ordenado del país más barato al más caro. Toca cualquier fila
                  para ver su historial de precios arriba.
                </p>
              </div>
              {cheapestRow && (
                <div className="text-xs text-slate-300 font-mono tabular-nums">
                  Más barato hoy:{' '}
                  <span className="text-emerald-400 font-semibold">
                    {cheapestRow.regionName} ({targetCurrencySymbol}
                    {cheapestRow.convertedPrice.toLocaleString('es-MX')})
                  </span>
                </div>
              )}
            </div>

            <div className="border border-slate-800 rounded-xl overflow-hidden bg-[#111722]">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-[#0B0F17] text-[11px] font-semibold text-slate-400">
                      <th className="py-2.5 px-4">#</th>
                      <th className="py-2.5 px-4">País</th>
                      <th className="py-2.5 px-4 text-right">
                        Precio en su moneda
                      </th>
                      <th className="py-2.5 px-4 text-right">Descuento</th>
                      <th className="py-2.5 px-4 text-right">
                        En {targetCurrency}
                      </th>
                      <th className="py-2.5 px-4 text-right">Diferencia</th>
                      <th className="py-2.5 px-4 text-right">Tienda</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 text-xs">
                    {comparisonRows.map((row, idx) => (
                      <tr
                        key={row.regionCode}
                        onClick={() => setSelectedChartRegion(row.regionCode)}
                        className={`cursor-pointer transition-colors ${
                          selectedChartRegion === row.regionCode
                            ? 'bg-emerald-950/30'
                            : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-2.5 px-4 font-mono tabular-nums text-slate-400">
                          {idx + 1}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-medium text-slate-100">
                            {row.regionName}
                            {row.isCheapest && (
                              <span className="ml-2 text-emerald-400 font-semibold">
                                · Más barato
                              </span>
                            )}
                            {row.isUserLocal && (
                              <span className="ml-2 text-sky-400 font-medium">
                                · Tu tienda
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-200">
                          {row.nativeSymbol}
                          {row.nativeEffectivePrice.toLocaleString('es-MX')}{' '}
                          <span className="text-slate-500">
                            {row.nativeCurrency}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-emerald-400 font-semibold">
                          -{row.discountPct}%
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-white">
                          {targetCurrencySymbol}
                          {row.convertedPrice.toLocaleString('es-MX')}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {row.savingsPctVsLocal > 0 ? (
                            <span className="text-emerald-400 font-semibold">
                              Ahorras {row.savingsPctVsLocal}%
                            </span>
                          ) : row.savingsPctVsLocal === 0 ? (
                            <span className="text-slate-400">Tu tienda</span>
                          ) : (
                            <span className="text-rose-400">
                              +{Math.abs(row.savingsPctVsLocal)}% más caro
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <a
                            href={row.storeDeepLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-medium whitespace-nowrap"
                          >
                            <span>Abrir tienda ({row.regionCode})</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Section 4: Related DLCs & Special Editions */}
          {relatedEditions.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-slate-800">
              <h3 className="text-sm font-bold text-white">
                Ediciones y complementos relacionados
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {relatedEditions.map((rel) => {
                  const relPrice =
                    rel.pricesByRegion[activeRegionCode] ||
                    rel.pricesByRegion['US'];
                  const eff = getEffectiveRegionalPrice(relPrice);
                  return (
                    <button
                      key={rel.bigId}
                      type="button"
                      onClick={() => onSelectProduct(rel)}
                      className="flex items-center justify-between gap-4 p-3.5 rounded-xl bg-[#111722] border border-slate-800 hover:border-slate-600 text-left transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-xs text-slate-400">
                          {PRODUCT_TYPE_LABELS[rel.productType]} · -
                          {relPrice.discountPct}%
                        </div>
                        <div className="text-sm font-semibold text-white truncate mt-0.5">
                          {rel.title}
                        </div>
                      </div>
                      <div className="text-right font-mono tabular-nums shrink-0">
                        <div className="text-sm font-bold text-emerald-400">
                          {relPrice.currency} {eff.toLocaleString('es-MX')}
                        </div>
                        <div className="text-[11px] text-slate-500 line-through">
                          {relPrice.listPrice.toLocaleString('es-MX')}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
