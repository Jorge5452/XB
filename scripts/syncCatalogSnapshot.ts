import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  EXCHANGE_RATES_PER_USD,
  INITIAL_XBOX_PRODUCTS,
  XBOX_REGIONS,
} from '../src/data/xboxCatalogData';
import {
  batchHydrateProductsFromDisplayCatalog,
  convertEmeraldSummaryToXboxProduct,
} from '../src/utils/msCatalogScraper';
import { XboxProduct } from '../src/types/xbox';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EMERALD_HEADERS = {
  'Content-Type': 'application/json',
  'X-MS-API-Version': '1.1',
  'MS-CV': 'DGU1mcuYo0WMMp+F.1',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
};

async function refreshLiveExchangeRates(): Promise<void> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (res.ok) {
      const data = (await res.json()) as { rates?: Record<string, number> };
      if (data?.rates) {
        for (const code of Object.keys(EXCHANGE_RATES_PER_USD)) {
          const liveVal = data.rates[code];
          if (typeof liveVal === 'number' && liveVal > 0) {
            EXCHANGE_RATES_PER_USD[code] = Number(liveVal.toFixed(4));
          }
        }
      }
    }
  } catch {
    // Keep accurate fallback rates
  }
}

async function fetchDealsForRegion(
  regionCode: string,
  maxPages = 3
): Promise<XboxProduct[]> {
  const regionMeta =
    XBOX_REGIONS.find((r) => r.code === regionCode) || XBOX_REGIONS[0];
  let encodedCT: string | undefined = undefined;
  const collected: XboxProduct[] = [];

  for (let page = 0; page < maxPages; page++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      const bodyPayload: Record<string, unknown> = {
        Filters: 'e30=',
        ReturnFilters: false,
        ChannelKeyToBeUsedInResponse: 'DEALS',
        ChannelId: 'DYNAMICCHANNEL.GAMEDEALS',
      };
      if (encodedCT) {
        bodyPayload.EncodedCT = encodedCT;
      }

      const response = await fetch(
        `https://emerald.xboxservices.com/xboxcomfd/browse?locale=${encodeURIComponent(
          regionMeta.locale
        )}`,
        {
          method: 'POST',
          headers: EMERALD_HEADERS,
          body: JSON.stringify(bodyPayload),
          signal: controller.signal,
        }
      );
      clearTimeout(timeout);
      if (!response.ok) break;

      const data = (await response.json()) as Record<string, unknown>;
      const channels = (data.channels as Record<string, unknown>) || {};
      const dealsChannel = (channels.DEALS as Record<string, unknown>) || {};
      encodedCT =
        typeof dealsChannel.encodedCT === 'string' && dealsChannel.encodedCT
          ? dealsChannel.encodedCT
          : undefined;

      const summaries = Array.isArray(data.productSummaries)
        ? (data.productSummaries as Array<Record<string, unknown>>)
        : [];

      for (const summary of summaries) {
        const converted = convertEmeraldSummaryToXboxProduct(
          summary,
          regionMeta.code,
          regionMeta.currency,
          EXCHANGE_RATES_PER_USD
        );
        if (converted) {
          collected.push(converted);
        }
      }

      if (!encodedCT || summaries.length === 0) break;
    } catch {
      break;
    }
  }

  return collected;
}

async function main() {
  console.log('Sincronizando tasas de cambio y ofertas reales de Xbox Store...');
  await refreshLiveExchangeRates();

  const map = new Map<string, XboxProduct>();

  for (const prod of INITIAL_XBOX_PRODUCTS) {
    map.set(prod.bigId.toUpperCase(), prod);
  }

  const primaryMarkets = ['MX', 'US', 'AR', 'TR', 'BR', 'CO', 'CL', 'ES'];
  for (const mkt of primaryMarkets) {
    const pages = mkt === 'MX' ? 3 : 1;
    const deals = await fetchDealsForRegion(mkt, pages);
    console.log(`Región ${mkt}: ${deals.length} ofertas obtenidas.`);
    for (const incoming of deals) {
      const key = incoming.bigId.toUpperCase();
      const existing = map.get(key);
      if (existing) {
        existing.pricesByRegion[mkt] = incoming.pricesByRegion[mkt];
        existing.historyByRegion[mkt] = incoming.historyByRegion[mkt];
      } else if (mkt === 'MX') {
        map.set(key, incoming);
      }
    }
  }

  const allProducts = Array.from(map.values());
  console.log(
    `Hidratando precios reales en los 16 países desde DisplayCatalog para ${allProducts.length} productos...`
  );
  const updatedQuotes = await batchHydrateProductsFromDisplayCatalog(
    allProducts,
    XBOX_REGIONS,
    '2026-11-06'
  );
  console.log(`Cotizaciones reales verificadas: ${updatedQuotes}`);

  const snapshotPayload = {
    generatedAt: new Date().toISOString(),
    totalProducts: allProducts.length,
    products: allProducts,
  };

  const publicDir = path.resolve(__dirname, '../public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  const publicJsonPath = path.join(publicDir, 'catalog-snapshot.json');
  fs.writeFileSync(
    publicJsonPath,
    JSON.stringify(snapshotPayload, null, 2),
    'utf-8'
  );

  const tsSnapshotPath = path.resolve(
    __dirname,
    '../src/data/liveDealsSnapshot.ts'
  );
  const tsContent = `import { XboxProduct } from '../types/xbox';\n\nexport const LIVE_DEALS_SNAPSHOT_UPDATED_AT = ${JSON.stringify(
    snapshotPayload.generatedAt
  )};\n\nexport const LIVE_DEALS_SNAPSHOT: XboxProduct[] = ${JSON.stringify(
    allProducts,
    null,
    2
  )};\n`;
  fs.writeFileSync(tsSnapshotPath, tsContent, 'utf-8');

  console.log(
    `Catálogo estático actualizado con éxito (${allProducts.length} productos reales).`
  );
}

main().catch((err) => {
  console.error('Error al sincronizar catálogo:', err);
  process.exit(0);
});
