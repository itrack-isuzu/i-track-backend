import { ensureSeedData } from '../services/seedService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

export const seedDatabase = asyncHandler(async (req, res) => {
  void req;

  const summary = await ensureSeedData();

  sendSuccess(res, {
    status: 201,
    data: summary,
    message: 'Database seed completed successfully.',
  });
});
