// Fixture data for the mock provider, ported from the design prototype's
// inbound-data.js so the real client and the prototype show the same fares.

export interface MockAirport {
  iata: string; city: string; country: string; region: string;
  lat: number; lon: number; land: string; airport: string;
}
export interface MockDestination { iata: string; city: string; country: string; airport: string; lat: number; lon: number }
/** p: price (EUR, round trip), s: stops, a: airlines, h: hours since cached. */
export interface MockFare { p: number; s: number; a: string[]; h: number }

const A = (iata: string, city: string, country: string, region: string,
  lat: number, lon: number, land: string, airport?: string): MockAirport =>
  ({ iata, city, country, region, lat, lon, land, airport: airport || city });
const F = (p: number, s: number, a: string[], h: number): MockFare => ({ p, s, a, h });

export const COUNTRY_CODES: Record<string, string> = {
  Spain: 'ES', Portugal: 'PT', 'United Kingdom': 'GB', Ireland: 'IE', France: 'FR', Switzerland: 'CH',
  Belgium: 'BE', Netherlands: 'NL', Germany: 'DE', Austria: 'AT', Czechia: 'CZ', Poland: 'PL',
  Hungary: 'HU', Denmark: 'DK', Sweden: 'SE', Norway: 'NO', Finland: 'FI', Italy: 'IT', Greece: 'GR',
  'Türkiye': 'TR', 'United States': 'US', Canada: 'CA', Iceland: 'IS',
};

export const AIRPORTS: MockAirport[] = [
    A('MAD','Madrid','Spain','iberia',40.472,-3.561,'eu','Madrid–Barajas'),
    A('BCN','Barcelona','Spain','iberia',41.297,2.078,'eu','Barcelona–El Prat'),
    A('OPO','Porto','Portugal','iberia',41.248,-8.681,'eu','Francisco Sá Carneiro'),
    A('FNC','Funchal','Portugal','iberia',32.694,-16.778,'madeira','Madeira'),
    A('PDL','Ponta Delgada','Portugal','iberia',37.742,-25.698,'azores','João Paulo II'),
    A('LGW','London','United Kingdom','british',51.148,-0.190,'gb','Gatwick'),
    A('MAN','Manchester','United Kingdom','british',53.354,-2.275,'gb'),
    A('EDI','Edinburgh','United Kingdom','british',55.950,-3.373,'gb'),
    A('DUB','Dublin','Ireland','british',53.421,-6.270,'ie'),
    A('ORY','Paris','France','western',48.723,2.379,'eu','Orly'),
    A('LYS','Lyon','France','western',45.726,5.091,'eu','Saint-Exupéry'),
    A('NCE','Nice','France','western',43.658,7.216,'eu','Côte d’Azur'),
    A('GVA','Geneva','Switzerland','western',46.238,6.109,'eu'),
    A('BRU','Brussels','Belgium','western',50.901,4.484,'eu'),
    A('AMS','Amsterdam','Netherlands','western',52.310,4.768,'eu','Schiphol'),
    A('ZRH','Zurich','Switzerland','central',47.458,8.555,'eu'),
    A('FRA','Frankfurt','Germany','central',50.038,8.562,'eu'),
    A('MUC','Munich','Germany','central',48.354,11.786,'eu'),
    A('BER','Berlin','Germany','central',52.366,13.503,'eu','Brandenburg'),
    A('VIE','Vienna','Austria','central',48.110,16.570,'eu'),
    A('PRG','Prague','Czechia','central',50.101,14.260,'eu'),
    A('WAW','Warsaw','Poland','central',52.166,20.967,'eu','Chopin'),
    A('KRK','Kraków','Poland','central',50.078,19.785,'eu'),
    A('BUD','Budapest','Hungary','central',47.437,19.256,'eu'),
    A('CPH','Copenhagen','Denmark','nordic',55.618,12.656,'eu'),
    A('ARN','Stockholm','Sweden','nordic',59.650,17.919,'eu','Arlanda'),
    A('OSL','Oslo','Norway','nordic',60.194,11.100,'eu','Gardermoen'),
    A('HEL','Helsinki','Finland','nordic',60.317,24.963,'eu','Helsinki-Vantaa'),
    A('FCO','Rome','Italy','southern',41.800,12.239,'eu','Fiumicino'),
    A('MXP','Milan','Italy','southern',45.630,8.723,'eu','Malpensa'),
    A('ATH','Athens','Greece','southern',37.936,23.947,'eu'),
    A('IST','Istanbul','Türkiye','southern',41.262,28.742,'eu'),
    A('JFK','New York','United States','na',40.641,-73.778,'na','JFK'),
    A('BOS','Boston','United States','na',42.366,-71.010,'na','Logan'),
    A('IAD','Washington','United States','na',38.953,-77.456,'na','Dulles'),
    A('MIA','Miami','United States','na',25.796,-80.287,'na'),
    A('ORD','Chicago','United States','na',41.974,-87.907,'na',"O'Hare"),
    A('SFO','San Francisco','United States','na',37.621,-122.379,'na'),
    A('LAX','Los Angeles','United States','na',33.942,-118.408,'na'),
    A('YYZ','Toronto','Canada','na',43.677,-79.624,'na','Pearson'),
    A('YUL','Montréal','Canada','na',45.470,-73.741,'na','Trudeau'),
];

