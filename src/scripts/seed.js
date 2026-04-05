import mongoose from 'mongoose';

import { connectDatabase, ensureCollections } from '../config/db.js';
import { DriverAllocation } from '../models/DriverAllocation.js';
import { Preparation } from '../models/Preparation.js';
import { TestDriveBooking } from '../models/TestDriveBooking.js';
import { UnitAgentAllocation } from '../models/UnitAgentAllocation.js';
import { User } from '../models/User.js';
import { Vehicle } from '../models/Vehicle.js';
import { ensureSeedData } from '../services/seedService.js';

const run = async () => {
  await connectDatabase();
  await ensureCollections([
    User,
    Vehicle,
    DriverAllocation,
    UnitAgentAllocation,
    Preparation,
    TestDriveBooking,
  ]);

  const summary = await ensureSeedData();

  console.log('Seed completed successfully:', summary);

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('Seed failed:', error);
  await mongoose.disconnect();
  process.exit(1);
});
