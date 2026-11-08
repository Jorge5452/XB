import { XboxProduct, XboxRegion } from '../types/xbox';

export const XBOX_REGIONS: XboxRegion[] = [
  { code: 'MX', locale: 'es-mx', name: 'México', currency: 'MXN', symbol: 'MX$', regionGroup: 'Americas' },
  { code: 'US', locale: 'en-us', name: 'Estados Unidos', currency: 'USD', symbol: 'US$', regionGroup: 'Americas' },
  { code: 'AR', locale: 'es-ar', name: 'Argentina', currency: 'ARS', symbol: 'ARS$', regionGroup: 'Americas' },
  { code: 'TR', locale: 'tr-tr', name: 'Turquía', currency: 'TRY', symbol: '₺', regionGroup: 'Europe' },
  { code: 'BR', locale: 'pt-br', name: 'Brasil', currency: 'BRL', symbol: 'R$', regionGroup: 'Americas' },
  { code: 'CO', locale: 'es-co', name: 'Colombia', currency: 'COP', symbol: 'COL$', regionGroup: 'Americas' },
  { code: 'CL', locale: 'es-cl', name: 'Chile', currency: 'CLP', symbol: 'CLP$', regionGroup: 'Americas' },
  { code: 'ES', locale: 'es-es', name: 'España', currency: 'EUR', symbol: '€', regionGroup: 'Europe' },
  { code: 'JP', locale: 'ja-jp', name: 'Japón', currency: 'JPY', symbol: '¥', regionGroup: 'Asia-Pacific' },
  { code: 'GB', locale: 'en-gb', name: 'Reino Unido', currency: 'GBP', symbol: '£', regionGroup: 'Europe' },
  { code: 'CA', locale: 'en-ca', name: 'Canadá', currency: 'CAD', symbol: 'CA$', regionGroup: 'Americas' },
  { code: 'IN', locale: 'en-in', name: 'India', currency: 'INR', symbol: '₹', regionGroup: 'Asia-Pacific' },
  { code: 'ZA', locale: 'en-za', name: 'Sudáfrica', currency: 'ZAR', symbol: 'R', regionGroup: 'MEA' },
  { code: 'PL', locale: 'pl-pl', name: 'Polonia', currency: 'PLN', symbol: 'zł', regionGroup: 'Europe' },
  { code: 'KR', locale: 'ko-kr', name: 'Corea del Sur', currency: 'KRW', symbol: '₩', regionGroup: 'Asia-Pacific' },
  { code: 'EG', locale: 'ar-eg', name: 'Egipto', currency: 'EGP', symbol: 'E£', regionGroup: 'MEA' },
];

/**
 * Tasas de cambio respecto a 1.00 USD.
 */
export const EXCHANGE_RATES_PER_USD: Record<string, number> = {
  USD: 1.0,
  MXN: 18.72,
  ARS: 1545.4,
  TRY: 50.08,
  BRL: 5.47,
  COP: 3236.82,
  CLP: 966.05,
  EUR: 0.89,
  JPY: 157.84,
  GBP: 0.74,
  CAD: 1.4,
  INR: 94.54,
  ZAR: 16.45,
  PLN: 3.92,
  KRW: 1347.69,
  EGP: 53.9,
};

export const CURRENCY_METADATA: Record<string, { label: string; symbol: string }> = {
  MXN: { label: 'Peso Mexicano (MXN)', symbol: 'MX$' },
  USD: { label: 'Dólar Estadounidense (USD)', symbol: 'US$' },
  ARS: { label: 'Peso Argentino (ARS)', symbol: 'ARS$' },
  TRY: { label: 'Lira Turca (TRY)', symbol: '₺' },
  BRL: { label: 'Real Brasileño (BRL)', symbol: 'R$' },
  COP: { label: 'Peso Colombiano (COP)', symbol: 'COL$' },
  CLP: { label: 'Peso Chileno (CLP)', symbol: 'CLP$' },
  EUR: { label: 'Euro (EUR)', symbol: '€' },
  JPY: { label: 'Yen Japonés (JPY)', symbol: '¥' },
  GBP: { label: 'Libra Esterlina (GBP)', symbol: '£' },
  CAD: { label: 'Dólar Canadiense (CAD)', symbol: 'CA$' },
  INR: { label: 'Rupia India (INR)', symbol: '₹' },
  ZAR: { label: 'Rand Sudafricano (ZAR)', symbol: 'R' },
  PLN: { label: 'Złoty Polaco (PLN)', symbol: 'zł' },
  KRW: { label: 'Won Surcoreano (KRW)', symbol: '₩' },
  EGP: { label: 'Libra Egipcia (EGP)', symbol: 'E£' },
};