export const DESTINATIONS: MockDestination[] = [
    { iata:'LIS', city:'Lisbon', country:'Portugal', airport:'Humberto Delgado', lat:38.774, lon:-9.134 },
    { iata:'OPO', city:'Porto', country:'Portugal', airport:'Francisco Sá Carneiro', lat:41.248, lon:-8.681 },
    { iata:'FAO', city:'Faro', country:'Portugal', airport:'Faro', lat:37.017, lon:-7.966 },
    { iata:'FNC', city:'Funchal', country:'Portugal', airport:'Madeira', lat:32.694, lon:-16.778 },
    { iata:'MAD', city:'Madrid', country:'Spain', airport:'Madrid–Barajas', lat:40.472, lon:-3.561 },
    { iata:'BCN', city:'Barcelona', country:'Spain', airport:'Barcelona–El Prat', lat:41.297, lon:2.078 },
    { iata:'SVQ', city:'Seville', country:'Spain', airport:'Seville', lat:37.418, lon:-5.893 },
    { iata:'FCO', city:'Rome', country:'Italy', airport:'Fiumicino', lat:41.800, lon:12.239 },
    { iata:'ATH', city:'Athens', country:'Greece', airport:'Athens International', lat:37.936, lon:23.947 },
    { iata:'DUB', city:'Dublin', country:'Ireland', airport:'Dublin', lat:53.421, lon:-6.270 },
    { iata:'KEF', city:'Reykjavík', country:'Iceland', airport:'Keflavík', lat:63.985, lon:-22.605 },
    { iata:'IST', city:'Istanbul', country:'Türkiye', airport:'Istanbul', lat:41.262, lon:28.742 },
];

/** Hand-tuned LIS fares: round trip, economy, 1 adult, a weekend in March. */
export const LIS_FARES: Record<string, MockFare[]> = {
    MAD:[F(58,0,['TAP Air Portugal','Iberia'],5)], BCN:[F(49,0,['Vueling'],30)], OPO:[F(44,0,['TAP Air Portugal'],52)],
    FNC:[F(62,0,['easyJet','TAP Air Portugal'],18)], PDL:[F(79,0,['Azores Airlines','TAP Air Portugal'],96)],
    LGW:[F(56,0,['easyJet'],9)], MAN:[F(68,0,['Ryanair','easyJet'],61)], EDI:[F(84,0,['easyJet'],140)], DUB:[F(61,0,['Ryanair','Aer Lingus'],22)],
    ORY:[F(47,0,['Transavia'],3)], LYS:[F(126,0,['TAP Air Portugal'],40), F(98,1,['Vueling'],75)], NCE:[F(82,0,['easyJet','TAP Air Portugal'],110)],
    GVA:[F(64,0,['easyJet'],14)], BRU:[F(72,0,['Brussels Airlines','Ryanair'],48)], AMS:[F(79,0,['Transavia','KLM'],12)],
    ZRH:[F(131,0,['Swiss','TAP Air Portugal'],26), F(89,1,['Vueling'],60)], FRA:[F(118,0,['Lufthansa','TAP Air Portugal'],33), F(84,1,['Iberia'],80)],
    MUC:[F(124,0,['Lufthansa'],7), F(96,1,['Vueling'],150)], BER:[F(69,0,['Ryanair','easyJet'],20)], VIE:[F(98,0,['TAP Air Portugal','Austrian'],44)],
    PRG:[F(91,1,['Lufthansa'],66)], WAW:[F(94,0,['LOT'],28)], KRK:[F(73,0,['Ryanair'],120)], BUD:[F(86,0,['Wizz Air'],16)],
    CPH:[F(112,0,['SAS','TAP Air Portugal'],38)], ARN:[F(121,1,['SAS'],90)], OSL:[F(134,0,['Norwegian'],57)], HEL:[F(168,1,['Finnair','Iberia'],160)],
    FCO:[F(76,0,['ITA Airways','Ryanair'],11)], MXP:[F(57,0,['easyJet'],24)], ATH:[F(142,0,['Aegean'],70)],
    IST:[F(184,0,['Turkish Airlines'],36), F(151,1,['Pegasus','Vueling'],100)],
    JFK:[F(412,0,['TAP Air Portugal','Delta'],19), F(358,1,['Iberia'],54)], BOS:[F(376,0,['TAP Air Portugal'],42)],
    IAD:[F(431,0,['TAP Air Portugal','United'],88)], MIA:[F(468,0,['TAP Air Portugal'],130)], ORD:[F(497,0,['TAP Air Portugal','United'],64)],
    SFO:[F(562,0,['TAP Air Portugal'],150)], LAX:[F(598,1,['Delta','Air France'],77)], YYZ:[F(449,0,['Air Transat'],31)],
    YUL:[F(426,0,['Air Transat','Air Canada'],58)],
};

export const AIRLINE_POOL: Record<string, string[]> = {
    iberia:['Iberia','Vueling','TAP Air Portugal','Ryanair'], british:['easyJet','Ryanair','British Airways','Aer Lingus'],
    western:['Air France','Transavia','KLM','easyJet','Brussels Airlines'], central:['Lufthansa','Eurowings','Ryanair','Wizz Air','LOT','Austrian'],
    nordic:['SAS','Norwegian','Finnair'], southern:['ITA Airways','Aegean','Ryanair','Turkish Airlines'], na:['Delta','United','American Airlines','Air Canada','Air Transat'],
};
