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
- `EMAILJS_USER_WELCOME_TEMPLATE_ID` (optional; falls back to `EMAILJS_TEMPLATE_ID`)
- `EMAILJS_PUBLIC_KEY`
- `EMAILJS_PRIVATE_KEY` (optional, but recommended for server-side requests)
- `EMAILJS_APP_NAME`
- `EMAILJS_SUPPORT_EMAIL`
- `EXPO_ACCESS_TOKEN` (optional; only needed if your Expo project enforces authenticated push sends)
- `PASSWORD_RESET_OTP_EXPIRES_MINUTES`
- `PASSWORD_RESET_OTP_COOLDOWN_SECONDS`
- `PASSWORD_RESET_OTP_MAX_ATTEMPTS`

EmailJS setup note:

- In EmailJS Dashboard, open `Account > Security`
- Enable API access for non-browser environments
- If this stays disabled, backend OTP sends will fail with a 403 response

Your EmailJS template can use these template params:

- `app_name`
- `otp_code`
- `otp`
- `passcode`
- `to_email`
- `to_name`
- `support_email`
- `expires_in_minutes`

For new account credential emails, the backend can also send these params:

- `subject`
- `message`
- `headline`
- `role`
- `user_role`
- `temporary_password`
- `generated_password`
- `password`
- `login_email`
- `account_email`

## SMS configuration

The preparation SMS notification is triggered by the backend when a preparation moves into the release-complete flow, including the web "Confirm Ready for Release" action.

Add these variables to `.env`:

- `SMS_ENABLED=true`
- `SMS_PROVIDER=fortmed`, `SMS_PROVIDER=fmcsms`, or `SMS_PROVIDER=twilio`
- `FORTMED_API_URL`
- `FORTMED_API_KEY`
- `FORTMED_SENDER_ID`
- `FORTMED_FROM_NUMBER` (optional)
- `SMS_API_URL`, `SMS_API_KEY`, `SMS_SENDER_ID`, `SMS_FROM_NUMBER` also work as Fortmed-compatible legacy aliases
- `FMCSMS_API_URL`
- `FMCSMS_USERNAME`
- `FMCSMS_PASSWORD`
- `FMCSMS_SENDER_ID`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER`

Recommended local setup:

- Keep your frontend at `NEXT_PUBLIC_API_URL=http://localhost:4000/api`
- Run the backend with your Fortmed credentials in local `.env`
- From the web app, open Preparation and confirm "Ready for Release"

Recommended deployed setup:

- Add the same Fortmed SMS variables in your deployed backend environment, such as Render
- Keep the web frontend pointing to the deployed backend URL
- Redeploy the backend after saving the new environment variables

If `SMS_ENABLED` is true but the selected provider is not fully configured, the preparation will still be marked ready for release and the SMS step will be skipped.

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
- `GET /api/notifications?userId=:userId`
- `POST /api/notifications/push-token`
- `PATCH /api/notifications/read-all`
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
