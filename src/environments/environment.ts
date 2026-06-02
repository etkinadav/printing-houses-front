// This file can be replaced during build by using the `fileReplacements` array.
// `ng build --prod` replaces `environment.ts` with `environment.prod.ts`.

export const environment = {
  production: false,
  apiUrl: 'https://api-dev.eazix.io',
  /** false = MapTiler via dev proxy on localhost (see proxy.conf.json). true = direct API (whitelist localhost in MapTiler). */
  useMapTilerDirectOnLocalhost: false,
  mapTilerApiKey: 'vcb9jeTslt2RyaGbzwU8',
  mapTilerMapId: '0197cd49-90c4-751b-9113-725f6ff68205',
};
