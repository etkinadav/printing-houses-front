# printing-houses-front

Angular 16 frontend for the printing-houses platform. Talks to the same backend as `mean-corse-01` (`https://api-dev.eazix.io` / `https://api.eazix.io`).

This project was bootstrapped by cloning the base infrastructure (auth, dialog system, navbar, error system, profile, credit, translation/direction, T&C, privacy policy) from `mean-corse-01`. See `MIGRATION_PLAN.md` at the repo root for the migration details.

## Prerequisites

- Node.js (matching Angular CLI 16; recommended Node 18 LTS)
- npm

## Installation

```bash
npm install
```

## Local development

The dev server runs on **HTTPS port 4443** (so it can run alongside `mean-corse-01` on port 443), using the SSL certificates in `certs/`.

```bash
npm run start:dev
```

Then open: `https://localhost:4443/`

> If you see a "certificate not trusted" warning, accept it once (the cert is for local development). If the certificates have expired, regenerate them with `mkcert` or OpenSSL.

Alternative without proxy:

```bash
npm run start:front
```

## Build

```bash
npm run build
```

Output goes to `dist/printing-houses-front/`.

## Backend

This frontend talks to the existing backend; no backend code lives in this repo.

- **Dev**: `https://api-dev.eazix.io`
- **Prod**: `https://api.eazix.io`

The URL is set in `src/environments/environment.ts` (dev) and `src/environments/environment.prod.ts` (prod).

## Known limitations

- **Social login (Google / Facebook)** may not work locally until the new frontend's domain (e.g. `https://localhost/social`) is added as an authorized `redirect_uri` in the Google Cloud and Facebook for Developers consoles. Email/password login, signup, and password reset are not affected.
- **Branding / i18n strings**: The strings still mention "Eazix" in many places. A future cleanup pass will replace them with the printing-houses brand.
- **`styles.scss`** was copied 1:1 from `mean-corse-01` (~1153 lines) and may contain CSS classes that are unused in this project. A cleanup pass is planned.

## Project structure

See `MIGRATION_PLAN.md` for the planned folder tree and what was copied / adapted / skipped.

```
src/
├── app/
│   ├── auth/                  Auth (login dialog + OAuth callback)
│   ├── dialog/                DialogService + phone + language-change dialogs
│   ├── error/                 Error component + interceptor
│   ├── home/                  Empty placeholder home page
│   ├── legal/                 Terms & Privacy
│   ├── main-nav/              Top navbar + side drawer + profile menu
│   ├── my-profile/            Profile + credit-card editing
│   ├── user/                  UsersService
│   └── utils/                 Generic helpers
├── assets/                    Fonts, images, i18n, videos (lottie)
└── environments/              dev / prod / browserstack configs
```
