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

export interface CreatePhPrintingHousePayload {
  name: string;
  logoUrl?: string;
  address: PhPrintingHouseAddress;
  location: PhPrintingHouseLocation;
}

export interface PhPrintingHouse {
  _id: string;
  createdByUserId: string;
  name: string;
  logoUrl?: string;
  address: PhPrintingHouseAddress;
  location: PhPrintingHouseLocation;
  createdAt?: string;
  updatedAt?: string;
}

