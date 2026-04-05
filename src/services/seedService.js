import { DriverAllocation } from '../models/DriverAllocation.js';
import { User } from '../models/User.js';
import { Vehicle } from '../models/Vehicle.js';
import {
  seedDriverAllocations,
  seedUsers,
  seedVehicles,
} from '../data/seedData.js';
import { hashPassword } from '../utils/passwords.js';

export const ensureSeedData = async () => {
  const usersByEmail = new Map();
  const vehiclesByConductionNumber = new Map();

  for (const userPayload of seedUsers) {
    const { password, ...userFields } = userPayload;
    const user = await User.findOneAndUpdate(
      { email: userPayload.email },
      {
        ...userFields,
        passwordHash: await hashPassword(password),
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    usersByEmail.set(user.email, user);
  }

  for (const vehiclePayload of seedVehicles) {
    const vehicle = await Vehicle.findOneAndUpdate(
      { conductionNumber: vehiclePayload.conductionNumber },
      vehiclePayload,
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    vehiclesByConductionNumber.set(vehicle.conductionNumber, vehicle);
  }

  let allocationCount = 0;

  for (const allocationPayload of seedDriverAllocations) {
    const manager = usersByEmail.get(allocationPayload.managerEmail) ?? null;
    const driver = usersByEmail.get(allocationPayload.driverEmail);
    const vehicle = vehiclesByConductionNumber.get(
      allocationPayload.conductionNumber
    );

    if (!driver) {
      throw new Error(
        `Seed driver not found for ${allocationPayload.driverEmail}.`
      );
    }

    if (!vehicle) {
      throw new Error(
        `Seed vehicle not found for ${allocationPayload.conductionNumber}.`
      );
    }

    const {
      managerEmail,
      driverEmail,
      conductionNumber,
      ...allocationFields
    } = allocationPayload;

    void managerEmail;
    void driverEmail;
    void conductionNumber;

    await DriverAllocation.findOneAndUpdate(
      {
        vehicleId: vehicle._id,
        driverId: driver._id,
        'pickupLocation.address': allocationFields.pickupLocation.address,
        'destinationLocation.address': allocationFields.destinationLocation.address,
      },
      {
        ...allocationFields,
        managerId: manager?._id ?? null,
        vehicleId: vehicle._id,
        driverId: driver._id,
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    allocationCount += 1;
  }

  return {
    users: seedUsers.length,
    vehicles: seedVehicles.length,
    driverAllocations: allocationCount,
  };
};