function buildRegionalPricesMap(params: {
  usdList: number;
  discountPct: number;
  gamePassExtraPct?: number;
  includedInGamePass: boolean;
  startDate: string;
  endDate: string | null;
  regionalMultipliers?: Partial<Record<string, number>>;
}) {
  const defaultMultipliers: Record<string, number> = {
    TR: 0.44,
    AR: 0.47,
    EG: 0.42,
    IN: 0.58,
    BR: 0.68,
    CO: 0.72,
    CL: 0.76,
    ZA: 0.74,
    MX: 0.84,
    KR: 0.86,
    PL: 0.92,
    CA: 0.94,
    JP: 0.89,
    US: 1.0,
    ES: 1.06,
    GB: 1.08,
  };

  const map: XboxProduct['pricesByRegion'] = {};

  for (const region of XBOX_REGIONS) {
    const rate = EXCHANGE_RATES_PER_USD[region.currency] || 1;
    const mult =
      params.regionalMultipliers?.[region.code] ??
      defaultMultipliers[region.code] ??
      1.0;

    const rawList = params.usdList * rate * mult;
    const listPrice =
      params.usdList === 0
        ? 0
        : rate > 500
          ? Math.round(rawList / 100) * 100
          : rate > 15
            ? Math.round(rawList)
            : Number(rawList.toFixed(2));

    const salePrice =
      params.usdList === 0
        ? 0
        : params.discountPct > 0
          ? Number((listPrice * (1 - params.discountPct / 100)).toFixed(2))
          : null;

    const gpTotalDiscount =
      params.gamePassExtraPct && params.gamePassExtraPct > 0
        ? Math.min(95, params.discountPct + params.gamePassExtraPct)
        : null;

    const gamePassPrice =
      params.usdList === 0
        ? null
        : gpTotalDiscount !== null
          ? Number((listPrice * (1 - gpTotalDiscount / 100)).toFixed(2))
          : null;

    const effectiveDiscount =
      gpTotalDiscount !== null ? gpTotalDiscount : params.discountPct;

    map[region.code] = {
      regionCode: region.code,
      currency: region.currency,
      listPrice,
      salePrice,
      gamePassPrice,
      includedInGamePass: params.includedInGamePass,
      discountPct: effectiveDiscount,
      startDate: params.startDate,
      endDate: params.endDate,
    };
  }

  return map;
}

function buildHistoryMap(
  pricesByRegion: XboxProduct['pricesByRegion'],
  saleFactors: Array<{ date: string; factor: number; eventLabel?: string }>
) {
  const historyMap: XboxProduct['historyByRegion'] = {};

  for (const region of XBOX_REGIONS) {
    const rPrice = pricesByRegion[region.code];
    if (!rPrice) continue;
    const base = rPrice.listPrice;

    historyMap[region.code] = saleFactors.map((pt) => ({
      date: pt.date,
      regularPrice: base,
      salePrice: Number((base * pt.factor).toFixed(2)),
      eventLabel: pt.eventLabel,
    }));
  }

  return historyMap;
}

const p1Prices = buildRegionalPricesMap({
  usdList: 44.99,
  discountPct: 70,
  includedInGamePass: true,
  startDate: '2026-11-01T00:00:00Z',
  endDate: '2026-11-08T23:59:59Z',
  regionalMultipliers: { TR: 0.38, AR: 0.46, EG: 0.52, BR: 0.64 },
});

