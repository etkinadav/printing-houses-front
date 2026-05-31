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

export interface SyncSubCategoryPayload {
  key?: string;
  label: { he: string };
}

export interface SyncCategoryPayload {
  _id?: string;
  key?: string;
  label: { he: string };
  subCategories: SyncSubCategoryPayload[];
}

export interface SyncCategoriesRequest {
  categories: SyncCategoryPayload[];
  deletedIds: string[];
}
