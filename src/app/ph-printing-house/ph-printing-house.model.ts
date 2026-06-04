export interface PhPrintingHouseAddress {
  city: string;
  street: string;
  houseNumber: string;
  apartment?: string;
  floor?: string;
  postalCode?: string;
  notes?: string;
}

export interface PhPrintingHouseLocation {
  lat: number;
  lon: number;
}

export interface PhPrintingHouseLogo {
  url: string;
  zoom: number;
  /** Offset as ratio of viewport width (when offsetsNormalized) or legacy px at 220px box. */
  offsetX: number;
  /** Offset as ratio of viewport height (when offsetsNormalized) or legacy px at 220px box. */
  offsetY: number;
  offsetsNormalized?: boolean;
}

export interface CreatePhPrintingHousePayload {
  name: string;
  logo?: PhPrintingHouseLogo;
  address: PhPrintingHouseAddress;
  location: PhPrintingHouseLocation;
}

/** Subset returned by public `GET /ph-printing-house` for the home map. */
export interface PhPrintingHouseMapMarker {
  _id: string;
  name: string;
  logoUrl?: string;
  logo?: PhPrintingHouseLogo;
  location: PhPrintingHouseLocation;
}

export interface PhPrintingHouse {
  _id: string;
  createdByUserId: string;
  name: string;
  logoUrl?: string;
  logo?: PhPrintingHouseLogo;
  address: PhPrintingHouseAddress;
  location: PhPrintingHouseLocation;
  productIds?: string[];
  createdAt?: string;
  updatedAt?: string;
}

