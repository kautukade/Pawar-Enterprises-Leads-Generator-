# Pawar Enterprises Leads Generator

A full-stack local lead discovery tool built for Pawar Enterprises.

## What it does

- Search by locality / area
- Target categories such as housing societies, builders, hotels, offices, schools, healthcare, shops, warehouses and estate agencies
- Select service opportunity: Painting, Waterproofing, Civil Work, Plumbing, Electrical or Deep Cleaning
- Discover public business/property listings using OpenStreetMap / Overpass
- Optional Google Places provider when an API key is configured
- Remove duplicates
- Score every lead from 0–100
- Priority labels: Hot / Good / Normal
- Show public phone, email, website, address and map link when available
- Call / WhatsApp actions
- Save leads in browser
- Export leads to CSV
- Optional CRM webhook integration

## Data sources

Default mode uses public OpenStreetMap data through Nominatim + Overpass. The system does not scrape private contact data.

Google Places can be enabled by adding `GOOGLE_PLACES_API_KEY` as an environment variable.

## Local setup

Requirements: Node.js 18+

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Environment variables

```env
GOOGLE_PLACES_API_KEY=
CRM_WEBHOOK_URL=
PORT=3000
```

`GOOGLE_PLACES_API_KEY` is optional. Without it, OpenStreetMap mode works.

`CRM_WEBHOOK_URL` is optional. When configured, the UI exposes a Send CRM action.

## Render deployment

Use a **Web Service**, not a Static Site, because lead discovery runs through the Node.js backend.

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Branch: `main`
- Recommended region for India: Singapore
- Auto deploy: enabled

## Current CRM integration

The existing Pawar Enterprises CRM is a separate static application and currently stores demo data in browser localStorage. Because browser localStorage cannot be shared across different domains, direct cross-site insertion is intentionally not faked.

For real multi-device integration, connect both systems to the same Supabase database or expose a secure CRM webhook. The lead generator already contains a `CRM_WEBHOOK_URL` integration point for that next step.

## Lead quality notes

Public map datasets differ by locality. Some entries have phone numbers and websites; some only provide a business/property name and location. Google Places generally improves contact coverage when enabled through the official API.

Do not use this project to scrape private personal information or bypass platform terms.
