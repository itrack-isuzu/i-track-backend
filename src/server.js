import app from './app.js';
import { connectDatabase, ensureCollections } from './config/db.js';
import { env } from './config/env.js';
import { DriverAllocation } from './models/DriverAllocation.js';
import { Notification } from './models/Notification.js';
import { Preparation } from './models/Preparation.js';
import { PreparationEtaArtifact } from './models/PreparationEtaArtifact.js';
import { TestDriveBooking } from './models/TestDriveBooking.js';
import { UnitAgentAllocation } from './models/UnitAgentAllocation.js';
import { AuthSession } from './models/AuthSession.js';
import { User } from './models/User.js';
import { Vehicle } from './models/Vehicle.js';
import { initializePreparationEtaModel } from './services/preparationEtaService.js';
import { ensureSeedData } from './services/seedService.js';
import { startDriverSafetyMonitor } from './services/driverSafetyMonitorService.js';

const bootstrapServer = async () => {
  const models = [
    User,
    AuthSession,
    Vehicle,
    Notification,
    DriverAllocation,
    UnitAgentAllocation,
    Preparation,
    PreparationEtaArtifact,
    TestDriveBooking,
  ];

  await connectDatabase();
  const ensuredCollections = await ensureCollections(models);
  await initializePreparationEtaModel();

  if (env.autoSeed) {
    const seedSummary = await ensureSeedData();
    console.log('Seeded starter data:', seedSummary);
  }

  app.listen(env.port, () => {
    console.log(`I-TRACK backend listening on port ${env.port}.`);
    startDriverSafetyMonitor();

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
