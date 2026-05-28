export interface PhProduct {
  _id: string;
  name: string;
  category: string;
  subCategory: string;
  material: string;
}

export interface PhSubCategoryGroup {
  name: string;
  products: PhProduct[];
}

export interface PhCategoryGroup {
  name: string;
  subCategories: PhSubCategoryGroup[];
}
