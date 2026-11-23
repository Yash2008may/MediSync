// Hand-maintained OpenAPI 3.0 description, served at GET /api/openapi.json.
// It describes the stable, server-backed surface (auth, profile, orders, catalogue,
// notifications, admin). Import it into Postman/Insomnia or any OpenAPI viewer.

const json = (schema) => ({ 'application/json': { schema } });
const body = (schema) => ({ required: true, content: json(schema) });
const ok = (description, schema) => ({ description, content: schema ? json(schema) : undefined });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'MediSync API',
    version: '1.3.0',
    description:
      'Prescription ordering, pharmacy catalogue, profiles and licence verification. ' +
      'Browsers authenticate with the httpOnly `medisync_session` cookie; scripts may send `Authorization: Bearer <token>`.',
  },
  servers: [{ url: '/', description: 'Same origin as the app' }],
  tags: [
    { name: 'Auth' },
    { name: 'Profile' },
    { name: 'Orders' },
    { name: 'Catalogue' },
    { name: 'Notifications' },
    { name: 'Admin' },
    { name: 'Ops' },
  ],
  components: {
    securitySchemes: {
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'medisync_session' },
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'object', properties: { message: { type: 'string' }, details: { type: 'array', items: { type: 'object' } } } } },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          role: { type: 'string', enum: ['patient', 'pharmacy', 'admin'] },
          email: { type: 'string', format: 'email' },
          phone: { type: 'string' },
          profile: { type: 'object', nullable: true },
        },
      },
      OrderItem: {
        type: 'object',
        properties: {
          medicineName: { type: 'string' },
          quantity: { type: 'integer' },
          mrp: { type: 'number' },
          discountPct: { type: 'number' },
          isScheduleH: { type: 'boolean' },
          lineTotal: { type: 'number' },
        },
      },
      Order: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          status: {
            type: 'string',
            enum: ['placed', 'confirmed', 'out_for_delivery', 'delivered', 'rejected', 'cancelled'],
          },
          fulfillment: { type: 'string', enum: ['delivery', 'pickup'] },
          deliveryAddress: { type: 'string' },
          totalMrp: { type: 'number' },
          discountPct: { type: 'number' },
          finalPrice: { type: 'number' },
          paymentMethod: { type: 'string' },
          prescriptionId: { type: 'string', format: 'uuid', nullable: true },
          rejectionReason: { type: 'string', nullable: true },
          cancellationReason: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          items: { type: 'array', items: ref('OrderItem') },
          history: {
            type: 'array',
            items: {
              type: 'object',
              properties: { status: { type: 'string' }, note: { type: 'string', nullable: true }, changedAt: { type: 'string', format: 'date-time' } },
            },
          },
        },
      },
      CatalogueItem: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          medicineName: { type: 'string' },
          brand: { type: 'string', nullable: true },
          packSize: { type: 'string', nullable: true },
          mrp: { type: 'number' },
          discountPct: { type: 'number' },
          stockQty: { type: 'integer' },
          isScheduleH: { type: 'boolean' },
        },
      },
      Notification: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          type: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          orderId: { type: 'string', format: 'uuid', nullable: true },
          readAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  security: [{ cookieAuth: [] }, { bearerAuth: [] }],
  paths: {
    '/api/health': {
      get: { tags: ['Ops'], summary: 'Liveness probe', security: [], responses: { 200: ok('Process is up') } },
    },
    '/api/ready': {
      get: { tags: ['Ops'], summary: 'Readiness probe (checks the database)', security: [], responses: { 200: ok('Ready'), 503: ok('Database unavailable') } },
    },
    '/api/openapi.json': {
      get: { tags: ['Ops'], summary: 'This document', security: [], responses: { 200: ok('OpenAPI 3 document') } },
    },
    '/api/auth/{role}/login': {
      post: {
        tags: ['Auth'],
        summary: 'Sign in as patient, pharmacy or admin',
        security: [],
        parameters: [{ name: 'role', in: 'path', required: true, schema: { type: 'string', enum: ['patient', 'pharmacy', 'admin'] } }],
        requestBody: body({ type: 'object', required: ['identifier', 'password'], properties: { identifier: { type: 'string', description: 'Email, mobile, or drug licence for pharmacies' }, password: { type: 'string' } } }),
        responses: { 200: ok('Session cookie set', { type: 'object', properties: { token: { type: 'string' }, user: ref('User') } }), 401: ok('Invalid credentials', ref('Error')), 429: ok('Rate limited', ref('Error')) },
      },
    },
    '/api/auth/logout': {
      post: { tags: ['Auth'], summary: 'Clear the session cookie', security: [], responses: { 200: ok('Signed out') } },
    },
    '/api/auth/forgot-password': {
      post: { tags: ['Auth'], summary: 'Send a reset OTP', security: [], requestBody: body({ type: 'object', required: ['role', 'identifier'], properties: { role: { type: 'string' }, identifier: { type: 'string' } } }), responses: { 200: ok('Same response whether or not the account exists'), 429: ok('Rate limited') } },
    },
    '/api/auth/verify-otp': {
      post: { tags: ['Auth'], summary: 'Trade an OTP for a reset token', security: [], requestBody: body({ type: 'object', required: ['role', 'identifier', 'otp'], properties: { role: { type: 'string' }, identifier: { type: 'string' }, otp: { type: 'string' } } }), responses: { 200: ok('Reset token'), 400: ok('Invalid or expired', ref('Error')), 429: ok('Too many attempts') } },
    },
    '/api/auth/reset-password': {
      post: { tags: ['Auth'], summary: 'Set a new password', security: [], requestBody: body({ type: 'object', required: ['resetToken', 'newPassword'], properties: { resetToken: { type: 'string' }, newPassword: { type: 'string' } } }), responses: { 200: ok('Password updated (all older sessions invalidated)') } },
    },
    '/api/auth/me': { get: { tags: ['Auth'], summary: 'Current user', responses: { 200: ok('Profile', { type: 'object', properties: { user: ref('User') } }), 401: ok('Not signed in', ref('Error')) } } },
    '/api/me/profile': {
      patch: {
        tags: ['Profile'],
        summary: 'Edit your own profile',
        requestBody: body({ type: 'object', properties: { name: { type: 'string' }, address: { type: 'string' }, storeName: { type: 'string' }, phone: { type: 'string' } } }),
        responses: { 200: ok('Updated user', { type: 'object', properties: { user: ref('User') } }), 400: ok('Invalid input', ref('Error')), 409: ok('Mobile already used', ref('Error')) },
      },
    },
    '/api/orders': {
      post: {
        tags: ['Orders'],
        summary: 'Place a prescription order (patient)',
        description: 'multipart/form-data. Prices are read from the pharmacy catalogue; the client never supplies a price.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file', 'pharmacyId', 'items', 'deliveryAddress'],
                properties: {
                  file: { type: 'string', format: 'binary' },
                  pharmacyId: { type: 'string', format: 'uuid' },
                  items: { type: 'string', description: 'JSON array of { inventoryId, quantity }' },
                  deliveryAddress: { type: 'string' },
                  fulfillment: { type: 'string', enum: ['delivery', 'pickup'] },
                  paymentMethod: { type: 'string' },
                  doctorName: { type: 'string' },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          201: ok('Order placed', { type: 'object', properties: { order: ref('Order') } }),
          400: ok('Validation or catalogue error', ref('Error')),
          409: ok('Insufficient stock', ref('Error')),
          413: ok('File too large', ref('Error')),
          415: ok('Unsupported file type', ref('Error')),
        },
      },
      get: {
        tags: ['Orders'],
        summary: 'List orders (role-scoped)',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['placed', 'confirmed', 'out_for_delivery', 'delivered', 'rejected', 'cancelled'] } },
          { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { 200: ok('Orders', { type: 'object', properties: { orders: { type: 'array', items: ref('Order') }, total: { type: 'integer' } } }) },
      },
    },
    '/api/orders/{id}': {
      get: {
        tags: ['Orders'],
        summary: 'One order with its status history',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: ok('Order', { type: 'object', properties: { order: ref('Order') } }), 404: ok('Not found or not yours', ref('Error')) },
      },
    },
    '/api/orders/{id}/accept': {
      patch: {
        tags: ['Orders'],
        summary: 'Accept an order (verified pharmacy)',
        description: 'Reserves stock and approves the attached prescription.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { content: json({ type: 'object', properties: { fulfillment: { type: 'string', enum: ['delivery', 'pickup'] }, note: { type: 'string' } } }) },
        responses: { 200: ok('Confirmed', { type: 'object', properties: { order: ref('Order') } }), 404: ok('No order to accept', ref('Error')), 409: ok('Out of stock', ref('Error')) },
      },
    },
    '/api/orders/{id}/reject': {
      patch: {
        tags: ['Orders'],
        summary: 'Reject an order with a reason (pharmacy)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: body({ type: 'object', required: ['reason'], properties: { reason: { type: 'string', minLength: 3 } } }),
        responses: { 200: ok('Rejected', { type: 'object', properties: { order: ref('Order') } }) },
      },
    },
    '/api/orders/{id}/status': {
      patch: {
        tags: ['Orders'],
        summary: 'Advance fulfilment (pharmacy)',
        description: 'confirmed → out_for_delivery → delivered.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: body({ type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['out_for_delivery', 'delivered'] }, note: { type: 'string' } } }),
        responses: { 200: ok('Updated', { type: 'object', properties: { order: ref('Order') } }), 409: ok('Invalid transition', ref('Error')) },
      },
    },
    '/api/orders/{id}/cancel': {
      patch: {
        tags: ['Orders'],
        summary: 'Cancel your order (patient, before dispatch)',
        description: 'A confirmed order returns its reserved stock.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { content: json({ type: 'object', properties: { reason: { type: 'string' } } }) },
        responses: { 200: ok('Cancelled', { type: 'object', properties: { order: ref('Order') } }), 409: ok('Already dispatched', ref('Error')) },
      },
    },
    '/api/pharmacies/{id}/catalog': {
      get: {
        tags: ['Catalogue'],
        summary: 'Orderable price list of a verified pharmacy',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: ok('Catalogue', { type: 'object', properties: { pharmacy: { type: 'object' }, items: { type: 'array', items: ref('CatalogueItem') } } }), 404: ok('Pharmacy not verified', ref('Error')) },
      },
    },
    '/api/pharmacies/me/inventory': {
      get: { tags: ['Catalogue'], summary: 'Your full price list (pharmacy)', responses: { 200: ok('Inventory', { type: 'object', properties: { inventory: { type: 'array', items: ref('CatalogueItem') } } }) } },
      post: {
        tags: ['Catalogue'],
        summary: 'Add a medicine to your price list (pharmacy)',
        requestBody: body({ type: 'object', required: ['medicineName', 'mrp', 'stockQty'], properties: { medicineName: { type: 'string' }, brand: { type: 'string' }, packSize: { type: 'string' }, mrp: { type: 'number' }, discountPct: { type: 'number' }, stockQty: { type: 'integer' }, isScheduleH: { type: 'boolean' } } }),
        responses: { 201: ok('Created', { type: 'object', properties: { item: ref('CatalogueItem') } }), 409: ok('Already listed', ref('Error')) },
      },
    },
    '/api/pharmacies/me/inventory/{id}': {
      patch: {
        tags: ['Catalogue'],
        summary: 'Update price/stock (pharmacy)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: body({ type: 'object', properties: { medicineName: { type: 'string' }, mrp: { type: 'number' }, discountPct: { type: 'number' }, stockQty: { type: 'integer' }, isScheduleH: { type: 'boolean' } } }),
        responses: { 200: ok('Updated', { type: 'object', properties: { item: ref('CatalogueItem') } }) },
      },
      delete: {
        tags: ['Catalogue'],
        summary: 'Remove a medicine (pharmacy)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: ok('Removed') },
      },
    },
    '/api/notifications': {
      get: {
        tags: ['Notifications'],
        summary: 'Recent notifications and unread count',
        responses: { 200: ok('Notifications', { type: 'object', properties: { notifications: { type: 'array', items: ref('Notification') }, unread: { type: 'integer' } } }) },
      },
    },
    '/api/notifications/read-all': {
      post: { tags: ['Notifications'], summary: 'Mark every notification read', responses: { 200: ok('Updated') } },
    },
    '/api/notifications/{id}/read': {
      patch: {
        tags: ['Notifications'],
        summary: 'Mark one notification read',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: ok('Updated'), 404: ok('Not found', ref('Error')) },
      },
    },
    '/api/admin/overview': {
      get: { tags: ['Admin'], summary: 'Counts, order totals, re-verification queue and audit trail', responses: { 200: ok('Overview') } },
    },
    '/api/admin/orders': {
      get: {
        tags: ['Admin'],
        summary: 'All orders across pharmacies',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'pharmacyId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'offset', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { 200: ok('Orders', { type: 'object', properties: { orders: { type: 'array', items: ref('Order') }, total: { type: 'integer' } } }) },
      },
    },
    '/api/admin/users': {
      get: {
        tags: ['Admin'],
        summary: 'Account directory',
        parameters: [{ name: 'role', in: 'query', schema: { type: 'string', enum: ['patient', 'pharmacy', 'admin'] } }, { name: 'q', in: 'query', schema: { type: 'string' } }],
        responses: { 200: ok('Users') },
      },
    },
    '/api/admin/users/{id}/account': {
      patch: {
        tags: ['Admin'],
        summary: 'Suspend or re-enable an account',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: body({ type: 'object', required: ['active'], properties: { active: { type: 'boolean' }, note: { type: 'string' } } }),
        responses: { 200: ok('Updated'), 404: ok('Not found', ref('Error')) },
      },
    },
    '/api/admin/pharmacies/{id}/verify': {
      patch: {
        tags: ['Admin'],
        summary: 'Approve or reject a licence',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: body({ type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['approved', 'rejected'] }, note: { type: 'string' } } }),
        responses: { 200: ok('Decision recorded') },
      },
    },
  },
};
