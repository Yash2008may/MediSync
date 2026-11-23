import { z } from 'zod';
import { normalizePhone } from '../utils/phone.js';

// JSON bodies from the browser carry real numbers, so no coercion (coerce would turn null into 0).
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

export const locationSchema = z
  .object({
    latitude,
    longitude,
    altitude: z.number().min(-500).max(9000).nullable().optional(), // many devices report null
    accuracy: z.number().min(0).nullable().optional(),               // metres, from the Geolocation API
  })
  .refine((v) => !(v.latitude === 0 && v.longitude === 0), 'Invalid location (0,0)');

export const reverseGeocodeSchema = z.object({ latitude, longitude });

// A place name the patient typed, resolved to coordinates server-side.
export const geocodeAddressSchema = z.object({
  address: z.string().trim().min(3, 'Enter a place name').max(200),
});

// The patient's own default location: coordinates plus a short human label.
export const defaultLocationSchema = z
  .object({
    lat: latitude,
    lng: longitude,
    label: z.string().trim().min(2, 'Give this place a name').max(120),
  })
  .refine((v) => !(v.lat === 0 && v.lng === 0), 'Invalid location (0,0)');

export const nearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().min(200).max(20000).optional(),
  limit: z.coerce.number().int().min(1).max(60).optional(),
});

export const consentSchema = z.object({
  type: z.enum(['health_data_processing', 'privacy_policy', 'notifications', 'location']),
  granted: z.boolean(),
});

export const deleteAccountSchema = z.object({ password: z.string().min(1).max(72) });

export const adminVerifySchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.decision === 'approved' || (v.note && v.note.length >= 3), {
    message: 'Please give a reason when rejecting',
    path: ['note'],
  });

// Suspend (force sign-out) or re-enable a pharmacy account.
export const adminAccountSchema = z.object({
  active: z.boolean(),
  note: z.string().trim().max(500).optional(),
});

export const pharmacistSchema = z.object({
  pharmacistName: z.string().trim().min(2).max(100),
  pharmacistRegNo: z.string().trim().min(3).max(40),
});

// A prescription-backed order line. The browser sends only a catalogue id and a quantity;
// price, discount and Schedule H flags are read from pharmacy_inventory on the server.
export const orderItemSchema = z.object({
  inventoryId: z.string().uuid('Choose a medicine from the pharmacy catalogue'),
  quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1').max(50),
});

export const orderItemsSchema = z.array(orderItemSchema).min(1, 'Add at least one medicine').max(20);

export const orderCreateSchema = z.object({
  pharmacyId: z.string().uuid('Choose a MediSync partner pharmacy'),
  deliveryAddress: z.string().trim().min(5, 'Enter the delivery address').max(300),
  fulfillment: z.enum(['delivery', 'pickup']).optional(),
  deliveryType: z.enum(['live_gps', 'home_address']).optional(),
  paymentMethod: z.enum(['cod', 'upi', 'card', 'netbanking', 'wallet']).optional(),
  doctorName: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
});

// Pharmacy decisions
export const orderRejectSchema = z.object({
  reason: z.string().trim().min(3, 'Give the patient a reason').max(300),
});

export const orderAdvanceSchema = z.object({
  status: z.enum(['out_for_delivery', 'delivered']),
  note: z.string().trim().max(300).optional(),
});

export const orderCancelSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

export const orderAcceptSchema = z.object({
  fulfillment: z.enum(['delivery', 'pickup']).optional(),
  note: z.string().trim().max(300).optional(),
});

// Pharmacy price list (the catalogue patients order from).
export const inventoryItemSchema = z.object({
  medicineName: z.string().trim().min(2, 'Name the medicine').max(120),
  brand: z.string().trim().max(80).optional(),
  packSize: z.string().trim().max(40).optional(),
  mrp: z.coerce.number().min(0).max(1000000),
  discountPct: z.coerce.number().min(0).max(100).optional(),
  stockQty: z.coerce.number().int().min(0).max(100000),
  isScheduleH: z.boolean().optional(),
});

export const inventoryUpdateSchema = inventoryItemSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

// Profile edits: name/address for patients, store name/address for pharmacies, phone for everyone.
export const profileUpdateSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is too short').max(100).optional(),
    address: z.string().trim().min(5, 'Enter the full address').max(300).optional(),
    storeName: z.string().trim().min(2, 'Store name is too short').max(120).optional(),
    phone: z
      .string()
      .trim()
      .transform((v) => normalizePhone(v))
      .refine((v) => v !== null, 'Enter a valid 10-digit Indian mobile number')
      .optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), 'Nothing to update');

export const prescriptionCreateSchema = z.object({
  pharmacyId: z.string().uuid('Choose a pharmacy to review your prescription'),
  doctorName: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const prescriptionReviewSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    note: z.string().trim().max(500).optional(),
    validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  })
  .refine((v) => v.decision === 'approved' || (v.note && v.note.length >= 3), {
    message: 'Please give a reason when rejecting',
    path: ['note'],
  });
