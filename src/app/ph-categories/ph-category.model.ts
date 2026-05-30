export interface PhLabel {
  en: string;
  he: string;
  ar: string;
}

export interface PhSubCategory {
  key: string;
  label: PhLabel;
}

export interface PhCategory {
  _id: string;
  type?: string;
  key: string;
  label: PhLabel;
  subCategories: PhSubCategory[];
}
