export interface PhSubCategory {
  key: string;
  label: {
    en: string;
    he: string;
  };
}

export interface PhCategory {
  _id: string;
  type?: string;
  key: string;
  label_en: string;
  label_he: string;
  subCategories: PhSubCategory[];
}
