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

## Frontend API URLs

- Expo mobile app: `EXPO_PUBLIC_API_URL=http://localhost:4000/api`
- Next.js web app: `NEXT_PUBLIC_API_URL=http://localhost:4000/api`

## Main routes

- `GET /api/health`
- `GET /api/users`
- `POST /api/users`
- `GET /api/vehicles`
- `POST /api/vehicles`
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
