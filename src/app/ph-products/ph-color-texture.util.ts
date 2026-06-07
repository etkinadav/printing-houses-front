/** Product color field may hold a hex value or an uploaded texture image URL. */
export function isColorTextureUrl(value: string | null | undefined): boolean {
  const v = (value || '').trim();
  return /^https?:\/\//i.test(v);
}
