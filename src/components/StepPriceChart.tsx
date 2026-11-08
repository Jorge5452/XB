import React, { useMemo, useState } from 'react';
import { PriceHistoryPoint } from '../types/xbox';

export type TimeframeRange = '3M' | '6M' | '1Y' | 'ALL';

interface StepPriceChartProps {
  history: PriceHistoryPoint[];
  currentListPrice: number;
  currentEffectivePrice: number;
  lowestPriceEver: number;
  currencySymbol: string;
  currencyCode: string;
}

export const StepPriceChart: React.FC<StepPriceChartProps> = ({
  history,
  currentListPrice,
  currentEffectivePrice,
  lowestPriceEver,
  currencySymbol,
  currencyCode,
}) => {
  const [timeframe, setTimeframe] = useState<TimeframeRange>('ALL');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const filteredPoints = useMemo(() => {
    const basePoints =
      history.length > 0
        ? [...history]
        : [
            {
              date: '2026-05-01',
              regularPrice: currentListPrice,
              salePrice: currentListPrice,
            },
          ];

    // Append current live price point
    const withCurrent: PriceHistoryPoint[] = [
      ...basePoints,
      {
        date: '2026-11-04',
        regularPrice: currentListPrice,
        salePrice: currentEffectivePrice,
        eventLabel: 'Precio Actual',
      },
    ];

    const refDate = new Date('2026-11-04T00:00:00Z');
    let cutoffDate = new Date('2020-01-01T00:00:00Z');
    if (timeframe === '3M') {
      cutoffDate = new Date(refDate.getTime() - 92 * 24 * 3600 * 1000);
    } else if (timeframe === '6M') {
      cutoffDate = new Date(refDate.getTime() - 185 * 24 * 3600 * 1000);
    } else if (timeframe === '1Y') {
      cutoffDate = new Date(refDate.getTime() - 365 * 24 * 3600 * 1000);
    }

    const subset = withCurrent.filter((pt) => new Date(pt.date) >= cutoffDate);
    return subset.length >= 2 ? subset : withCurrent.slice(-2);
  }, [history, currentListPrice, currentEffectivePrice, timeframe]);

  const width = 680;
  const height = 230;
  const padLeft = 58;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 34;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxPrice = useMemo(() => {
    const m = Math.max(
      currentListPrice,
      ...filteredPoints.map((p) => Math.max(p.regularPrice, p.salePrice))
    );
    return m > 0 ? m * 1.1 : 100;
  }, [filteredPoints, currentListPrice]);

  const toX = (index: number) => {
    if (filteredPoints.length <= 1) return padLeft;
    return padLeft + (index / (filteredPoints.length - 1)) * plotW;
  };

  const toY = (val: number) => {
    const clamped = Math.max(0, Math.min(maxPrice, val));
    return padTop + plotH - (clamped / maxPrice) * plotH;
  };

  // Build stepped SVG path for sale price & regular price
  const { saleStepPath, saleAreaPath, regularStepPath } = useMemo(() => {
    if (filteredPoints.length === 0) {
      return { saleStepPath: '', saleAreaPath: '', regularStepPath: '' };
    }

    let sPath = '';
    let rPath = '';

    filteredPoints.forEach((pt, i) => {
      const x = toX(i);
      const ySale = toY(pt.salePrice);
      const yReg = toY(pt.regularPrice);

      if (i === 0) {
        sPath += `M ${x} ${ySale}`;
        rPath += `M ${x} ${yReg}`;
      } else {
        const prevY = toY(filteredPoints[i - 1].salePrice);
        const prevRegY = toY(filteredPoints[i - 1].regularPrice);
        // Step horizontal first, then vertical drop/rise
        sPath += ` L ${x} ${prevY} L ${x} ${ySale}`;
        rPath += ` L ${x} ${prevRegY} L ${x} ${yReg}`;
      }
    });

    const lastX = toX(filteredPoints.length - 1);
    const firstX = toX(0);
    const bottomY = padTop + plotH;
    const area = `${sPath} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;

    return {
      saleStepPath: sPath,
      saleAreaPath: area,
      regularStepPath: rPath,
    };
  }, [filteredPoints, maxPrice]);

  const activePoint =
    hoveredIdx !== null && filteredPoints[hoveredIdx]
      ? filteredPoints[hoveredIdx]
      : filteredPoints[filteredPoints.length - 1];

  const lowestY = toY(lowestPriceEver);

  return (
    <div className="border border-slate-800 bg-[#111722] rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <h4 className="text-sm font-semibold text-slate-100">
            Historial de precios ({currencyCode})
          </h4>
          <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
            {activePoint.date} · Regular: {currencySymbol}
            {activePoint.regularPrice.toLocaleString('es-MX')} · Oferta:{' '}
            <span className="text-[#22C55E] font-semibold">
              {currencySymbol}
              {activePoint.salePrice.toLocaleString('es-MX')}
            </span>
            {activePoint.eventLabel ? ` · ${activePoint.eventLabel}` : ''}
          </p>
        </div>

        <div
          className="flex items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-lg"
          role="group"
          aria-label="Rango de tiempo del historial"
        >
          {(
            [
              { id: '3M', label: '3 meses' },
              { id: '6M', label: '6 meses' },
              { id: '1Y', label: '1 año' },
              { id: 'ALL', label: 'Todo' },
            ] as const
          ).map((tf) => (
            <button
              key={tf.id}
              type="button"
              onClick={() => setTimeframe(tf.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                timeframe === tf.id
                  ? 'bg-[#107C10] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto select-none"
          role="img"
          aria-label="Gráfico escalonado de historial de precios"
        >
          <defs>
            <linearGradient id="xboxSaleArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22C55E" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#22C55E" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Horizontal Y-axis grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const val = maxPrice * ratio;
            const y = toY(val);
            return (
              <g key={ratio}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="#1E293B"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <text
                  x={padLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-slate-500 text-[10px] font-mono"
                >
                  {currencySymbol}
                  {Math.round(val).toLocaleString('es-MX')}
                </text>
              </g>
            );
          })}

          {/* Historical Low Reference Line */}
          <line
            x1={padLeft}
            y1={lowestY}
            x2={width - padRight}
            y2={lowestY}
            stroke="#38BDF8"
            strokeDasharray="4 4"
            strokeWidth="1.2"
          />
          <text
            x={width - padRight - 4}
            y={Math.max(12, lowestY - 5)}
            textAnchor="end"
            className="fill-sky-400 text-[10px] font-mono"
          >
            Mínimo: {currencySymbol}
            {lowestPriceEver.toLocaleString('es-MX')}
          </text>

          {/* Regular List Price Step Line */}
          <path
            d={regularStepPath}
            fill="none"
            stroke="#64748B"
            strokeWidth="1.5"
            strokeDasharray="5 3"
          />

          {/* Sale Price Area & Step Line */}
          <path d={saleAreaPath} fill="url(#xboxSaleArea)" />
          <path
            d={saleStepPath}
            fill="none"
            stroke="#22C55E"
            strokeWidth="2.5"
          />

          {/* Interactive Data Points */}
          {filteredPoints.map((pt, i) => {
            const x = toX(i);
            const y = toY(pt.salePrice);
            const isHovered = hoveredIdx === i;
            return (
              <g
                key={`${pt.date}-${i}`}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
                className="cursor-pointer"
              >
                <circle
                  cx={x}
                  cy={y}
                  r={isHovered ? 6 : 4}
                  fill={pt.salePrice <= lowestPriceEver * 1.01 ? '#38BDF8' : '#22C55E'}
                  stroke="#0B0F17"
                  strokeWidth="2"
                />
                <text
                  x={x}
                  y={height - 10}
                  textAnchor="middle"
                  className="fill-slate-400 text-[10px] font-mono"
                >
                  {pt.date.slice(2, 7)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 mt-3 pt-3 border-t border-slate-800/80 text-xs text-slate-400">
        <div className="flex items-center gap-4">
          <span>Línea continua verde: Precio de Oferta</span>
          <span aria-hidden="true">·</span>
          <span>Línea punteada gris: Precio Base (MSRP)</span>
          <span aria-hidden="true">·</span>
          <span className="text-sky-400">Línea azul: Mínimo Histórico</span>
        </div>
      </div>
    </div>
  );
};