const p2Prices = buildRegionalPricesMap({
  usdList: 39.99,
  discountPct: 75,
  includedInGamePass: true,
  startDate: '2026-10-30T00:00:00Z',
  endDate: '2026-11-06T18:00:00Z',
  regionalMultipliers: { AR: 0.36, TR: 0.45, EG: 0.5, CO: 0.66 },
});

const p3Prices = buildRegionalPricesMap({
  usdList: 59.99,
  discountPct: 60,
  includedInGamePass: true,
  startDate: '2026-11-02T00:00:00Z',
  endDate: '2026-11-14T23:59:59Z',
  regionalMultipliers: { BR: 0.41, TR: 0.48, AR: 0.52, MX: 0.82 },
});

const p4Prices = buildRegionalPricesMap({
  usdList: 49.99,
  discountPct: 35,
  includedInGamePass: false,
  startDate: '2026-11-01T00:00:00Z',
  endDate: '2026-11-06T08:00:00Z',
  regionalMultipliers: { EG: 0.39, TR: 0.44, IN: 0.51, AR: 0.49 },
});

const p5Prices = buildRegionalPricesMap({
  usdList: 49.99,
  discountPct: 90,
  includedInGamePass: true,
  startDate: '2026-11-03T00:00:00Z',
  endDate: '2026-11-12T23:59:59Z',
  regionalMultipliers: { TR: 0.37, AR: 0.45, EG: 0.49 },
});

const p6Prices = buildRegionalPricesMap({
  usdList: 24.99,
  discountPct: 75,
  includedInGamePass: true,
  startDate: '2026-11-01T00:00:00Z',
  endDate: '2026-11-07T12:00:00Z',
  regionalMultipliers: { IN: 0.42, TR: 0.47, AR: 0.51 },
});

const p7Prices = buildRegionalPricesMap({
  usdList: 29.99,
  discountPct: 80,
  includedInGamePass: true,
  startDate: '2026-10-29T00:00:00Z',
  endDate: '2026-11-05T22:00:00Z',
  regionalMultipliers: { AR: 0.35, TR: 0.43, BR: 0.58 },
});

const p8Prices = buildRegionalPricesMap({
  usdList: 24.99,
  discountPct: 20,
  includedInGamePass: false,
  startDate: '2026-11-02T00:00:00Z',
  endDate: '2026-11-18T23:59:59Z',
});

const p9Prices = buildRegionalPricesMap({
  usdList: 19.99,
  discountPct: 100,
  includedInGamePass: true,
  startDate: '2026-11-01T00:00:00Z',
  endDate: '2026-11-09T23:59:59Z',
});

const p10Prices = buildRegionalPricesMap({
  usdList: 0,
  discountPct: 100,
  includedInGamePass: true,
  startDate: '2026-10-15T00:00:00Z',
  endDate: null,
});

