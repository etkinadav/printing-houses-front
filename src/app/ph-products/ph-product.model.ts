import { PhCategory } from '../ph-categories/ph-category.model';

export interface PhProduct {
  _id: string;
  name_he: string;
  name_en: string;
  category: PhCategory | string;
  subCategory: string;
}

export interface PhSubCategoryGroup {
  name: string;
  products: PhProduct[];
}

export interface PhCategoryGroup {
  name: string;
  subCategories: PhSubCategoryGroup[];
}

export interface CreatePhProductPayload {
  name_he: string;
  name_en: string;
  category: string;
  subCategory: string;
}
