import app from './app.js';
import { connectDatabase, ensureCollections } from './config/db.js';
import { env } from './config/env.js';
import { DriverAllocation } from './models/DriverAllocation.js';
import { Notification } from './models/Notification.js';
import { Preparation } from './models/Preparation.js';
import { TestDriveBooking } from './models/TestDriveBooking.js';
import { UnitAgentAllocation } from './models/UnitAgentAllocation.js';
import { User } from './models/User.js';
import { Vehicle } from './models/Vehicle.js';
import { ensureSeedData } from './services/seedService.js';

const bootstrapServer = async () => {
  const models = [
    User,
    Vehicle,
    Notification,
    DriverAllocation,
    UnitAgentAllocation,
    Preparation,
    TestDriveBooking,
  ];

  await connectDatabase();
  const ensuredCollections = await ensureCollections(models);

  if (env.autoSeed) {
    const seedSummary = await ensureSeedData();
    console.log('Seeded starter data:', seedSummary);
  }

  app.listen(env.port, () => {
    console.log(`I-TRACK backend listening on port ${env.port}.`);

    if (ensuredCollections.length > 0) {
      console.log(
        `Atlas collections ready: ${ensuredCollections.join(', ')}`
      );
    }
  });
};

bootstrapServer().catch((error) => {
  console.error('Failed to start backend:', error);
  process.exit(1);
});
