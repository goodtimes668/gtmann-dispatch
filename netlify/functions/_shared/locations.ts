type PhotonFeature = {
  geometry?: { coordinates?: unknown[] };
  properties?: Record<string, unknown>;
};

export type AddressSuggestion = {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function unique(parts: string[]) {
  return parts.filter((part, index) => part && parts.indexOf(part) === index);
}

export function normalizePhotonFeature(feature: PhotonFeature, index: number): AddressSuggestion | null {
  const coordinates = feature.geometry?.coordinates;
  const lng = Number(coordinates?.[0]);
  const lat = Number(coordinates?.[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const properties = feature.properties || {};
  const countryCode = clean(properties.countrycode).toUpperCase();
  if (countryCode && countryCode !== "CA") return null;

  const houseNumber = clean(properties.housenumber);
  const street = clean(properties.street);
  const road = unique([houseNumber, street]).join(" ");
  const locality = clean(properties.city) || clean(properties.town) || clean(properties.village) || clean(properties.locality);
  const province = clean(properties.state);
  const postcode = clean(properties.postcode);
  const country = clean(properties.country);
  const name = clean(properties.name);
  const address = unique([road, locality, province, postcode, country]).join(", ")
    || unique([name, locality, province, country]).join(", ");
  if (!address) return null;

  const label = name && !address.toLowerCase().startsWith(name.toLowerCase())
    ? `${name} — ${address}`
    : address;
  const osmType = clean(properties.osm_type);
  const osmId = String(properties.osm_id || index);
  return { id: `${osmType}:${osmId}:${index}`, label, address, lat, lng };
}
