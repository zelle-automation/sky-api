// Countries come from REST Countries (https://restcountries.com, no key).
// The bundled `world-countries` package has the same shape and is used for the
// offline seed, so one mapper serves both.

export function mapCountry(c) {
  const suffix = c.idd?.suffixes?.length === 1 ? c.idd.suffixes[0] : "";
  return {
    iso2: c.cca2,
    iso3: c.cca3,
    name: c.name.common,
    official_name: c.name.official,
    region: c.region ?? null,
    subregion: c.subregion ?? null,
    capital: c.capital?.[0] ?? null,
    currency_code: c.currencies ? (Object.keys(c.currencies)[0] ?? null) : null,
    calling_code: c.idd?.root ? `${c.idd.root}${suffix}` : null,
    flag_emoji: c.flag ?? null,
    lat: c.latlng?.[0] ?? null,
    lng: c.latlng?.[1] ?? null,
  };
}

const FIELDS = "name,cca2,cca3,region,subregion,capital,currencies,idd,flag,latlng";

export async function fetchRestCountries() {
  const res = await fetch(`https://restcountries.com/v3.1/all?fields=${FIELDS}`);
  if (!res.ok) throw new Error(`REST Countries responded ${res.status}`);
  const data = await res.json();
  return data.map(mapCountry);
}
