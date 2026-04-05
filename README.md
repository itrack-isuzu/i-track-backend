# I-TRACK Backend

Node/Express backend for the existing I-TRACK mobile and web frontends.

## MongoDB Atlas note

MongoDB does not use tables. It uses:

- `database`
- `collections`
- `documents`

In MongoDB Atlas, collections are created automatically the first time the app inserts data into them. This backend also includes an optional collection bootstrap step so the main collections can be created immediately on startup.

## Included modules

- Users
- Vehicles
- Driver allocations
- Health check
- Seed/bootstrap endpoint

## Setup

1. Copy `.env.example` to `.env`
2. Add your MongoDB Atlas connection string to `MONGODB_URI`
3. Install dependencies with `npm install`
4. Start the API with `npm run dev`

## EmailJS password recovery

The forgot-password flow now sends OTP codes through EmailJS from the backend.

Add these variables to `.env`:

- `EMAILJS_SERVICE_ID`
- `EMAILJS_TEMPLATE_ID`
- `EMAILJS_PUBLIC_KEY`
- `EMAILJS_PRIVATE_KEY` (optional, but recommended for server-side requests)
- `EMAILJS_APP_NAME`
- `EMAILJS_SUPPORT_EMAIL`
- `PASSWORD_RESET_OTP_EXPIRES_MINUTES`
- `PASSWORD_RESET_OTP_COOLDOWN_SECONDS`
- `PASSWORD_RESET_OTP_MAX_ATTEMPTS`

Your EmailJS template can use these template params:

- `app_name`
- `otp_code`
- `otp`
- `passcode`
- `to_email`
- `to_name`
- `support_email`
- `expires_in_minutes`

## Frontend API URLs

- Expo mobile app: `EXPO_PUBLIC_API_URL=http://localhost:4000/api`
- Next.js web app: `NEXT_PUBLIC_API_URL=http://localhost:4000/api`

## Main routes

- `GET /api/health`
- `GET /api/users`
- `POST /api/users`
- `GET /api/vehicles`
- `POST /api/vehicles`
- `POST /api/auth/forgot-password/request-otp`
- `POST /api/auth/forgot-password/verify-otp`
- `POST /api/auth/forgot-password/reset`
- `GET /api/driver-allocations`
- `POST /api/driver-allocations`
- `POST /api/setup/seed`

## Creating Atlas collections automatically

You have two ways to create the MongoDB Atlas collections:

1. Start the server with `MONGODB_AUTO_CREATE_COLLECTIONS=true`
2. Insert sample data with `npm run seed` or `POST /api/setup/seed`

Because MongoDB is schema-based but not table-based, this creates collections like:

- `users`
- `vehicles`
- `driverallocations`