export const INITIAL_XBOX_PRODUCTS: XboxProduct[] = [
  {
    bigId: '9NXVC0482QS5',
    slug: 'it-takes-two-version-digital',
    title: 'It Takes Two - Versión digital',
    subtitle: 'Hazelight · Electronic Arts',
    description:
      'Embárcate en la aventura más loca de tu vida en It Takes Two, un juego de plataformas y aventura creado exclusivamente para el modo cooperativo. Invita a un amigo a unirse gratis con el Pase de amigo.',
    developer: 'Hazelight',
    publisher: 'Electronic Arts',
    releaseDate: '2021-03-26',
    productType: 'Game',
    platforms: ['Xbox Series X|S', 'Xbox One'],
    coverImage:
      'https://store-images.s-microsoft.com/image/apps.1758.14488339386131194.84ca8b8a-582e-4d34-904e-8f1e60f71000.21ae50f4-b3e8-491b-b7f9-a78676a40b42',
    screenshots: [
      'https://store-images.s-microsoft.com/image/apps.40253.14488339386131194.84ca8b8a-582e-4d34-904e-8f1e60f71000.c3aaab37-0ce8-464b-85c1-4f42a74d9972',
    ],
    featuredDeal: true,
    addedToDealsAt: '2026-11-04T06:00:00Z',
    pricesByRegion: p1Prices,
    historyByRegion: buildHistoryMap(p1Prices, [
      { date: '2025-11-20', factor: 0.85, eventLabel: 'Black Friday' },
      { date: '2026-01-10', factor: 1.0 },
      { date: '2026-03-15', factor: 0.6, eventLabel: 'Oferta de Primavera' },
      { date: '2026-05-01', factor: 1.0 },
      { date: '2026-07-18', factor: 0.45, eventLabel: 'Ultimate Game Sale' },
      { date: '2026-09-01', factor: 1.0 },
      { date: '2026-11-01', factor: 0.3, eventLabel: 'Oferta Actual (-70%)' },
    ]),
  },
  {
    bigId: 'BWTTW53M5B98',
    slug: 'battlefield-1',
    title: 'Battlefield™ 1',
    subtitle: 'DICE · Electronic Arts',
    description:
      'Vive el amanecer de la guerra total en Battlefield 1. Lucha en batallas multijugador masivas de hasta 64 jugadores o descubre un mundo en guerra a través de las Historias de guerra de la campaña.',
    developer: 'DICE',
    publisher: 'Electronic Arts',
    releaseDate: '2016-10-21',
    productType: 'Game',
    platforms: ['Xbox Series X|S', 'Xbox One'],
    coverImage:
      'https://store-images.s-microsoft.com/image/apps.8968.71723728477894721.ccae3323-9805-41d3-ae50-dc82948a7d7f.c0fce5d3-1195-4540-a9e9-68908c5e766e',
    screenshots: [
      'https://store-images.s-microsoft.com/image/apps.11030.71723728477894721.ccae3323-9805-41d3-ae50-dc82948a7d7f.553b97e6-4d70-46b2-83db-ceb07c5f8f5a',
    ],
    featuredDeal: true,
    addedToDealsAt: '2026-11-03T14:00:00Z',
    pricesByRegion: p2Prices,
    historyByRegion: buildHistoryMap(p2Prices, [
      { date: '2025-08-12', factor: 0.75, eventLabel: 'Oferta de Verano' },
      { date: '2025-10-01', factor: 1.0 },
      { date: '2025-12-20', factor: 0.5, eventLabel: 'Fin de Año' },
      { date: '2026-02-15', factor: 1.0 },
      { date: '2026-06-10', factor: 0.35, eventLabel: 'Xbox Showcase' },
      { date: '2026-08-20', factor: 1.0 },
      { date: '2026-10-30', factor: 0.25, eventLabel: 'Rebaja Actual' },
    ]),
  },
  {
    bigId: 'BQVQTL3PCH05',
    slug: 'no-mans-sky',
    title: "No Man's Sky",
    subtitle: 'Hello Games',
    description:
      'Explora y sobrevive en un universo infinito generado de forma procedimental. Viaja sin pantallas de carga desde el espacio profundo hasta la superficie de planetas únicos con tus amigos.',
    developer: 'Hello Games',
    publisher: 'Hello Games',
    releaseDate: '2018-07-24',
    productType: 'Game',
    platforms: ['Xbox Series X|S', 'Xbox One', 'Windows PC', 'Xbox Play Anywhere'],
    coverImage:
      'https://store-images.s-microsoft.com/image/apps.63540.68818099466568894.c45f3219-f40b-416f-b0ee-34cb9652410f.f4410eab-ad57-480c-8cff-d772b9b255d6',
    screenshots: [
      'https://store-images.s-microsoft.com/image/apps.43892.68818099466568894.c45f3219-f40b-416f-b0ee-34cb9652410f.b196776d-cfc0-42d6-aec4-1254993e3f08',
    ],
    featuredDeal: true,
    addedToDealsAt: '2026-11-04T09:30:00Z',
    pricesByRegion: p3Prices,
    historyByRegion: buildHistoryMap(p3Prices, [
      { date: '2025-12-18', factor: 0.8, eventLabel: 'Fin de Año' },
      { date: '2026-02-01', factor: 1.0 },
      { date: '2026-04-12', factor: 0.6, eventLabel: 'Primavera' },
      { date: '2026-06-01', factor: 1.0 },
      { date: '2026-08-14', factor: 0.5, eventLabel: 'Gamescom' },
      { date: '2026-10-01', factor: 1.0 },
      { date: '2026-11-02', factor: 0.4, eventLabel: 'Oferta Actual (-60%)' },
    ]),
  },
  {
    bigId: '9N1WXXD1RL8D',
    slug: 'split-fiction',
    title: 'Split Fiction',
    subtitle: 'Hazelight Studios · Electronic Arts',
    description:
      'Adéntrate en mundos de ciencia ficción y fantasía en esta nueva aventura cooperativa de acción creada por el estudio detrás de It Takes Two.',
    developer: 'Hazelight Studios AB',
    publisher: 'Electronic Arts',
    releaseDate: '2025-03-06',
    productType: 'Game',
    platforms: ['Xbox Series X|S'],
    coverImage:
      'https://store-images.s-microsoft.com/image/apps.27923.14618682156446874.2f5c3bab-6522-45a8-931d-deed3390944f.e9ef3cd0-68b0-41ba-b803-370dbe318cb0',
    screenshots: [
      'https://store-images.s-microsoft.com/image/apps.60923.14618682156446874.2f5c3bab-6522-45a8-931d-deed3390944f.1b9e6318-e3e8-46e0-9499-2d20e1797b80',
    ],
    featuredDeal: true,
    addedToDealsAt: '2026-11-02T18:00:00Z',
    pricesByRegion: p4Prices,
    historyByRegion: buildHistoryMap(p4Prices, [
      { date: '2026-03-06', factor: 1.0, eventLabel: 'Lanzamiento' },
      { date: '2026-07-10', factor: 0.8, eventLabel: 'Oferta de Verano' },
      { date: '2026-09-01', factor: 1.0 },
      { date: '2026-11-01', factor: 0.65, eventLabel: 'Oferta Actual (-35%)' },
    ]),
  },
  {
    bigId: '9N442DM2MD6F',
    slug: 'battlefield-v-definitive-edition',
    title: 'Battlefield™ V Definitive Edition',
    subtitle: 'DICE · Electronic Arts',
    description:
      'Incluye el juego base Battlefield V y la colección definitiva de contenido: todas las armas, vehículos, dispositivos y todos los soldados de élite del Año 1 y Año 2.',
    developer: 'DICE',
    publisher: 'Electronic Arts',
    releaseDate: '2020-10-22',
    productType: 'Bundle',
    parentBigId: 'BWTTW53M5B98',
    platforms: ['Xbox Series X|S', 'Xbox One'],
    coverImage:
      'https://store-images.s-microsoft.com/image/apps.10903.13990191027854846.0c760294-e5d0-447a-84a2-8b9c4c3cfe9b.3da9e2c5-0551-4f12-93b7-dc51d28812ec',
    screenshots: [
      'https://store-images.s-microsoft.com/image/apps.32127.13990191027854846.0c760294-e5d0-447a-84a2-8b9c4c3cfe9b.33716b56-8bcd-4873-8747-e9fe401d02dc',
    ],
    featuredDeal: true,
    addedToDealsAt: '2026-11-04T02:00:00Z',
    pricesByRegion: p5Prices,
    historyByRegion: buildHistoryMap(p5Prices, [
      { date: '2026-03-15', factor: 0.5, eventLabel: 'Primavera' },
      { date: '2026-05-01', factor: 1.0 },
      { date: '2026-07-20', factor: 0.25, eventLabel: 'Verano' },
      { date: '2026-09-10', factor: 1.0 },
      { date: '2026-11-03', factor: 0.1, eventLabel: 'Mínimo Histórico (-90%)' },
    ]),
  },
  {
    bigId: 'C0GWTPD0S8S1',
    slug: 'star-wars-battlefront-ii',
    title: 'STAR WARS™ Battlefront™ II',
    subtitle: 'DICE · Electronic Arts',
    description:
      'Conviértete en el héroe en la fantasía de batalla definitiva de STAR WARS con combates espaciales y terrestres en todas las eras de la galaxia.',
    developer: 'DICE',
    publisher: 'Electronic Arts',
    releaseDate: '2017-11-17',
    productType: 'Add-on',
    parentBigId: 'BWTTW53M5B98',
    platforms: ['Xbox Series X|S', 'Xbox One'],
    coverImage:
      'https://store-images.s-microsoft.com/image/apps.31281.64256825846959382.44b5bc43-437a-4414-83ca-b41ba9e7764a.86abb8aa-f419-4a90-b6aa-cf79b4228f06',
    screenshots: [
      'https://store-images.s-microsoft.com/image/apps.12447.64256825846959382.44b5bc43-437a-4414-83ca-b41ba9e7764a.0e2ce787-008a-4571-bf11-a161817b1e01',
    ],
    featuredDeal: false,
    addedToDealsAt: '2026-11-03T11:00:00Z',
    pricesByRegion: p6Prices,
    historyByRegion: buildHistoryMap(p6Prices, [
      { date: '2026-05-15', factor: 0.6, eventLabel: 'Star Wars Day' },
      { date: '2026-07-01', factor: 1.0 },
      { date: '2026-09-05', factor: 0.4, eventLabel: 'Otoño' },
      { date: '2026-10-10', factor: 1.0 },
      { date: '2026-11-01', factor: 0.25, eventLabel: 'Oferta Actual (-75%)' },
    ]),
  },
  {
    bigId: 'BT21JH17GCVC',
    slug: 'titanfall-2-ultimate-edition',
    title: 'Titanfall™ 2 Ultimate Edition',
    subtitle: 'Respawn · Electronic Arts',
    description:
      'La mejor forma de sumergirse en uno de los shooters más sorprendentes de la generación. Incluye el juego base y todo el contenido Digital Deluxe.',
    developer: 'Respawn',
    publisher: 'Electronic Arts',
    releaseDate: '2017-08-01',
    productType: 'Add-on',
    parentBigId: 'BQVQTL3PCH05',
    platforms: ['Xbox Series X|S', 'Xbox One'],
    coverImage:
      'https://store-images.s-microsoft.com/image/apps.17944.70066375305131012.7e5d8c08-6bdc-42fc-8afd-c1e176cb829d.62db6477-65e8-46a2-9e0d-5f3258bd2318',
    screenshots: [
      'https://store-images.s-microsoft.com/image/apps.21624.70066375305131012.7e5d8c08-6bdc-42fc-8afd-c1e176cb829d.080ba702-f689-49ec-83e9-e517118b4b50',
    ],
    featuredDeal: false,
    addedToDealsAt: '2026-11-01T10:00:00Z',
    pricesByRegion: p7Prices,
    historyByRegion: buildHistoryMap(p7Prices, [
      { date: '2026-04-12', factor: 0.5, eventLabel: 'Primavera' },
      { date: '2026-06-01', factor: 1.0 },
      { date: '2026-08-14', factor: 0.3, eventLabel: 'Gamescom' },
      { date: '2026-09-25', factor: 1.0 },
      { date: '2026-10-29', factor: 0.2, eventLabel: 'Oferta Actual (-80%)' },
    ]),
  },
  {
    bigId: '9NDP40GVGC80',
    slug: 'the-wolf-among-us-remastered',
    title: 'The Wolf Among Us Remastered',
    subtitle: 'Telltale',
    description:
      'Un thriller oscuro y violento de los creadores de The Walking Dead basado en los cómics ganadores del premio Eisner, Fables.',
    developer: 'Telltale',
    publisher: 'Telltale',
    releaseDate: '2014-11-04',
    productType: 'Bundle',
    parentBigId: '9N1WXXD1RL8D',
    platforms: ['Xbox Series X|S', 'Xbox One'],
    coverImage:
      'https://store-images.s-microsoft.com/image/apps.59316.13615139346622059.9b39c95a-8743-4494-8c1f-b2a811aa1372.b150a262-ef1d-4925-b291-7000f1a96ddf',
    screenshots: [
      'https://store-images.s-microsoft.com/image/apps.273.13615139346622059.9b39c95a-8743-4494-8c1f-b2a811aa1372.3e12584f-bdd5-476e-a552-f08337c3bab1',
    ],
    featuredDeal: false,
    addedToDealsAt: '2026-11-02T20:00:00Z',
    pricesByRegion: p8Prices,
    historyByRegion: buildHistoryMap(p8Prices, [
      { date: '2026-05-10', factor: 0.65, eventLabel: 'Primavera' },
      { date: '2026-06-15', factor: 1.0 },
      { date: '2026-07-20', factor: 0.4, eventLabel: 'Mínimo Julio (-60%)' },
      { date: '2026-09-01', factor: 1.0 },
      { date: '2026-11-02', factor: 0.8, eventLabel: 'Oferta Actual (-20%)' },
    ]),
  },
  {
    bigId: 'BP15SF17LH13',
    slug: 'battlefield-4-community-operations',
    title: 'Battlefield 4™: Community Operations',
    subtitle: 'DICE · Electronic Arts',
    description:
      'Expansión gratuita diseñada junto a la comunidad de Battlefield 4 que incluye el mapa Operación Outbreak en una densa jungla.',
    developer: 'EA Digital Illusions CE',
    publisher: 'Electronic Arts',
    releaseDate: '2015-10-27',
    productType: 'Add-on',
    parentBigId: '9NXVC0482QS5',
    platforms: ['Xbox Series X|S', 'Xbox One'],
    coverImage:
      'https://store-images.s-microsoft.com/image/apps.1392.67660042887481018.7de2bfcd-48ef-4a6c-bba4-e65d208d67ec.d712d519-5ad0-4aac-9271-ad4424fd3702',
    screenshots: [
      'https://store-images.s-microsoft.com/image/apps.27970.67660042887481018.7de2bfcd-48ef-4a6c-bba4-e65d208d67ec.238fb864-efda-47a0-a54e-bc7b2ef112c5',
    ],
    featuredDeal: true,
    addedToDealsAt: '2026-11-04T08:00:00Z',
    pricesByRegion: p9Prices,
    historyByRegion: buildHistoryMap(p9Prices, [
      { date: '2026-06-01', factor: 1.0 },
      { date: '2026-08-15', factor: 0.5 },
      { date: '2026-09-20', factor: 1.0 },
      { date: '2026-11-01', factor: 0.0, eventLabel: '100% Gratis' },
    ]),
  },
  {
    bigId: 'BPL68T0XK96W',
    slug: 'halo-infinite-multijugador',
    title: 'Battlefield™ 1: Pase de Pruebas Online',
    subtitle: 'DICE · Electronic Arts',
    description:
      'Acceso gratuito a las misiones introductorias y pruebas multijugador en servidores oficiales.',
    developer: 'DICE',
    publisher: 'Electronic Arts',
    releaseDate: '2017-09-12',
    productType: 'Game',
    parentBigId: '9N1WXXD1RL8D',
    platforms: ['Xbox Series X|S', 'Xbox One'],
    coverImage:
      'https://store-images.s-microsoft.com/image/apps.14378.68596255437297164.99e6fb73-cd5e-440f-90c2-d8d2eb40a69d.b1ea28bc-8321-45e0-8905-d6e796dcba74',
    screenshots: [
      'https://store-images.s-microsoft.com/image/apps.20517.68596255437297164.99e6fb73-cd5e-440f-90c2-d8d2eb40a69d.b89ed24d-ec2e-4720-a295-935fdbc37f7f',
    ],
    featuredDeal: false,
    addedToDealsAt: '2026-10-28T12:00:00Z',
    pricesByRegion: p10Prices,
    historyByRegion: buildHistoryMap(p10Prices, [
      { date: '2026-05-12', factor: 0.0, eventLabel: 'Gratis' },
      { date: '2026-11-01', factor: 0.0, eventLabel: 'Gratis' },
    ]),
  },
];
