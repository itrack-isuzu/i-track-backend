export const USER_ROLES = [
  'admin',
  'supervisor',
  'manager',
  'sales_agent',
  'dispatcher',
  'driver',
];

export const VEHICLE_STATUSES = [
  'available',
  'in_stockyard',
  'in_transit',
  'under_preparation',
  'completed',
  'maintenance',
];

export const ALLOCATION_STATUSES = [
  'pending',
  'assigned',
  'in_transit',
  'delivered',
  'completed',
  'cancelled',
];

export const ACTIVE_ALLOCATION_STATUSES = [
  'pending',
  'assigned',
  'in_transit',
];

export const PREPARATION_STATUSES = [
  'pending',
  'in_dispatch',
  'completed',
  'ready_for_release',
  'rejected',
];

export const PREPARATION_APPROVAL_STATUSES = [
  'awaiting_approval',
  'approved',
  'rejected',
];

export const SERVICE_TYPES = [
  'carwash',
  'tinting',
  'ceramic_coating',
  'accessories',
  'rust_proof',
  'custom_request',
  'detailing',
  'inspection',
  'maintenance',
  'painting',
];

export const TEST_DRIVE_STATUSES = [
  'available',
  'pending',
  'approved',
  'completed',
  'cancelled',
  'no_show',
];
