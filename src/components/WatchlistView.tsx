import React, { useMemo, useState } from 'react';
import { Bell, CheckCircle2, ExternalLink, Trash2 } from 'lucide-react';
import {
  ProductType,
  TriggeredAlert,
  WatchlistItem,
  WatchlistSortOption,
  XboxProduct,
  XboxRegion,
} from '../types/xbox';
import {
  buildXboxStoreDeepLink,
  convertCurrency,
  evaluateWatchlistAlerts,
  getEffectiveRegionalPrice,
  sortWatchlistItems,
} from '../utils/pricingEngine';
import { CURRENCY_METADATA } from '../data/xboxCatalogData';
import { checkWatchlistPriceAlerts } from '../utils/clientXboxService';

interface WatchlistViewProps {
  watchlist: WatchlistItem[];
  products: XboxProduct[];
  regions: XboxRegion[];
  activeRegionCode: string;
  targetCurrency: string;
  ratesPerUsd: Record<string, number>;
  onUpdateItem: (item: WatchlistItem) => void;
  onRemoveItem: (bigId: string) => void;
  onSelectProduct: (product: XboxProduct) => void;
}

const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  Game: 'Juego',
  Bundle: 'Edición / Lote',
  'Add-on': 'Complemento',
};

export const WatchlistView: React.FC<WatchlistViewProps> = ({
  watchlist,
  products,
  regions,
  activeRegionCode,
  targetCurrency,
  ratesPerUsd,
  onUpdateItem,
  onRemoveItem,
  onSelectProduct,
}) => {
  const [sortBy, setSortBy] = useState<WatchlistSortOption>('on_sale_now');
  const [notifyWeeklyWaves, setNotifyWeeklyWaves] = useState<boolean>(true);
  const [alertCheckBanner, setAlertCheckBanner] = useState<string | null>(null);
  const [checkingPrices, setCheckingPrices] = useState<boolean>(false);

  const productsMap = useMemo(() => {
    const map: Record<string, XboxProduct> = {};
    for (const p of products) map[p.bigId] = p;
    return map;
  }, [products]);

  const sortedWatchlist = useMemo(
    () =>
      sortWatchlistItems(
        watchlist,
        productsMap,
        sortBy,
        activeRegionCode,
        targetCurrency,
        ratesPerUsd
      ),
    [
      watchlist,
      productsMap,
      sortBy,
      activeRegionCode,
      targetCurrency,
      ratesPerUsd,
    ]
  );

  const triggeredAlerts: TriggeredAlert[] = useMemo(
    () =>
      evaluateWatchlistAlerts(
        watchlist,
        productsMap,
        targetCurrency,
        ratesPerUsd,
        '2026-11-04T22:00:00Z'
      ),
    [watchlist, productsMap, targetCurrency, ratesPerUsd]
  );

  const currencySymbol =
    CURRENCY_METADATA[targetCurrency]?.symbol || `${targetCurrency} `;

  const formatCountdown = (endDate: string | null) => {
    if (!endDate) return 'Precio regular';
    const diffMs =
      new Date(endDate).getTime() -
      new Date('2026-11-04T22:00:00Z').getTime();
    if (diffMs <= 0) return 'Oferta terminada';
    const days = Math.floor(diffMs / (1000 * 3600 * 24));
    const hours = Math.floor((diffMs % (1000 * 3600 * 24)) / (1000 * 3600));
    return `Termina en ${days}d ${hours}h`;
  };

  const handleCheckAlertsNow = async () => {
    setCheckingPrices(true);
    try {
      await checkWatchlistPriceAlerts(
        products,
        watchlist,
        activeRegionCode,
        targetCurrency
      );
      const sample = triggeredAlerts[0];
      if (sample) {
        setAlertCheckBanner(
          `¡Buena noticia! "${sample.productTitle}" bajó a ${currencySymbol}${sample.currentPriceConverted.toLocaleString('es-MX')} (-${sample.discountPct}%) en la tienda ${sample.regionCode}.`
        );
      } else {
        setAlertCheckBanner(
          'Precios verificados. Te avisaremos en cuanto alguno de tus juegos baje al precio que elegiste.'
        );
      }
    } catch {
      setAlertCheckBanner(
        'No se pudieron verificar los precios en este momento.'
      );
    } finally {
      setCheckingPrices(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-2xl font-bold text-white">
            Mi Lista de Seguimiento
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Guarda los juegos que quieres comprar y elige cuánto quieres pagar
            en {targetCurrency}.
          </p>
        </div>
      </div>

      {/* Price Alerts Bar */}
      <div className="p-5 rounded-xl bg-[#111722] border border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Bell className="w-4 h-4 text-[#22C55E]" />
              <span>
                Avisos de rebaja ({triggeredAlerts.length} en tu precio ideal
                hoy)
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Revisa al instante si alguno de tus juegos guardados ya bajó del
              precio que definiste.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label
              htmlFor="weekly-wave-toggle"
              className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer"
            >
              <input
                id="weekly-wave-toggle"
                type="checkbox"
                checked={notifyWeeklyWaves}
                onChange={(e) => setNotifyWeeklyWaves(e.target.checked)}
                className="w-4 h-4 accent-[#107C10] rounded"
              />
              <span>Avisar nuevas ofertas de cada martes</span>
            </label>

            <button
              type="button"
              disabled={checkingPrices}
              onClick={handleCheckAlertsNow}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#107C10] hover:bg-[#159415] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {checkingPrices ? 'Revisando...' : 'Comprobar precios ahora'}
            </button>
          </div>
        </div>

        {alertCheckBanner && (
          <div className="p-3.5 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{alertCheckBanner}</span>
          </div>
        )}
      </div>

      {/* Watchlist Sorting & Items Table */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm font-semibold text-slate-200">
            Juegos guardados ({sortedWatchlist.length})
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="watchlist-sort-select"
              className="text-xs text-slate-400"
            >
              Ordenar por:
            </label>
            <select
              id="watchlist-sort-select"
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as WatchlistSortOption)
              }
              className="px-3 py-1.5 text-xs bg-[#111722] border border-slate-800 rounded-lg text-slate-200"
            >
              <option value="on_sale_now">En oferta ahora</option>
              <option value="discount_desc">Mayor descuento</option>
              <option value="price_asc">Menor precio</option>
              <option value="expiring_soon">Terminan pronto</option>
              <option value="added_desc">Agregados recientemente</option>
            </select>
          </div>
        </div>

        {sortedWatchlist.length === 0 ? (
          <div className="p-12 text-center rounded-xl bg-[#111722] border border-slate-800 space-y-3">
            <div className="text-base font-semibold text-slate-200">
              Aún no tienes juegos guardados
            </div>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Pulsa "Guardar" en cualquier juego de la tienda para seguir su
              precio y recibir aviso cuando esté en oferta.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {sortedWatchlist.map((item) => {
              const product = productsMap[item.bigId];
              if (!product) return null;

              const regObj =
                regions.find((r) => r.code === item.preferredRegion) ||
                regions[0];
              const rPrice =
                product.pricesByRegion[item.preferredRegion] ||
                product.pricesByRegion[activeRegionCode] ||
                product.pricesByRegion['US'];
              const effNative = getEffectiveRegionalPrice(rPrice);
              const effConverted = convertCurrency(
                effNative,
                rPrice.currency,
                targetCurrency,
                ratesPerUsd
              );

              const targetReached =
                item.targetPrice !== null &&
                item.targetPrice > 0 &&
                effConverted <= item.targetPrice;

              return (
                <div
                  key={item.bigId}
                  className="p-4 rounded-xl bg-[#111722] border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-4 min-w-0">
                    <img
                      src={product.coverImage}
                      alt={product.title}
                      referrerPolicy="no-referrer"
                      className="w-14 h-20 object-cover rounded-lg border border-slate-800 shrink-0 cursor-pointer"
                      onClick={() => onSelectProduct(product)}
                    />
                    <div className="min-w-0">
                      <div className="text-xs text-slate-400">
                        <span>{PRODUCT_TYPE_LABELS[product.productType]}</span>
                        <span aria-hidden="true"> · </span>
                        <span>Tienda {regObj.name}</span>
                        <span aria-hidden="true"> · </span>
                        <span className="text-amber-400">
                          {formatCountdown(rPrice.endDate)}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => onSelectProduct(product)}
                        className="text-base font-bold text-white hover:text-emerald-400 transition-colors text-left truncate block mt-0.5"
                      >
                        {product.title}
                      </button>

                      <div className="text-xs text-slate-400 mt-1 font-mono tabular-nums">
                        <span>
                          Hoy: {regObj.symbol}
                          {effNative.toLocaleString('es-MX')} (-
                          {rPrice.discountPct}%)
                        </span>
                        <span aria-hidden="true"> · </span>
                        <span className="text-slate-200 font-semibold">
                          En {targetCurrency}: {currencySymbol}
                          {effConverted.toLocaleString('es-MX')}
                        </span>
                        {targetReached && (
                          <span className="ml-2 text-emerald-400 font-semibold">
                            · ¡Llegó a tu precio!
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Controls: Target Price Input, Region Picker & Deep Link */}
                  <div className="flex flex-wrap items-center gap-3 shrink-0 pt-3 lg:pt-0 border-t lg:border-t-0 border-slate-800">
                    <div>
                      <label
                        htmlFor={`wl-region-${item.bigId}`}
                        className="block text-[11px] text-slate-400 mb-1"
                      >
                        País
                      </label>
                      <select
                        id={`wl-region-${item.bigId}`}
                        value={item.preferredRegion}
                        onChange={(e) =>
                          onUpdateItem({
                            ...item,
                            preferredRegion: e.target.value,
                          })
                        }
                        className="px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-slate-200"
                      >
                        {regions.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.name} ({r.currency})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor={`wl-target-${item.bigId}`}
                        className="block text-[11px] text-slate-400 mb-1"
                      >
                        Precio meta ({targetCurrency})
                      </label>
                      <input
                        id={`wl-target-${item.bigId}`}
                        type="number"
                        step="1"
                        min="0"
                        max="1000000"
                        value={item.targetPrice ?? ''}
                        placeholder="Cualquier baja"
                        onChange={(e) => {
                          const val = e.target.value;
                          const num = Number(val);
                          if (val !== '' && (!Number.isFinite(num) || num < 0 || num > 1000000)) {
                            return;
                          }
                          onUpdateItem({
                            ...item,
                            targetPrice: val === '' ? null : num,
                            targetCurrency,
                          });
                        }}
                        className="w-28 px-2.5 py-1.5 text-xs font-mono tabular-nums bg-[#0B0F17] border border-slate-800 rounded-lg text-white"
                      />
                    </div>

                    <div className="flex items-center gap-2 pt-4">
                      <a
                        href={buildXboxStoreDeepLink(
                          regObj.locale,
                          product.slug,
                          product.bigId
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-[#107C10] hover:bg-[#159415] rounded-lg inline-flex items-center gap-1 whitespace-nowrap"
                      >
                        <span>Ver en Xbox ({regObj.code})</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>

                      <button
                        type="button"
                        onClick={() => onRemoveItem(item.bigId)}
                        aria-label={`Quitar ${product.title}`}
                        className="p-2 text-slate-400 hover:text-rose-400 bg-[#0B0F17] border border-slate-800 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
